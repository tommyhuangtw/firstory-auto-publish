import { google, Auth } from 'googleapis';
import fs from 'fs-extra';
import path from 'path';
import { createChildLogger } from './logger';

const log = createChildLogger('google-auth');

const TOKEN_DIR = path.join(process.cwd(), '..', 'temp');

interface TokenData {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

interface GoogleAuthOptions {
  service: string;
  scopes: string[];
  tokenFileName: string;
}

/**
 * Shared Google OAuth2 client factory.
 * Drive, Gmail, YouTube all share the same client credentials
 * but may use different token files and scopes.
 */
export async function createGoogleAuthClient(
  options: GoogleAuthOptions
): Promise<Auth.OAuth2Client> {
  const { service, scopes, tokenFileName } = options;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'http://localhost:8080'
  );

  const tokenPath = path.join(TOKEN_DIR, tokenFileName);

  // Auto-save on token refresh
  oauth2Client.on('tokens', (tokens) => {
    log.info({ service }, 'Token refreshed, saving');
    saveTokens(tokenPath, tokens as TokenData);
  });

  // Try loading saved tokens
  const loaded = await loadTokens(tokenPath, oauth2Client, service, scopes);

  if (!loaded) {
    throw new Error(
      `[${service}] No valid tokens found at ${tokenPath}. ` +
      `Run the original auth flow in src/ first, then tokens will be reused.`
    );
  }

  log.info({ service }, 'Auth initialized');
  return oauth2Client;
}

async function loadTokens(
  tokenPath: string,
  client: Auth.OAuth2Client,
  service: string,
  _scopes: string[]
): Promise<boolean> {
  try {
    if (!await fs.pathExists(tokenPath)) {
      log.warn({ service, tokenPath }, 'Token file not found');
      return false;
    }

    const tokens: TokenData = await fs.readJSON(tokenPath);
    client.setCredentials(tokens);

    // Check if token is expired
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      if (tokens.refresh_token) {
        log.info({ service }, 'Token expired, refreshing');
        const { credentials } = await client.refreshAccessToken();
        // Preserve refresh_token
        credentials.refresh_token = tokens.refresh_token;
        client.setCredentials(credentials);
        await saveTokens(tokenPath, credentials as TokenData);
        log.info({ service }, 'Token refreshed successfully');
        return true;
      }
      log.warn({ service }, 'Token expired and no refresh_token');
      return false;
    }

    log.info({ service }, 'Loaded saved tokens');
    return true;
  } catch (error) {
    log.error({ service, error: (error as Error).message }, 'Failed to load tokens');
    return false;
  }
}

async function saveTokens(tokenPath: string, tokens: TokenData): Promise<void> {
  try {
    await fs.ensureDir(path.dirname(tokenPath));
    await fs.writeJSON(
      tokenPath,
      {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date,
      },
      { spaces: 2 }
    );
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Failed to save tokens');
  }
}
