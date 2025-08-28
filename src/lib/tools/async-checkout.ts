import { tool } from 'ai';
import { z } from 'zod';
import { getCIBACredentials } from '@auth0/ai-vercel';
import { getCartWithProducts } from '../shopping-store';

export const asyncCheckoutTool = tool({
  description: 'Complete checkout with async user authorization via CIBA push notification',
  parameters: z.object({}),
  execute: async (_, options) => {
    console.log('Starting async checkout process...');

    // Access user from the tool configuration
    const user = (options as any)?.configurable?._credentials?.user;

    if (!user?.sub) {
      return 'User not authenticated. Please log in first.';
    }

    // Get cart data
    const cartData = await getCartWithProducts(user.sub);
    
    if (cartData.items.length === 0) {
      return 'Your cart is empty. Add some items before checking out.';
    }

    // Calculate total
    const total = cartData.items.reduce((sum, item) => {
      if (item.product) {
        return sum + (item.product.price * item.quantity);
      }
      return sum;
    }, 0);

    const itemCount = cartData.items.reduce((sum, item) => sum + item.quantity, 0);

    console.log(`Requesting authorization for checkout: ${itemCount} items, $${total.toFixed(2)}`);

    // This will trigger the CIBA flow when wrapped with withAsyncCheckoutConfirmation
    // The Auth0 AI SDK will:
    // 1. Initiate a CIBA request to Auth0
    // 2. Send a push notification to the user's device
    // 3. Wait for user approval/denial
    // 4. Return the appropriate credentials or error

    // Get CIBA credentials (this will be available after user authorization)
    const credentials = getCIBACredentials();
    const accessToken = credentials?.accessToken;

    if (!accessToken) {
      return 'Authorization failed. Could not obtain access token.';
    }

    console.log('Authorization successful, proceeding with checkout...');

    // Call the actual checkout API with the authorized token
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';

    try {
      const checkoutResponse = await fetch(`${baseUrl}/api/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!checkoutResponse.ok) {
        const errorData = await checkoutResponse.json();
        return `Checkout failed: ${errorData.message || 'Unknown error'}`;
      }

      const checkoutResult = await checkoutResponse.json();

      if (checkoutResult.success) {
        return `✅ **Checkout Completed Successfully!**

🎉 **Order Confirmed**
• Order ID: **${checkoutResult.order.orderId}**
• Total Amount: **$${checkoutResult.order.total.toFixed(2)}**
• Items: **${checkoutResult.order.items.length}**
• Timestamp: ${new Date(checkoutResult.order.timestamp).toLocaleString()}

Your order has been processed and your cart has been cleared. Thank you for your purchase!`;
      } else {
        return `❌ Checkout failed: ${checkoutResult.message || 'Unknown error'}`;
      }
    } catch (error) {
      console.error('Checkout API error:', error);
      return '❌ Sorry, there was an error processing your checkout. Please try again.';
    }
  },
});
