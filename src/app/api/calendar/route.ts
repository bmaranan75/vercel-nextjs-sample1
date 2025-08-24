import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getSession } from '@auth0/nextjs-auth0';

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
  try {
    // Check if user is authenticated with Auth0
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const userId = session.user.sub;
    const searchParams = request.nextUrl.searchParams;
    const timeMin = searchParams.get('timeMin') || new Date().toISOString();
    const timeMax = searchParams.get('timeMax') || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days from now

    // Check if we have stored tokens for this user
    const tokens = global.googleTokens?.[userId];
    if (!tokens) {
      return NextResponse.json({ 
        error: 'Google Calendar authorization required',
        needsAuth: true,
        authUrl: `/api/auth/google?userId=${encodeURIComponent(userId)}`
      }, { status: 403 });
    }

    // Set the credentials
    oauth2Client.setCredentials(tokens);

    // Create Calendar API instance
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get calendar events
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin,
      timeMax: timeMax,
      maxResults: 20,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];

    // Format events for better readability
    const formattedEvents = events.map(event => ({
      id: event.id,
      summary: event.summary || 'No title',
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      description: event.description || '',
      location: event.location || '',
      attendees: event.attendees?.map(a => a.email) || [],
      status: event.status
    }));

    return NextResponse.json({ 
      events: formattedEvents,
      timeRange: { timeMin, timeMax }
    });

  } catch (error) {
    console.error('Google Calendar API error:', error);
    
    // If token is expired or invalid, require re-authorization
    if ((error as any)?.code === 401 || (error as any)?.code === 403) {
      const session = await getSession();
      const userId = session?.user?.sub;
      
      return NextResponse.json({
        error: 'Google Calendar authorization expired',
        needsAuth: true,
        authUrl: `/api/auth/google?userId=${encodeURIComponent(userId || '')}`
      }, { status: 403 });
    }

    return NextResponse.json({ 
      error: 'Failed to fetch calendar events',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
