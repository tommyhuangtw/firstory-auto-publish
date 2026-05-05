import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('threads-oauth');
const THREADS_API = 'https://graph.threads.net';

/**
 * GET /api/auth/threads/callback
 * Handles Threads OAuth callback: exchanges code for tokens, saves credentials.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const origin = request.nextUrl.origin;

  if (error) {
    log.warn({ error }, 'Threads OAuth denied');
    return NextResponse.redirect(`${origin}/settings?threads=denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/settings?threads=error&msg=missing_params`);
  }

  // Verify CSRF state
  const savedState = request.cookies.get('threads_oauth_state')?.value;
  if (!savedState || savedState !== state) {
    log.warn('CSRF state mismatch');
    return NextResponse.redirect(`${origin}/settings?threads=error&msg=csrf_mismatch`);
  }

  const appId = process.env.THREADS_APP_ID;
  const appSecret = process.env.THREADS_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.redirect(`${origin}/settings?threads=error&msg=missing_config`);
  }

  const redirectUri = `${origin}/api/auth/threads/callback`;

  try {
    // Step 1: Exchange code for short-lived token
    const tokenResp = await fetch(`${THREADS_API}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      log.error({ err }, 'Failed to exchange code for token');
      return NextResponse.redirect(`${origin}/settings?threads=error&msg=token_exchange_failed`);
    }
    const tokenData = await tokenResp.json();
    const shortLivedToken = tokenData.access_token;
    const userId = tokenData.user_id;
    log.info({ userId }, 'Short-lived token obtained');

    // Step 2: Exchange for long-lived token
    const longUrl = new URL(`${THREADS_API}/access_token`);
    longUrl.searchParams.set('grant_type', 'th_exchange_token');
    longUrl.searchParams.set('client_secret', appSecret);
    longUrl.searchParams.set('access_token', shortLivedToken);

    const longResp = await fetch(longUrl.toString());
    if (!longResp.ok) {
      const err = await longResp.text();
      log.error({ err }, 'Failed to get long-lived token');
      return NextResponse.redirect(`${origin}/settings?threads=error&msg=long_token_failed`);
    }
    const longData = await longResp.json();
    const longLivedToken = longData.access_token;
    log.info({ expiresIn: longData.expires_in }, 'Long-lived token obtained');

    // Step 3: Get user profile
    const meResp = await fetch(
      `${THREADS_API}/v1.0/me?fields=id,username&access_token=${longLivedToken}`
    );
    let username = '';
    if (meResp.ok) {
      const meData = await meResp.json();
      username = meData.username || '';
      log.info({ userId: meData.id, username }, 'Threads user info');
    }

    // Step 4: Save to settings
    const db = getDb();
    const upsert = db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    upsert.run('threads_user_id', String(userId));
    upsert.run('threads_access_token', longLivedToken);
    if (username) upsert.run('threads_username', username);

    log.info({ userId, username }, 'Threads connected');

    const response = NextResponse.redirect(`${origin}/settings?threads=connected`);
    response.cookies.delete('threads_oauth_state');
    return response;
  } catch (err) {
    log.error({ error: (err as Error).message }, 'Threads OAuth callback error');
    return NextResponse.redirect(`${origin}/settings?threads=error&msg=unexpected`);
  }
}
