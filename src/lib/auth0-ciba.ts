// Auth0 CIBA (Client Initiated Backchannel Authentication) implementation
// This provides real push notifications for secure checkout authorization

interface CibaInitiateRequest {
  scope: string;
  client_id: string;
  client_secret: string; // Required for client authentication
  binding_message?: string;
  user_hint?: string;
  login_hint?: string;
}

interface CibaInitiateResponse {
  auth_req_id: string;
  expires_in: number;
  interval: number;
}

interface CibaTokenRequest {
  grant_type: 'urn:ietf:params:oauth:grant-type:ciba';
  auth_req_id: string;
  client_id: string;
  client_secret: string;
}

interface CibaTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export class Auth0CibaService {
  private clientId: string;
  private clientSecret: string;
  private domain: string;
  private cibaEndpoint: string;
  private tokenEndpoint: string;

  constructor() {
    const clientId = process.env.AUTH0_AI_CLIENT_ID;
    const clientSecret = process.env.AUTH0_AI_CLIENT_SECRET;
    const issuerBaseUrl = process.env.AUTH0_ISSUER_BASE_URL;
    const cibaEndpoint = process.env.AUTH0_CIBA_ENDPOINT;
    const tokenEndpoint = process.env.AUTH0_TOKEN_ENDPOINT;

    if (!clientId || !clientSecret || !issuerBaseUrl || !cibaEndpoint || !tokenEndpoint) {
      throw new Error('Auth0 CIBA configuration is missing. Please check your environment variables: AUTH0_AI_CLIENT_ID, AUTH0_AI_CLIENT_SECRET, AUTH0_ISSUER_BASE_URL, AUTH0_CIBA_ENDPOINT, AUTH0_TOKEN_ENDPOINT');
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.domain = issuerBaseUrl.replace('https://', '');
    this.cibaEndpoint = cibaEndpoint;
    this.tokenEndpoint = tokenEndpoint;
  }

  /**
   * Initiate a CIBA request that sends a push notification to the user's device
   * Note: Requires proper Auth0 CIBA + Guardian setup for real push notifications
   */
  async initiateCiba(options: {
    userId: string;
    bindingMessage: string;
    scope?: string;
  }): Promise<CibaInitiateResponse> {
    const { userId, bindingMessage, scope = 'openid profile email' } = options;

    const requestBody: CibaInitiateRequest = {
      scope,
      client_id: this.clientId,
      client_secret: this.clientSecret, // Add client_secret for authentication
      binding_message: bindingMessage,
      login_hint: JSON.stringify({ format: "iss_sub", iss: `https://${this.domain}/`, sub: userId }), // Format login_hint with required format field
    };

    console.log('=== CIBA INITIATION REQUEST ===');
    console.log('Request Body:', requestBody);
    console.log('CIBA Endpoint:', this.cibaEndpoint);
    console.log('Request Headers:', {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    });

    try {
      const response = await fetch(this.cibaEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams(requestBody as unknown as Record<string, string>),
      });

      console.log('=== CIBA INITIATION RESPONSE ===');
      console.log('Response Status:', response.status);
      console.log('Response Headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('CIBA initiation failed - Full Response:', {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: errorText
        });
        
        // Check for common CIBA configuration issues
        if (response.status === 404) {
          throw new Error('CIBA endpoint not found. Auth0 CIBA may not be enabled for this tenant.');
        } else if (response.status === 400) {
          throw new Error('CIBA request invalid. Check if user has registered devices for push notifications.');
        } else if (response.status === 403) {
          throw new Error('CIBA not authorized. Check if application has CIBA grant type enabled.');
        }
        
        throw new Error(`CIBA initiation failed: ${response.status} - ${errorText}`);
      }

      const result: CibaInitiateResponse = await response.json();
      console.log('=== CIBA INITIATION SUCCESS ===');
      console.log('Full Response Data:', JSON.stringify(result, null, 2));
      console.log('Auth Request ID:', result.auth_req_id);
      console.log('Expires In:', result.expires_in, 'seconds');
      console.log('Polling Interval:', result.interval, 'seconds');
      
