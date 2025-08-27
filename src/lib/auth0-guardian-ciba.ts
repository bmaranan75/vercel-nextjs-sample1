// Auth0 Guardian CIBA implementation for real push notifications
// This uses Auth0 Guardian which provides actual push notifications to mobile devices

interface GuardianCibaRequest {
  scope: string;
  client_id: string;
  binding_message?: string;
  login_hint?: string;
}

interface GuardianCibaResponse {
  auth_req_id: string;
  expires_in: number;
  interval: number;
}

export class Auth0GuardianCibaService {
  private clientId: string;
  private clientSecret: string;
  private domain: string;
  private guardianEndpoint: string;
  private tokenEndpoint: string;

  constructor() {
    this.clientId = process.env.AUTH0_CLIENT_ID!;
    this.clientSecret = process.env.AUTH0_CLIENT_SECRET!;
    this.domain = process.env.AUTH0_ISSUER_BASE_URL!.replace('https://', '');
    this.guardianEndpoint = `https://${this.domain}/mfa/guardian/ciba`;
    this.tokenEndpoint = `https://${this.domain}/oauth/token`;

    if (!this.clientId || !this.clientSecret || !this.domain) {
      throw new Error('Auth0 Guardian configuration is missing. Please check your environment variables.');
    }
  }

  /**
   * Initiate Guardian CIBA request with real push notification
   */
  async initiateGuardianCiba(options: {
    userId: string;
    bindingMessage: string;
    userPhoneNumber?: string;
  }): Promise<GuardianCibaResponse> {
    const { userId, bindingMessage, userPhoneNumber } = options;

    // Step 1: Get Management API token
    const managementToken = await this.getManagementToken();
    
    // Step 2: Ensure user has Guardian enrolled
    await this.ensureGuardianEnrollment(userId, managementToken, userPhoneNumber);

    // Step 3: Initiate CIBA request
    const requestBody = {
      scope: 'openid profile email',
      client_id: this.clientId,
      binding_message: bindingMessage,
      login_hint: userId,
    };

    console.log('Initiating Guardian CIBA request:', requestBody);

    try {
      const response = await fetch(this.guardianEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Authorization': `Bearer ${managementToken}`,
        },
        body: new URLSearchParams(requestBody as unknown as Record<string, string>),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Guardian CIBA initiation failed:', response.status, errorText);
        throw new Error(`Guardian CIBA initiation failed: ${response.status} - ${errorText}`);
      }

      const result: GuardianCibaResponse = await response.json();
      console.log('Guardian CIBA initiated successfully:', result);
      
      return result;
    } catch (error) {
      console.error('Error initiating Guardian CIBA:', error);
      throw error;
    }
  }

  /**
   * Get Auth0 Management API token
   */
  private async getManagementToken(): Promise<string> {
    const response = await fetch(`https://${this.domain}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        audience: `https://${this.domain}/api/v2/`,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to get Management API token');
    }

    const data = await response.json();
    return data.access_token;
  }

  /**
   * Ensure user has Guardian enrollment for push notifications
   */
  private async ensureGuardianEnrollment(
    userId: string, 
    managementToken: string, 
    phoneNumber?: string
  ): Promise<void> {
    try {
      // Check if user has Guardian enrollment
      const enrollmentsResponse = await fetch(
        `https://${this.domain}/api/v2/users/${encodeURIComponent(userId)}/enrollments`,
        {
          headers: {
            'Authorization': `Bearer ${managementToken}`,
            'Accept': 'application/json',
          },
        }
      );

      if (!enrollmentsResponse.ok) {
        console.warn('Could not check Guardian enrollments for user:', userId);
        return;
      }

      const enrollments = await enrollmentsResponse.json();
      const hasGuardianEnrollment = enrollments.some((e: any) => 
        e.type === 'guardian' && e.status === 'confirmed'
      );

      if (!hasGuardianEnrollment) {
        console.log('User does not have Guardian enrollment. Attempting to create enrollment ticket...');
        
        // Create Guardian enrollment ticket
        const ticketResponse = await fetch(`https://${this.domain}/api/v2/guardian/enrollments/ticket`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${managementToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: userId,
            email: undefined, // Will use user's email from profile
            phone_number: phoneNumber,
            send_mail: false, // We'll handle notification ourselves
          }),
        });

        if (ticketResponse.ok) {
          const ticket = await ticketResponse.json();
          console.log('Guardian enrollment ticket created:', ticket.ticket_url);
          
          // In a real app, you would direct the user to enroll via the Guardian app
          // For now, we'll proceed and let the CIBA request handle it
        }
      }
    } catch (error) {
      console.warn('Guardian enrollment check failed:', error);
      // Continue anyway - CIBA might still work if user has other MFA methods
    }
  }

  /**
   * Poll for Guardian CIBA completion
   */
  async pollGuardianToken(authReqId: string): Promise<any> {
    const requestBody = {
      grant_type: 'urn:ietf:params:oauth:grant-type:ciba',
      auth_req_id: authReqId,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    };

    console.log('Polling Guardian CIBA token for auth_req_id:', authReqId);

    try {
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams(requestBody as unknown as Record<string, string>),
      });

      const result = await response.json();
      console.log('Guardian CIBA token response:', { 
        status: response.status, 
        hasToken: !!result.access_token,
        error: result.error 
      });

      return result;
    } catch (error) {
      console.error('Error polling Guardian CIBA token:', error);
      throw error;
    }
  }
}

export const auth0GuardianCibaService = new Auth0GuardianCibaService();
