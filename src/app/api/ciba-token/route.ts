import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { getCibaRequest, updateCibaRequest, deleteCibaRequest } from '../../../lib/ciba-storage';

export async function POST(request: NextRequest) {
  try {
    const { authReqId } = await request.json();
    console.log('CIBA token POST - checking authReqId:', authReqId);
    
    const session = await getSession();
    
    if (!session?.user?.sub) {
      return NextResponse.json({ 
        error: 'Unauthorized', 
        message: 'You must be logged in to check authorization status' 
      }, { status: 401 });
    }

    if (!authReqId) {
      return NextResponse.json({ 
        error: 'Missing auth_req_id', 
        message: 'Authorization request ID is required' 
      }, { status: 400 });
    }

    // Check the CIBA request status
    const cibaRequest = getCibaRequest(authReqId);
    
    if (!cibaRequest) {
      return NextResponse.json({ 
        error: 'Invalid auth_req_id', 
        message: 'Authorization request not found or expired' 
      }, { status: 404 });
    }

    if (cibaRequest.userId !== session.user.sub) {
      return NextResponse.json({ 
        error: 'Unauthorized', 
        message: 'This authorization request does not belong to you' 
      }, { status: 403 });
    }

    // Check if request has expired (5 minutes)
    const now = Date.now();
    if (now - cibaRequest.timestamp > 5 * 60 * 1000) {
      deleteCibaRequest(authReqId);
      return NextResponse.json({ 
        error: 'Authorization expired', 
        message: 'The authorization request has expired. Please try again.' 
      }, { status: 408 });
    }

    switch (cibaRequest.status) {
      case 'pending':
        return NextResponse.json({
          status: 'authorization_pending',
          message: 'Waiting for user authorization. Please check your Auth0 Guardian app.'
        });
      
      case 'approved':
        // Don't clean up the CIBA request yet - let the checkout API handle it
        // deleteCibaRequest(authReqId);
        
        // Return access token (in real implementation, this would be from Auth0)
        return NextResponse.json({
          status: 'approved',
          access_token: `ciba_token_${authReqId}`,
          token_type: 'Bearer',
          expires_in: 3600,
          message: 'Authorization approved. You can now complete the checkout.'
        });
      
      case 'denied':
        // Clean up the CIBA request
        deleteCibaRequest(authReqId);
        
        return NextResponse.json({
          status: 'access_denied',
          error: 'access_denied',
          message: 'User denied the authorization request.'
        }, { status: 403 });
      
      default:
        return NextResponse.json({ 
          error: 'Unknown status', 
          message: 'Unknown authorization status' 
        }, { status: 500 });
    }

  } catch (error) {
    console.error('CIBA token error:', error);
    return NextResponse.json({ 
      error: 'Server error', 
      message: 'An error occurred while checking authorization status.' 
    }, { status: 500 });
  }
}

// Simulate user approval/denial (in real implementation, this would be handled by Auth0 Guardian)
export async function PUT(request: NextRequest) {
  try {
    const { authReqId, action } = await request.json(); // action: 'approve' | 'deny'
    console.log('CIBA token PUT - authReqId:', authReqId, 'action:', action);
    
    const cibaRequest = getCibaRequest(authReqId);
    
    if (!cibaRequest) {
      return NextResponse.json({ 
        error: 'Invalid auth_req_id', 
        message: 'Authorization request not found' 
      }, { status: 404 });
    }

    if (action === 'approve') {
      updateCibaRequest(authReqId, 'approved');
    } else if (action === 'deny') {
      updateCibaRequest(authReqId, 'denied');
    } else {
      return NextResponse.json({ 
        error: 'Invalid action', 
        message: 'Action must be "approve" or "deny"' 
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: `Authorization ${action}d successfully.`
    });

  } catch (error) {
    console.error('CIBA approval error:', error);
    return NextResponse.json({ 
      error: 'Server error', 
      message: 'An error occurred while processing the authorization.' 
    }, { status: 500 });
  }
}
