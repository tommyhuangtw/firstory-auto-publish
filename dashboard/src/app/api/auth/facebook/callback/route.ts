import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('fb-oauth');
const GRAPH_API = 'https://graph.facebook.com/v22.0';

/**
 * GET /api/auth/facebook/callback
 * Handles Facebook OAuth callback: exchanges code for tokens, saves Page credentials.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const origin = request.nextUrl.origin;

  // User denied permission
  if (error) {
    log.warn({ error }, 'Facebook OAuth denied');
    return NextResponse.redirect(`${origin}/settings?fb=denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/settings?fb=error&msg=missing_params`);
  }

  // Verify CSRF state
  const savedState = request.cookies.get('fb_oauth_state')?.value;
  if (!savedState || savedState !== state) {
    log.warn('CSRF state mismatch');
    return NextResponse.redirect(`${origin}/settings?fb=error&msg=csrf_mismatch`);
  }

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.redirect(`${origin}/settings?fb=error&msg=missing_config`);
  }

  const redirectUri = `${origin}/api/auth/facebook/callback`;

  try {
    // Step 1: Exchange code for short-lived user token
    const tokenUrl = new URL(`${GRAPH_API}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', appId);
    tokenUrl.searchParams.set('client_secret', appSecret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenResp = await fetch(tokenUrl.toString());
    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      log.error({ err }, 'Failed to exchange code for token');
      return NextResponse.redirect(`${origin}/settings?fb=error&msg=token_exchange_failed`);
    }
    const tokenData = await tokenResp.json();
    const shortLivedToken = tokenData.access_token;
    log.info({ tokenType: tokenData.token_type, expiresIn: tokenData.expires_in }, 'Short-lived token obtained');

    // Step 2: Exchange for long-lived user token
    const longUrl = new URL(`${GRAPH_API}/oauth/access_token`);
    longUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longUrl.searchParams.set('client_id', appId);
    longUrl.searchParams.set('client_secret', appSecret);
    longUrl.searchParams.set('fb_exchange_token', shortLivedToken);

    const longResp = await fetch(longUrl.toString());
    if (!longResp.ok) {
      const err = await longResp.text();
      log.error({ err }, 'Failed to get long-lived token');
      return NextResponse.redirect(`${origin}/settings?fb=error&msg=long_token_failed`);
    }
    const longData = await longResp.json();
    const longLivedUserToken = longData.access_token;
    log.info({ tokenType: longData.token_type, expiresIn: longData.expires_in }, 'Long-lived token obtained');

    // Debug: verify token works by fetching user info
    const meResp = await fetch(`${GRAPH_API}/me?fields=id,name&access_token=${longLivedUserToken}`);
    const meData = await meResp.json();
    log.info({ me: meData }, 'User info from token');

    // Step 3: Get pages managed by user
    const pagesResp = await fetch(
      `${GRAPH_API}/me/accounts?access_token=${longLivedUserToken}&fields=id,name,access_token`
    );
    if (!pagesResp.ok) {
      const err = await pagesResp.text();
      log.error({ err }, 'Failed to get pages');
      return NextResponse.redirect(`${origin}/settings?fb=error&msg=pages_fetch_failed`);
    }
    const pagesData = await pagesResp.json();
    log.info({ pagesResponse: JSON.stringify(pagesData) }, 'Pages API response');
    let pages = (pagesData.data || []) as { id: string; name: string; access_token: string }[];

    // Fallback 1: try short-lived token
    if (pages.length === 0) {
      log.info('No pages with long-lived token, trying short-lived token');
      const fallbackResp = await fetch(
        `${GRAPH_API}/me/accounts?access_token=${shortLivedToken}&fields=id,name,access_token`
      );
      if (fallbackResp.ok) {
        const fallbackData = await fallbackResp.json();
        log.info({ fallbackResponse: JSON.stringify(fallbackData) }, 'Pages API fallback response');
        pages = (fallbackData.data || []) as { id: string; name: string; access_token: string }[];
      }
    }

    // Fallback 2: Business Manager owned pages
    if (pages.length === 0) {
      log.info('No pages from /me/accounts, trying Business Manager API');
      const bizResp = await fetch(
        `${GRAPH_API}/me/businesses?access_token=${longLivedUserToken}&fields=id,name`
      );
      if (bizResp.ok) {
        const bizData = await bizResp.json();
        const businesses = (bizData.data || []) as { id: string; name: string }[];
        log.info({ businesses: JSON.stringify(businesses) }, 'User businesses');

        for (const biz of businesses) {
          const ownedResp = await fetch(
            `${GRAPH_API}/${biz.id}/owned_pages?access_token=${longLivedUserToken}&fields=id,name,access_token`
          );
          if (ownedResp.ok) {
            const ownedData = await ownedResp.json();
            log.info({ bizId: biz.id, bizName: biz.name, ownedPages: JSON.stringify(ownedData) }, 'Business owned pages');
            const bizPages = (ownedData.data || []) as { id: string; name: string; access_token: string }[];
            pages.push(...bizPages);
          } else {
            const err = await ownedResp.text();
            log.warn({ bizId: biz.id, err }, 'Failed to fetch owned_pages for business');
          }
        }
      } else {
        const err = await bizResp.text();
        log.warn({ err }, 'Failed to fetch /me/businesses');
      }
    }

    if (pages.length === 0) {
      log.warn({ userId: meData.id, userName: meData.name }, 'No pages found — ensure the Page is connected to this App in Business Settings');
      return NextResponse.redirect(`${origin}/settings?fb=error&msg=no_pages`);
    }

    // Use first page (or the user can pick later if multiple)
    const page = pages[0];
    log.info({ pageId: page.id, pageName: page.name, totalPages: pages.length }, 'Facebook Page connected');

    // Step 4: Save to settings
    const db = getDb();
    const upsert = db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    upsert.run('fb_page_id', page.id);
    upsert.run('fb_page_access_token', page.access_token);
    upsert.run('fb_page_name', page.name);

    // If multiple pages, store them for potential UI selection
    if (pages.length > 1) {
      upsert.run('fb_pages_list', JSON.stringify(pages.map(p => ({ id: p.id, name: p.name }))));
    }

    const response = NextResponse.redirect(`${origin}/settings?fb=connected`);
    // Clear the CSRF cookie
    response.cookies.delete('fb_oauth_state');
    return response;
  } catch (err) {
    log.error({ error: (err as Error).message }, 'Facebook OAuth callback error');
    return NextResponse.redirect(`${origin}/settings?fb=error&msg=unexpected`);
  }
}
