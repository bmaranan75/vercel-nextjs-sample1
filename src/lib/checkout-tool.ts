import { tool } from "ai";
import { z } from "zod";
import { withAsyncUserConfirmation } from "./auth0-ai";
import { getCart, clearCart, PRODUCTS, type CartItem } from "./shopping-store";

// Create a checkout tool wrapped with Auth0 AI async user confirmation
export const checkoutTool = withAsyncUserConfirmation(
  tool({
    description: "Process checkout for the user's shopping cart with human confirmation via push notification",
    parameters: z.object({
      userId: z.string().describe("The user ID to process checkout for"),
      paymentMethod: z.string().optional().describe("Payment method to use").default("credit_card"),
    }),
    execute: async ({ userId, paymentMethod }) => {
      console.log(`🛒 Processing checkout for user: ${userId} with payment method: ${paymentMethod}`);
      
      try {
        // Get the current cart
        const cart = await getCart(userId);
        
        if (!cart || cart.items.length === 0) {
          return {
            success: false,
            error: "No items in cart",
            total: 0,
            items: []
          };
        }

        // Calculate total with proper typing
        const total = cart.items.reduce((sum: number, item: CartItem) => {
          const product = PRODUCTS.find(p => p.id === item.productId);
          const price = product ? product.price : 0;
          return sum + (price * item.quantity);
        }, 0);
        
        // Simulate payment processing
        console.log(`💳 Processing payment of $${total.toFixed(2)} with ${paymentMethod}`);
        
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // For testing purposes, let's comment out cart clearing as requested
        // clearCart(userId);
        
        const result = {
          success: true,
          orderId: `order_${Date.now()}`,
          total: total,
          items: cart.items,
          paymentMethod: paymentMethod,
          timestamp: new Date().toISOString(),
          message: `Successfully processed checkout for $${total.toFixed(2)}. Cart preserved for testing.`
        };
        
        console.log("✅ Checkout completed:", result);
        return result;
        
      } catch (error) {
        console.error("❌ Checkout failed:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error occurred",
          total: 0,
          items: []
        };
      }
    },
  })
);
