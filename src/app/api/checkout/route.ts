import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { getCibaRequest, deleteCibaRequest } from '../../../lib/ciba-storage';
import { clearCart } from '../../../lib/shopping-store';

export async function POST(request: NextRequest) {
  try {
    // Check if user is authenticated
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { authReqId } = await request.json();
    
    if (!authReqId) {
      return NextResponse.json({ error: 'authReqId is required' }, { status: 400 });
    }

    // Get the CIBA request
    const cibaRequest = getCibaRequest(authReqId);
    
    if (!cibaRequest) {
      return NextResponse.json({ 
        success: false, 
        message: 'Authorization request not found' 
      }, { status: 404 });
    }

    // Verify this is the right user
    if (cibaRequest.userId !== session.user.sub) {
      return NextResponse.json({ 
        success: false, 
        message: 'Unauthorized' 
      }, { status: 403 });
    }

    // Check if approved
    if (cibaRequest.status !== 'approved') {
      return NextResponse.json({ 
        success: false, 
        message: 'Authorization not approved' 
      }, { status: 403 });
    }

    // Process the checkout
    const orderId = 'ORDER_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const timestamp = new Date().toISOString();

    // Create order object
    const order = {
      orderId,
      userId: session.user.sub,
      items: cibaRequest.cartData.items,
      total: cibaRequest.cartData.total,
      timestamp,
      status: 'completed'
    };

    // Clear the user's cart
    clearCart(session.user.sub);
    
    // Clean up the CIBA request
    deleteCibaRequest(authReqId);

    console.log('Checkout completed:', order);

    return NextResponse.json({
      success: true,
      order,
      message: 'Checkout completed successfully'
    });

  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Internal server error' 
    }, { status: 500 });
  }
}
