/**
 * Stage 9: Upload Assets to Google Drive.
 *
 * Uploads audio file and cover image to Google Drive,
 * sets public sharing, and stores the URLs.
 */

import { getGoogleDriveService } from '@/services/googleDrive';
import { createChildLogger } from '@/lib/logger';
import { withRetry } from '@/lib/retry';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:upload-assets');

export async function uploadAssets(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ episodeNumber: state.episodeNumber }, 'Uploading assets to Google Drive');

  const audioFolderId = process.env.GDRIVE_PODCAST_FOLDER;
  const imageFolderId = process.env.GDRIVE_IMAGE_FOLDER;

  if (!audioFolderId && !imageFolderId) {
    log.warn('No Google Drive folder IDs configured, skipping upload');
    return { driveAudioUrl: '', driveImageUrl: '', status: 'notifying' };
  }

  const results: Partial<PipelineState> = { status: 'notifying' };

  try {
    const driveService = getGoogleDriveService();
    await driveService.initialize();

    // Upload audio
    if (state.audioPath && audioFolderId) {
      try {
        const audioResult = await withRetry(
          () => driveService.uploadFile(state.audioPath, audioFolderId, 'audio/mpeg'),
          { label: 'drive-upload-audio' },
        );
        const streamUrl = await driveService.getStreamUrl(audioResult.fileId);
        results.driveAudioUrl = streamUrl;
        log.info({ fileId: audioResult.fileId }, 'Audio uploaded to Drive');
      } catch (error) {
        log.error({ error: (error as Error).message }, 'Audio upload failed');
      }
    }

    // Upload cover image
    if (state.coverPath && imageFolderId) {
      try {
        const imageResult = await withRetry(
          () => driveService.uploadFile(state.coverPath, imageFolderId, 'image/png'),
          { label: 'drive-upload-cover' },
        );
        const streamUrl = await driveService.getStreamUrl(imageResult.fileId);
        results.driveImageUrl = streamUrl;
        log.info({ fileId: imageResult.fileId }, 'Cover image uploaded to Drive');
      } catch (error) {
        log.error({ error: (error as Error).message }, 'Image upload failed');
      }
    }
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Drive service initialization failed');
  }

  return results;
}