      return result;
    } catch (error) {
      console.error('Error initiating CIBA:', error);
      
      // Provide helpful error message for common issues
      if (error instanceof Error) {
        if (error.message.includes('CIBA endpoint not found')) {
          throw new Error('Push notifications are not configured. Please enable Auth0 CIBA in your tenant settings.');
        } else if (error.message.includes('registered devices')) {
          throw new Error('No registered devices found for push notifications. Please set up Auth0 Guardian mobile app.');
        }
      }
      
      throw error;
    }
  }

  /**
   * Poll for CIBA token completion
   */
  async pollCibaToken(authReqId: string): Promise<CibaTokenResponse> {
    // Use Machine-to-Machine client for token polling (separate from AI client for initiation)
    const m2mClientId = process.env.AUTH0_M2M_CLIENT_ID;
    const m2mClientSecret = process.env.AUTH0_M2M_CLIENT_SECRET;
    
    if (!m2mClientId || !m2mClientSecret) {
      throw new Error('Auth0 M2M credentials are missing. Please check AUTH0_M2M_CLIENT_ID and AUTH0_M2M_CLIENT_SECRET environment variables.');
    }
    
    console.log('=== CIBA TOKEN POLLING REQUEST ===');
    console.log('Auth Request ID:', authReqId);
    console.log('Token Endpoint:', this.tokenEndpoint);
    console.log('Using M2M Client ID:', m2mClientId);

    const requestBody = {
      grant_type: 'urn:ietf:params:oauth:grant-type:ciba',
      auth_req_id: authReqId,
      client_id: m2mClientId,
      client_secret: m2mClientSecret,
      audience: process.env.AUTH0_AUDIENCE || 'http://localhost:5000/api/checkout',
    };

    try {
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams(requestBody),
      });

      console.log('=== CIBA TOKEN POLLING RESPONSE ===');
      console.log('Response Status:', response.status);
      console.log('Response Headers:', Object.fromEntries(response.headers.entries()));

      const result: CibaTokenResponse = await response.json();
      
      console.log('=== CIBA TOKEN RESPONSE DATA ===');
      console.log('Full Response:', JSON.stringify({
        ...result,
        access_token: result.access_token ? '[REDACTED]' : undefined
      }, null, 2));
      
      console.log('Token Poll Summary:', { 
        status: response.status, 
        hasToken: !!result.access_token,
        error: result.error,
        error_description: result.error_description,
        token_type: result.token_type,
        expires_in: result.expires_in
      });

      return result;
    } catch (error) {
      console.error('=== CIBA TOKEN POLLING ERROR ===');
      console.error('Error Details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        authReqId: authReqId
      });
      throw error;
    }
  }

  /**
   * Continuously poll until CIBA is completed or times out
   */
  async waitForCibaCompletion(
    authReqId: string, 
    options: {
      interval?: number;
      maxAttempts?: number;
      onProgress?: (attempt: number, status: string) => void;
    } = {}
  ): Promise<CibaTokenResponse> {
    const { interval = 5000, maxAttempts = 24, onProgress } = options; // 2 minutes max (5s * 24 = 120s)
    
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      if (onProgress) {
        onProgress(attempts, 'polling');
      }
      
      try {
        const result = await this.pollCibaToken(authReqId);
        
        if (result.access_token) {
          // Success - user approved
          if (onProgress) {
            onProgress(attempts, 'approved');
          }
          return result;
        }
        
        if (result.error) {
          if (result.error === 'authorization_pending') {
            // Still waiting for user approval
            if (onProgress) {
              onProgress(attempts, 'pending');
            }
          } else if (result.error === 'slow_down') {
            // Increase polling interval
            if (onProgress) {
              onProgress(attempts, 'slow_down');
            }
            await this.sleep(interval * 1.5);
            continue;
          } else if (result.error === 'expired_token' || result.error === 'access_denied') {
            // User denied or token expired
            if (onProgress) {
              onProgress(attempts, result.error);
            }
            return result;
          } else {
            // Other error
            console.error('CIBA polling error:', result);
            return result;
          }
        }
        
        // Wait before next poll
        await this.sleep(interval);
        
      } catch (error) {
        console.error('CIBA polling attempt failed:', error);
        if (attempts >= maxAttempts) {
          throw error;
        }
        await this.sleep(interval);
      }
    }
    
    // Timeout
    if (onProgress) {
      onProgress(attempts, 'timeout');
    }
    
    return {
      error: 'timeout',
      error_description: 'CIBA authorization timed out'
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const auth0CibaService = new Auth0CibaService();
