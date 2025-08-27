import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { getCartWithProducts } from '../../../lib/shopping-store';
import { getCibaRequest } from '../../../lib/ciba-storage';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    console.log('Checkout API - Session:', session?.user?.sub);
    
    if (!session?.user?.sub) {
      return NextResponse.json({ 
        error: 'Unauthorized', 
        message: 'You must be logged in to checkout' 
      }, { status: 401 });
    }

    const userId = session.user.sub;
    
    // Check if this is a CIBA-based checkout
    const requestBody = await request.json().catch(() => ({}));
    const { authReqId, action, userId: requestUserId, popupRequestId } = requestBody;
    console.log('Checkout API - Auth Request ID:', authReqId);
    console.log('Checkout API - Action:', action);
    console.log('Checkout API - Popup Request ID:', popupRequestId);
    
    let cartData;
    
    // Handle popup checkout completion
    if (action === 'popup_checkout_complete') {
      console.log('=== POPUP CHECKOUT COMPLETION ===');
      console.log('User ID from session:', userId);
      console.log('User ID from request:', requestUserId);
      console.log('Popup Request ID:', popupRequestId);
      
      // Use current cart for popup checkout
      cartData = getCartWithProducts(userId);
      console.log('Popup checkout - Cart data retrieved:', cartData);
      
      // Update popup request status if provided
      if (popupRequestId) {
        try {
          const { updatePopupRequest } = await import('../../../lib/popup-storage');
          const result = {
            success: true,
            itemCount: cartData.items.length,
            total: cartData.total,
            items: cartData.items.map(item => ({
              name: item.product?.name || 'Unknown Product',
              quantity: item.quantity,
              price: item.product?.price || 0
            }))
          };
          
          updatePopupRequest(popupRequestId, 'completed', result);
          console.log('Updated popup request status to completed');
        } catch (error) {
          console.error('Error updating popup request status:', error);
        }
      }
    } else if (authReqId) {
      // CIBA-based checkout: use cart data from the authorization request
      console.log('Checkout API - Using CIBA cart data for authReqId:', authReqId);
      const cibaRequest = getCibaRequest(authReqId);
      
      if (!cibaRequest) {
        return NextResponse.json({ 
          error: 'Invalid authorization', 
          message: 'Authorization request not found' 
        }, { status: 404 });
      }
      
      if (cibaRequest.userId !== userId) {
        return NextResponse.json({ 
          error: 'Unauthorized', 
          message: 'This authorization request does not belong to you' 
        }, { status: 403 });
      }
      
      if (!cibaRequest.checkoutData) {
        return NextResponse.json({ 
          error: 'No checkout data', 
          message: 'No cart data found in authorization request' 
        }, { status: 400 });
      }
      
      cartData = cibaRequest.checkoutData;
      console.log('Checkout API - CIBA cart data retrieved:', cartData);
      
    } else {
      // Regular checkout: use current cart
      console.log('Checkout API - Getting current cart for user:', userId);
      cartData = getCartWithProducts(userId);
      console.log('Checkout API - Current cart data retrieved:', cartData);
    }
    
    if (cartData.items.length === 0) {
      return NextResponse.json({ 
        error: 'Empty cart', 
        message: 'Your cart is empty. Add some items before checking out.' 
      }, { status: 400 });
    }

    // Calculate total and validate all products exist
    let total = 0;
    const invalidItems = cartData.items.filter((item: any) => !item.product);
    
    if (invalidItems.length > 0) {
      return NextResponse.json({ 
        error: 'Invalid cart', 
        message: 'Some items in your cart are no longer available.' 
      }, { status: 400 });
    }

    total = cartData.items.reduce((sum: number, item: any) => {
      if (item.product) {
        return sum + (item.product.price * item.quantity);
      }
      return sum;
    }, 0);

    // Generate order ID
    const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // TEMPORARILY COMMENTED OUT - Clear the cart (this completes the checkout)
    // const { clearCart } = await import('../../../lib/shopping-store');
    // clearCart(userId);
    console.log('TESTING: Cart clearing disabled - cart will remain for testing');
    
    // Clean up CIBA request if this was a CIBA-based checkout
    if (authReqId) {
      const { deleteCibaRequest } = await import('../../../lib/ciba-storage');
      deleteCibaRequest(authReqId);
      console.log('Checkout API - Cleaned up CIBA request:', authReqId);
    }

    // Return success response with order details
    return NextResponse.json({
      success: true,
      message: 'Checkout completed successfully!',
      order: {
        orderId,
        total: parseFloat(total.toFixed(2)),
        items: cartData.items.map((item: any) => {
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
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json({ 
      error: 'Checkout failed', 
      message: 'An error occurred during checkout. Please try again.' 
    }, { status: 500 });
  }
}
