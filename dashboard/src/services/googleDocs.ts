/**
 * Google Docs Reader — fetches custom content for script injection.
 *
 * Reads a Google Doc that editors can update with custom sections
 * to be injected into the podcast script.
 */

import { google } from 'googleapis';
import { createGoogleAuthClient } from '@/lib/googleAuth';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('google-docs');

/**
 * Read the text content of a Google Doc.
 * Returns empty string if document ID not configured or auth fails.
 */
export async function readCustomContent(): Promise<string> {
  const docId = process.env.GOOGLE_DOCS_CUSTOM_CONTENT_ID;
  if (!docId) {
    log.info('GOOGLE_DOCS_CUSTOM_CONTENT_ID not set, skipping');
    return '';
  }

  try {
    const auth = await createGoogleAuthClient({
      service: 'GoogleDocs',
      scopes: ['https://www.googleapis.com/auth/documents.readonly'],
      tokenFileName: 'google-tokens.json',
    });
    const docs = google.docs({ version: 'v1', auth });

    const doc = await docs.documents.get({ documentId: docId });
    const content = doc.data.body?.content || [];

    // Extract text from document elements
    let text = '';
    for (const element of content) {
      if (element.paragraph?.elements) {
        for (const el of element.paragraph.elements) {
          if (el.textRun?.content) {
            text += el.textRun.content;
          }
        }
      }
    }

    const trimmed = text.trim();
    if (trimmed) {
      log.info({ length: trimmed.length }, 'Custom content loaded from Google Docs');
    }
    return trimmed;
  } catch (error) {
    log.warn({ error: (error as Error).message }, 'Failed to read Google Doc');
    return '';
  }
}
