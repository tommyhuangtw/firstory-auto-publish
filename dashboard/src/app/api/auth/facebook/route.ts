import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * GET /api/auth/facebook
 * Redirects user to Facebook OAuth dialog to authorize page management.
 */
export async function GET(request: NextRequest) {
  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) {
    return NextResponse.json(
      { error: 'FACEBOOK_APP_ID not configured in .env.local' },
      { status: 500 },
    );
  }

  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/facebook/callback`;
  const state = crypto.randomBytes(16).toString('hex');

  const fbUrl = new URL('https://www.facebook.com/v22.0/dialog/oauth');
  fbUrl.searchParams.set('client_id', appId);
  fbUrl.searchParams.set('redirect_uri', redirectUri);
  fbUrl.searchParams.set('scope', 'pages_manage_posts,pages_read_engagement,pages_show_list,business_management');
  fbUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(fbUrl.toString());
  response.cookies.set('fb_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  return response;
}
