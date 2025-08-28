import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { asyncCheckout } from '../../../lib/tools/async-checkout';
import { Auth0Interrupt } from '@auth0/ai/interrupts';

export const POST = async (req: NextRequest) => {
  console.log('🧪 Testing Auth0 AI directly...');
  
  try {
    const session = await getSession();
    if (!session?.user?.sub) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    console.log('🔐 Calling asyncCheckout tool directly...');
    // Call the tool function directly to test Auth0 AI wrapper
    const result = await asyncCheckout({ confirmCheckout: true });
    console.log('✅ Direct call result:', result);
    
    return NextResponse.json({ 
      success: true, 
      result,
      message: 'Auth0 AI tool executed without interrupt' 
    });
    
  } catch (error) {
    console.log('❗ Direct call error:', error);
    console.log('Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.log('Is Auth0 Interrupt?', Auth0Interrupt.isInterrupt(error));
    
    if (Auth0Interrupt.isInterrupt(error)) {
      console.log('🚨 Auth0 interrupt caught in test:', error);
      return NextResponse.json({ 
        success: false,
        interrupt: true,
        message: error.message || 'Authorization required',
        details: JSON.stringify(error, null, 2)
      });
    }
    
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error 
    }, { status: 500 });
  }
};
