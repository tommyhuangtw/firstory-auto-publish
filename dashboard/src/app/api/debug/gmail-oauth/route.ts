import { NextResponse } from 'next/server';
import fs from 'fs-extra';
import path from 'path';
import { createGoogleAuthClient } from '@/lib/googleAuth';

const TOKEN_PATH = path.join(process.cwd(), '..', 'temp', 'google-tokens.json');

interface TokenData {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
}

/** GET — Check Gmail OAuth token status */
export async function GET() {
  try {
    const exists = await fs.pathExists(TOKEN_PATH);
    if (!exists) {
      return NextResponse.json({
        exists: false,
        hasRefreshToken: false,
        expiryDate: null,
        isExpired: true,
        canRefresh: false,
      });
    }

    const tokens: TokenData = await fs.readJSON(TOKEN_PATH);
    const hasRefreshToken = !!tokens.refresh_token;
    const expiryDate = tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : null;
    const isExpired = tokens.expiry_date ? tokens.expiry_date < Date.now() : true;
    const hasCredentials = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    const canRefresh = hasRefreshToken && hasCredentials;

    return NextResponse.json({
      exists: true,
      hasRefreshToken,
      expiryDate,
      isExpired,
      canRefresh,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/** POST — Attempt to refresh the Gmail OAuth token */
export async function POST() {
  try {
    await createGoogleAuthClient({
      service: 'Gmail',
      scopes: ['https://www.googleapis.com/auth/gmail.send'],
      tokenFileName: 'google-tokens.json',
    });

    // Re-read saved token to get updated expiry
    const tokens: TokenData = await fs.readJSON(TOKEN_PATH);
    const expiryDate = tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : null;
    const isExpired = tokens.expiry_date ? tokens.expiry_date < Date.now() : true;

    return NextResponse.json({
      ok: true,
      expiryDate,
      isExpired,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
