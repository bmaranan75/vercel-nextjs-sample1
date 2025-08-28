import { Auth0AI, setGlobalAIContext } from "@auth0/ai-vercel";
import {
  AccessDeniedInterrupt,
  type AuthorizationPendingInterrupt,
  type AuthorizationPollingInterrupt,
} from "@auth0/ai/interrupts";
import { getSession } from '@auth0/nextjs-auth0';

// Simple in-memory store for demo purposes
// In production, you'd use a persistent storage like Redis, database, etc.
class InMemoryStore {
  private store = new Map<string, any>();

  async get(namespace: string[], key: string) {
    const fullKey = [...namespace, key].join(':');
    return this.store.get(fullKey);
  }

  async put(namespace: string[], key: string, value: any) {
    const fullKey = [...namespace, key].join(':');
    this.store.set(fullKey, value);
  }

  async delete(namespace: string[], key: string) {
    const fullKey = [...namespace, key].join(':');
    this.store.delete(fullKey);
  }
}

const store = new InMemoryStore();

// Set global AI context for thread tracking
setGlobalAIContext(() => ({ 
  threadID: `thread-${Date.now()}` 
}));

console.log('🔧 Initializing Auth0 AI...');
console.log('AUTH0_AI_AUDIENCE:', process.env.AUTH0_AI_AUDIENCE);
console.log('AUTH0_DOMAIN:', process.env.AUTH0_DOMAIN);
console.log('AUTH0_CLIENT_ID:', process.env.AUTH0_CLIENT_ID ? '***' : 'undefined');
console.log('AUTH0_CLIENT_SECRET:', process.env.AUTH0_CLIENT_SECRET ? '***' : 'undefined');

// Create Auth0 AI instance with store and Auth0 client configuration
const auth0AI = new Auth0AI({
  store: () => store,
  auth0: {
    domain: process.env.AUTH0_DOMAIN,
    clientId: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
  },
});

console.log('✅ Auth0 AI instance created successfully');

// Async user confirmation wrapper for CIBA checkout authorization
export const withAsyncUserConfirmation = auth0AI.withAsyncUserConfirmation({
  userID: async () => {
    console.log('🔍 Getting user ID for Auth0 AI...');
    const session = await getSession();
    console.log('Session user:', session?.user?.sub);
    if (!session?.user?.sub) {
      throw new Error("User not authenticated");
    }
    console.log('✅ User ID retrieved:', session.user.sub);
    return session.user.sub;
  },
  scopes: ["checkout:process"],
  audience: process.env.AUTH0_AI_AUDIENCE || "http://localhost:5000/api/checkout",
  onAuthorizationInterrupt: async (
    interrupt: AuthorizationPendingInterrupt | AuthorizationPollingInterrupt,
    context
  ) => {
    console.log('🚨 Auth0 AI authorization interrupt:', interrupt.constructor.name);
    console.log('Interrupt context:', context);
    // In a full implementation, you might schedule a background job to poll for completion
    // For now, the Auth0 AI SDK will handle the polling automatically
  },
  onUnauthorized: async (e: Error) => {
    console.log('❌ Auth0 AI onUnauthorized:', e);
    if (e instanceof AccessDeniedInterrupt) {
      return "The user has denied the checkout request";
    }
    return `Authorization failed: ${e.message}`;
  },
  bindingMessage: "Please confirm checkout operation on your registered device.",
});

// For Google Calendar integration (can be implemented later using auth0AI.withTokenForConnection)
export const withGoogleCalendar = (config: any) => {
  // Not implemented yet - return undefined for now
  return undefined;
};
