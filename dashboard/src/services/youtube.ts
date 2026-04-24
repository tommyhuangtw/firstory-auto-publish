import { google, youtube_v3 } from 'googleapis';
import { Auth } from 'googleapis';
import fs from 'fs-extra';
import path from 'path';
import { createGoogleAuthClient } from '@/lib/googleAuth';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('youtube');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

interface UploadVideoOptions {
  videoPath: string;
  title: string;
  description: string;
  tags?: string[];
  privacyStatus?: 'public' | 'private' | 'unlisted';
  categoryId?: string;
  thumbnailPath?: string;
}

interface UploadResult {
  videoId: string;
  videoUrl: string;
}

interface ChannelInfo {
  id: string;
  title: string;
  subscriberCount: string;
  videoCount: string;
}

export class YouTubeService {
  private yt: youtube_v3.Youtube | null = null;

  async initialize(): Promise<void> {
    const auth = await createGoogleAuthClient({
      service: 'YouTube',
      scopes: SCOPES,
      tokenFileName: 'youtube-tokens.json',
    });
    this.yt = google.youtube({ version: 'v3', auth });
    log.info('YouTube service initialized');
  }

  async initializeWithSharedAuth(oauth2Client: Auth.OAuth2Client): Promise<void> {
    try {
      this.yt = google.youtube({ version: 'v3', auth: oauth2Client });
      // Test access
      await this.yt.channels.list({ part: ['snippet'], mine: true });
      log.info('YouTube initialized with shared auth');
    } catch {
      log.warn('Shared auth lacks YouTube scopes, using dedicated auth');
      await this.initialize();
    }
  }

  private ensureYt(): youtube_v3.Youtube {
    if (!this.yt) throw new Error('YouTubeService not initialized');
    return this.yt;
  }

  async uploadVideo(options: UploadVideoOptions): Promise<UploadResult> {
    const yt = this.ensureYt();
    const {
      videoPath,
      title,
      description,
      tags = ['AI', 'podcast', 'AI tools'],
      privacyStatus = 'public',
      categoryId = '22',
      thumbnailPath,
    } = options;

    if (!await fs.pathExists(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    const fileSize = (await fs.stat(videoPath)).size;
    log.info({ title, privacyStatus, sizeMB: (fileSize / (1024 * 1024)).toFixed(1) }, 'Uploading video');

    const response = await yt.videos.insert(
      {
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title,
            description,
            tags,
            categoryId,
            defaultLanguage: 'zh-TW',
            defaultAudioLanguage: 'zh-TW',
          },
          status: {
            privacyStatus,
            selfDeclaredMadeForKids: false,
            embeddable: true,
          },
        },
        media: {
          body: fs.createReadStream(videoPath),
        },
      },
      {
        onUploadProgress: (evt) => {
          const progress = ((evt.bytesRead / fileSize) * 100).toFixed(1);
          if (Number(progress) % 10 < 1) {
            log.info({ progress: `${progress}%` }, 'Upload progress');
          }
        },
      }
    );

    const videoId = response.data.id!;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    log.info({ videoId, videoUrl }, 'Video uploaded');

    if (thumbnailPath && await fs.pathExists(thumbnailPath)) {
      await this.setThumbnail(videoId, thumbnailPath);
    }

    return { videoId, videoUrl };
  }

  async setThumbnail(videoId: string, thumbnailPath: string): Promise<void> {
    const yt = this.ensureYt();

    const stats = await fs.stat(thumbnailPath);
    if (stats.size > 2 * 1024 * 1024) {
      log.warn({ sizeMB: (stats.size / (1024 * 1024)).toFixed(2) }, 'Thumbnail exceeds 2MB, skipping');
      return;
    }

    const ext = path.extname(thumbnailPath).toLowerCase();
    const mimeType = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png';

    try {
      await yt.thumbnails.set({
        videoId,
        media: { mimeType, body: fs.createReadStream(thumbnailPath) },
      });
      log.info({ videoId }, 'Thumbnail set');
    } catch (error) {
      log.warn({ videoId, error: (error as Error).message }, 'Thumbnail upload failed (may need phone verification)');
    }
  }

  async getChannelInfo(): Promise<ChannelInfo | null> {
    const yt = this.ensureYt();

    const response = await yt.channels.list({
      part: ['snippet', 'statistics'],
      mine: true,
    });

    const channel = response.data.items?.[0];
    if (!channel) return null;

    return {
      id: channel.id!,
      title: channel.snippet!.title!,
      subscriberCount: channel.statistics!.subscriberCount!,
      videoCount: channel.statistics!.videoCount!,
    };
  }
}

// Singleton
let _instance: YouTubeService | null = null;
export function getYouTubeService(): YouTubeService {
  if (!_instance) _instance = new YouTubeService();
  return _instance;
}
