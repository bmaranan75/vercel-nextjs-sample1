import { tool } from "ai";
import { z } from "zod";
import { withAsyncUserConfirmation } from "../auth0-ai";
import { getSession } from '@auth0/nextjs-auth0';
import { getCartWithProducts, clearCart } from '../shopping-store';

console.log('📦 Loading async checkout tool...');

export const asyncCheckout = withAsyncUserConfirmation(
  tool({
    description: "Execute secure checkout with Auth0 CIBA authorization",
    parameters: z.object({
      confirmCheckout: z.boolean().describe("Confirmation to proceed with checkout").default(true),
    }),
    execute: async ({ confirmCheckout }) => {
      console.log('🛒 ASYNC CHECKOUT TOOL EXECUTED');
      console.log('Confirm checkout:', confirmCheckout);
      
      if (!confirmCheckout) {
        console.log('❌ Checkout cancelled by user');
        return "Checkout cancelled by user";
      }

      console.log('🔍 Getting session...');
      const session = await getSession();
      console.log('Session user:', session?.user?.sub);
      
      if (!session?.user?.sub) {
        console.log('❌ User not authenticated');
        throw new Error("User not authenticated");
      }

      const userId = session.user.sub;
      console.log('✅ User authenticated:', userId);
      
      // Get cart data
      console.log('🛒 Getting cart data...');
      const cartData = await getCartWithProducts(userId);
      console.log('Cart data:', JSON.stringify(cartData, null, 2));
      
      if (!cartData.items || cartData.items.length === 0) {
        console.log('❌ Cart is empty');
        return "Cart is empty. Please add some items before checkout.";
      }

      console.log('💰 Processing checkout for total:', cartData.total);

      // Simulate checkout processing
      const checkout = {
        itemCount: cartData.items.length,
        total: cartData.total,
        timestamp: new Date().toISOString(),
        items: cartData.items.map(item => ({
          name: item.product?.name || 'Unknown Product',
          price: item.product?.price || 0,
          quantity: item.quantity
        }))
      };

      console.log('✅ Checkout processed successfully:', checkout);

      // For testing, we'll comment out cart clearing
      // await clearCart(userId);
      console.log('🧹 Cart preserved for testing');

      return `Checkout completed successfully! Processed ${checkout.itemCount} items for a total of $${checkout.total.toFixed(2)} at ${new Date(checkout.timestamp).toLocaleString()}. Cart preserved for testing.`;
    },
  })
);

console.log('✅ Async checkout tool configured with Auth0 AI wrapper');
