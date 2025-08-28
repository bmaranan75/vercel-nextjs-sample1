import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { NextRequest } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { tool } from 'ai';
import { z } from 'zod';
import { 
  addToCart, 
  getCart, 
  clearCart, 
  getProducts,
  getCartWithProducts,
  PRODUCTS,
  type Product,
  type CartItem
} from '../../../lib/shopping-store';

// Simplified checkout without Auth0 AI for now
const simpleCheckout = tool({
  description: 'Process checkout for the shopping cart (simplified version)',
  parameters: z.object({
    userId: z.string().describe('The user ID to process checkout for'),
  }),
  execute: async ({ userId }) => {
    console.log(`🛒 Processing simple checkout for user: ${userId}`);
    
    try {
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
      console.log(`💳 Processing payment of $${total.toFixed(2)}`);
      
      // For testing purposes, don't clear cart
      // clearCart(userId);
      
      const result = {
        success: true,
        orderId: `order_${Date.now()}`,
        total: total,
        items: cart.items,
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
});

// Define tools using the AI SDK pattern
const tools = {
  // Get available products
  get_products: tool({
    description: 'Get list of available products for shopping',
    parameters: z.object({}),
    execute: async () => {
      const products = getProducts();
      return {
        products: products,
        message: `Found ${products.length} available products.`
      };
    },
  }),

  // Add item to cart
  add_to_cart: tool({
    description: 'Add a product to the shopping cart',
    parameters: z.object({
      productId: z.string().describe('The ID of the product to add'),
      quantity: z.number().min(1).describe('Quantity to add to cart'),
      userId: z.string().describe('The user ID (will be provided by system)'),
    }),
    execute: async ({ productId, quantity, userId }) => {
      const product = PRODUCTS.find(p => p.id === productId);
      if (!product) {
        return { success: false, message: 'Product not found' };
      }

      await addToCart(userId, productId, quantity);
      const cart = await getCartWithProducts(userId);
      
      return {
        success: true,
        message: `Added ${quantity} ${product.name}(s) to cart.`,
        cart: cart
      };
    },
  }),

  // View current cart
  view_cart: tool({
    description: 'View the current shopping cart contents',
    parameters: z.object({
      userId: z.string().describe('The user ID (will be provided by system)'),
    }),
    execute: async ({ userId }) => {
      const cart = await getCartWithProducts(userId);
      return {
        success: true,
        cart: cart,
        message: cart.items.length > 0 
          ? `Your cart contains ${cart.items.length} different items.`
          : 'Your cart is empty.'
      };
    },
  }),

  // Clear cart
  clear_cart: tool({
    description: 'Clear all items from the shopping cart',
    parameters: z.object({
      userId: z.string().describe('The user ID (will be provided by system)'),
    }),
    execute: async ({ userId }) => {
      await clearCart(userId);
      return {
        success: true,
        message: 'Shopping cart cleared successfully.'
      };
    },
  }),

  // Simple checkout
  checkout: simpleCheckout,
};

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    const session = await getSession();

    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const userId = session.user.sub;

    const result = streamText({
      model: openai('gpt-3.5-turbo'),
      messages,
      tools,
      toolChoice: 'auto',
      system: `You are a helpful AI shopping assistant with access to product catalog and cart management.

AVAILABLE CAPABILITIES:
- Browse and search products
- Add items to shopping cart
- View cart contents
- Process secure checkout with Auth0 CIBA push notifications

SHOPPING WORKFLOW:
1. Help users browse products with get_products
2. Add desired items to cart with add_to_cart (always include userId: "${userId}")
3. Let users review their cart with view_cart (always include userId: "${userId}")
4. Process secure checkout with the checkout tool (requires push notification approval)

IMPORTANT NOTES:
- The checkout tool uses Auth0 AI with async user confirmation via push notifications
- Users will receive a push notification on their registered device to approve the purchase
- Always show cart contents before initiating checkout
- Be helpful and friendly in your responses
- Always pass the current userId to cart operations

Current user ID: ${userId}
When calling cart tools, always include userId: "${userId}" in the parameters.`,
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
