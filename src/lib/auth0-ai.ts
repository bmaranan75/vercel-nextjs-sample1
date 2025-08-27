import { Auth0AI, setGlobalAIContext } from "@auth0/ai-vercel";
import {
  AccessDeniedInterrupt,
  type AuthorizationPendingInterrupt,
  type AuthorizationPollingInterrupt,
} from "@auth0/ai/interrupts";

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

// Initialize Auth0 AI instance
const auth0AI = new Auth0AI({
  store: () => store,
});

// Export the main authorization wrapper for checkout operations
export const withAsyncUserConfirmation = auth0AI.withAsyncUserConfirmation({
  userID: async () => {
    // In a real app, you'd get this from your auth context
    // For now, we'll use a placeholder - you should replace this with actual user ID
    return "user-placeholder";
  },
  scopes: ["stock:buy"], // Use the same scopes as the cloudflare example
  audience: process.env.AUTH0_AUDIENCE || "https://api.mystocks.example",
  onAuthorizationInterrupt: async (
    interrupt: AuthorizationPendingInterrupt | AuthorizationPollingInterrupt,
    context
  ) => {
    console.log("Authorization interrupt received:", interrupt);
    // In the reference implementation, this schedules async confirmation polling
    // For Next.js, we'll need to handle this differently
    // This is where the CIBA flow would be initiated
  },
  onUnauthorized: async (e: Error) => {
    if (e instanceof AccessDeniedInterrupt) {
      return "The user has denied the checkout request";
    }
    return e.message;
  },
  bindingMessage: "Please confirm the checkout operation on your device.",
});

// For Google Calendar integration (if needed)
export const withGoogleCalendar = auth0AI.withTokenForConnection({
  refreshToken: async () => {
    // This would come from your Auth0 session
    return undefined; // Placeholder - should return refresh token string
  },
  connection: "google-oauth2",
  scopes: ["https://www.googleapis.com/auth/calendar.freebusy"],
});

export default auth0AI;
