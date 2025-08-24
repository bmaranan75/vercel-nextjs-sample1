import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

// Extend global interface for TypeScript
declare global {
  var googleTokens: Record<string, any> | undefined;
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // This contains the user ID
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/auth-success?type=google&error=denied', request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/auth-success?type=google&error=failed', request.url));
  }

  try {
    // Exchange the authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    // Store the tokens temporarily (in a real app, you'd store this in a database)
    // For this demo, we'll store it in a simple in-memory store
    global.googleTokens = global.googleTokens || {};
    global.googleTokens[state] = tokens;

    return NextResponse.redirect(new URL('/auth-success?type=google', request.url));
  } catch (error) {
    console.error('Error exchanging code for tokens:', error);
    return NextResponse.redirect(new URL('/auth-success?type=google&error=failed', request.url));
  }
}
