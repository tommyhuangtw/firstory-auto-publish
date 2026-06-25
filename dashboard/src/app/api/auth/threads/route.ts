import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * GET /api/auth/threads
 * Redirects user to Threads OAuth dialog.
 */
export async function GET(request: NextRequest) {
  const appId = process.env.THREADS_APP_ID;
  if (!appId) {
    return NextResponse.json(
      { error: 'THREADS_APP_ID not configured in .env.local' },
      { status: 500 },
    );
  }

  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/threads/callback`;
  const state = crypto.randomBytes(16).toString('hex');

  const threadsUrl = new URL('https://threads.net/oauth/authorize');
  threadsUrl.searchParams.set('client_id', appId);
  threadsUrl.searchParams.set('redirect_uri', redirectUri);
  threadsUrl.searchParams.set('scope', 'threads_basic,threads_content_publish,threads_manage_insights');
  threadsUrl.searchParams.set('response_type', 'code');
  threadsUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(threadsUrl.toString());
  response.cookies.set('threads_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  return response;
}
