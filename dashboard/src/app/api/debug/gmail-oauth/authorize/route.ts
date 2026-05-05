import { NextResponse } from 'next/server';
import { google } from 'googleapis';

/** GET — Generate Google OAuth authorization URL */
export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set' },
      { status: 500 }
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${process.env.NEXTAUTH_URL || 'https://localhost:3000'}/api/debug/gmail-oauth/callback`
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.send'],
  });

  return NextResponse.json({ authUrl });
}
