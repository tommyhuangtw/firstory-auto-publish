/**
 * Audio retention — local disk hygiene for episode audio.
 *
 * Episode audio is uploaded to Google Drive during the pipeline (uploadAssets).
 * The local MP3s under temp/tts accumulate (~15-25 MB each) and are only needed
 * for the review player / re-publish. This service:
 *
 *   - cleanupOldAudioFiles(): deletes local audio for episodes older than N days,
 *     but ONLY after verifying the same file exists on Drive (verify-before-delete).
 *     The DB audio_path string is left untouched so the file can be restored.
 *   - restoreAudioFile(): re-downloads a missing local audio from Drive on demand
 *     (wired into /api/audio so playback transparently pulls it back).
 */

import fs from 'fs-extra';
import path from 'path';
import { getDb } from '@/db';
import { getGoogleDriveService } from '@/services/googleDrive';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('audio-retention');

// Folder audio is uploaded to (uploadAssets uses GDRIVE_PODCAST_FOLDER).
const AUDIO_FOLDER_ID =
  process.env.GDRIVE_PODCAST_FOLDER || '1pB2PaU9BAKi0IGbIgudUEm29bgPhX1jq';

export const RETENTION_DAYS = 60;

// Only files under this dir may be deleted or restored (path-traversal guard).
const TEMP_ROOT = path.resolve(process.cwd(), '..', 'temp');

export interface CleanupResult {
  scanned: number;
  deleted: number;
  freedBytes: number;
  skippedNotOnDrive: number;
  skippedMissingLocal: number;
  errors: number;
}

function isUnderTemp(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  return resolved === TEMP_ROOT || resolved.startsWith(TEMP_ROOT + path.sep);
}

/**
 * Delete local audio for episodes older than `olderThanDays`, but only when the
 * file is confirmed present on Drive. Never deletes anything unrecoverable.
 */
export async function cleanupOldAudioFiles(
  opts: { olderThanDays?: number } = {}
): Promise<CleanupResult> {
  const days = opts.olderThanDays ?? RETENTION_DAYS;
  const result: CleanupResult = {
    scanned: 0,
    deleted: 0,
    freedBytes: 0,
    skippedNotOnDrive: 0,
    skippedMissingLocal: 0,
    errors: 0,
  };

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, audio_path FROM episodes
       WHERE audio_path IS NOT NULL AND audio_path != ''
         AND COALESCE(published_at, created_at) < datetime('now', ?)`
    )
    .all(`-${days} days`) as { id: number; audio_path: string }[];

  if (rows.length === 0) {
    log.info({ days }, 'No old audio to clean up');
    return result;
  }

  const drive = getGoogleDriveService();
  await drive.initialize();

  for (const row of rows) {
    result.scanned++;
    const absPath = path.resolve(row.audio_path);

    if (!isUnderTemp(absPath)) {
      log.warn({ episodeId: row.id, absPath }, 'Audio path outside temp, skipping');
      continue;
    }
    if (!(await fs.pathExists(absPath))) {
      result.skippedMissingLocal++;
      continue;
    }

    try {
      const name = path.basename(absPath);
      const remote = await drive.findFileByName(AUDIO_FOLDER_ID, name);
      if (!remote) {
        // Not on Drive → unrecoverable → never delete.
        result.skippedNotOnDrive++;
        log.warn({ episodeId: row.id, name }, 'Audio not found on Drive, keeping local');
        continue;
      }

      const stat = await fs.stat(absPath);
      await fs.remove(absPath);
      result.deleted++;
      result.freedBytes += stat.size;
      log.info({ episodeId: row.id, name, fileId: remote.id }, 'Local audio deleted (safe on Drive)');
    } catch (error) {
      result.errors++;
      log.error({ episodeId: row.id, error: (error as Error).message }, 'Cleanup failed for episode');
    }
  }

  log.info(result, 'Audio cleanup complete');
  return result;
}

/**
 * Ensure a local audio file exists, pulling it back from Drive if missing.
 * Returns true if the file is present (already or after restore), false if it
 * could not be recovered. Safe to call on the serve hot-path.
 */
export async function restoreAudioFile(absPath: string): Promise<boolean> {
  const resolved = path.resolve(absPath);
  if (!isUnderTemp(resolved)) return false;
  if (await fs.pathExists(resolved)) return true;

  try {
    const name = path.basename(resolved);
    const drive = getGoogleDriveService();
    await drive.initialize();
    const remote = await drive.findFileByName(AUDIO_FOLDER_ID, name);
    if (!remote) {
      log.warn({ name }, 'Restore requested but file not on Drive');
      return false;
    }
    await drive.downloadFileTo(remote.id, resolved);
    log.info({ name, fileId: remote.id }, 'Audio restored from Drive');
    return true;
  } catch (error) {
    log.error({ absPath, error: (error as Error).message }, 'Audio restore failed');
    return false;
  }
}
