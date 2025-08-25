import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { getCartWithProducts } from '../../../lib/shopping-store';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    
    if (!session?.user?.sub) {
      return NextResponse.json({ 
        error: 'Unauthorized', 
        message: 'You must be logged in to checkout' 
      }, { status: 401 });
    }

    const userId = session.user.sub;
    console.log('Checkout auth - User ID:', userId);
    
    // Get cart with products
    const cartData = getCartWithProducts(userId);
    console.log('Checkout auth - Cart data:', cartData);
    
    if (cartData.items.length === 0) {
      console.log('Checkout auth - Cart is empty for user:', userId);
      return NextResponse.json({ 
        error: 'Empty cart', 
        message: 'Your cart is empty. Add some items before checking out.' 
      }, { status: 400 });
    }

    // Calculate total and validate all products exist
    let total = 0;
    const invalidItems = cartData.items.filter(item => !item.product);
    
    if (invalidItems.length > 0) {
      return NextResponse.json({ 
        error: 'Invalid cart', 
        message: 'Some items in your cart are no longer available.' 
      }, { status: 400 });
    }

    total = cartData.items.reduce((sum, item) => {
      if (item.product) {
        return sum + (item.product.price * item.quantity);
      }
      return sum;
    }, 0);

    const itemCount = cartData.items.reduce((sum, item) => sum + item.quantity, 0);

    // For Auth0 for AI CIBA implementation, we would:
    // 1. Initiate a CIBA request to Auth0's backchannel authorization endpoint
    // 2. Include the binding message with checkout details
    // 3. Return the auth_req_id to poll for authorization status
    // 4. User receives push notification on their device
    // 5. After user approval, we get an access token and complete the checkout

    // Simulated CIBA flow response
    const authReqId = `checkout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return NextResponse.json({
      success: true,
      requiresAuthorization: true,
      authReqId: authReqId,
      message: 'Checkout authorization required. Please check your Auth0 Guardian app for a push notification.',
      authorizationUrl: `${request.url.split('/api/checkout-auth')[0]}/authorize?authReqId=${authReqId}`,
      checkout: {
        itemCount,
        total: parseFloat(total.toFixed(2)),
        items: cartData.items.map(item => {
          if (!item.product) {
            throw new Error('Invalid product in cart');
          }
          return {
            productId: item.product.id,
            name: item.product.name,
            price: item.product.price,
            quantity: item.quantity,
            subtotal: parseFloat((item.product.price * item.quantity).toFixed(2))
          };
        }),
        bindingMessage: `Do you want to complete checkout for ${itemCount} items totaling $${total.toFixed(2)}?`
      }
    });

  } catch (error) {
    console.error('Checkout authorization error:', error);
    return NextResponse.json({ 
      error: 'Authorization failed', 
      message: 'An error occurred during checkout authorization. Please try again.' 
    }, { status: 500 });
  }
}
