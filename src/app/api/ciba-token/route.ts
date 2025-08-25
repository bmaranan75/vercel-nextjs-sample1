import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { getCibaRequest, updateCibaRequestStatus, deleteCibaRequest } from '../../../lib/ciba-storage';

export async function POST(request: NextRequest) {
  try {
    const { authReqId } = await request.json();
    
    if (!authReqId) {
      return NextResponse.json({ error: 'authReqId is required' }, { status: 400 });
    }

    // Get the CIBA request
    const cibaRequest = getCibaRequest(authReqId);
    
    if (!cibaRequest) {
      return NextResponse.json({ error: 'Authorization request not found' }, { status: 404 });
    }

    // Check if expired
    if (cibaRequest.status === 'expired') {
      return NextResponse.json({ error: 'Authorization request expired' }, { status: 408 });
    }

    // Check current status
    if (cibaRequest.status === 'approved') {
      // Generate a mock access token
      const accessToken = 'mock_access_token_' + Math.random().toString(36).substr(2, 9);
      return NextResponse.json({
        status: 'approved',
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600
      });
    }

    if (cibaRequest.status === 'denied') {
      deleteCibaRequest(authReqId);
      return NextResponse.json({ status: 'access_denied' }, { status: 403 });
    }

    // Still pending
    return NextResponse.json({ status: 'authorization_pending' });

  } catch (error) {
    console.error('CIBA token endpoint error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
