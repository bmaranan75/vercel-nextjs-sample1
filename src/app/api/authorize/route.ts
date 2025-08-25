import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { getCibaRequest, updateCibaRequest } from '../../../lib/ciba-storage';

export async function POST(request: NextRequest) {
  try {
    // Check if user is authenticated
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { authReqId, approved } = await request.json();
    
    if (!authReqId || typeof approved !== 'boolean') {
      return NextResponse.json({ 
        success: false, 
        message: 'authReqId and approved (boolean) are required' 
      }, { status: 400 });
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

    // Update the status
    const status = approved ? 'approved' : 'denied';
    const updated = updateCibaRequest(authReqId, status);
    
    if (!updated) {
      return NextResponse.json({ 
        success: false, 
        message: 'Failed to update authorization status (may be expired)' 
      }, { status: 400 });
    }

    console.log(`Authorization ${status} by user ${session.user.sub} for request ${authReqId}`);

    return NextResponse.json({
      success: true,
      status,
      message: `Authorization ${status} successfully`
    });

  } catch (error) {
    console.error('Authorization endpoint error:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Internal server error' 
    }, { status: 500 });
  }
}
