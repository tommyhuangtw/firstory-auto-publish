import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import fs from 'fs-extra';
import path from 'path';

const TOKEN_PATH = path.join(process.cwd(), '..', 'temp', 'google-tokens.json');

/** GET — OAuth callback: exchange code for tokens and save */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const error = request.nextUrl.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      new URL(`/debug?oauth=error&message=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/debug?oauth=error&message=No%20code%20received', request.url)
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL('/debug?oauth=error&message=Missing%20Google%20credentials', request.url)
    );
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      `${process.env.NEXTAUTH_URL || 'https://localhost:3000'}/api/debug/gmail-oauth/callback`
    );

    const { tokens } = await oauth2Client.getToken(code);

    await fs.ensureDir(path.dirname(TOKEN_PATH));
    await fs.writeJSON(
      TOKEN_PATH,
      {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date,
      },
      { spaces: 2 }
    );

    return NextResponse.redirect(new URL('/debug?oauth=success', request.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      new URL(`/debug?oauth=error&message=${encodeURIComponent(message)}`, request.url)
    );
  }
}
