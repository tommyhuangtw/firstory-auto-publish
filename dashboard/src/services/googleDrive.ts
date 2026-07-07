import { google, drive_v3 } from 'googleapis';
import fs from 'fs-extra';
import path from 'path';
import { createGoogleAuthClient } from '@/lib/googleAuth';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('google-drive');

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

// Folder IDs
const COVER_FOLDER_ID = '1BCSiZXS8aGnMdOnfJfAbwgitFfliVbQ-';
const AUDIO_FOLDER_ID = '1pB2PaU9BAKi0IGbIgudUEm29bgPhX1jq';

const TEMP_DIR = path.join(process.cwd(), '..', 'temp');

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
}

interface DownloadResult {
  path: string;
  originalName: string;
  fileId: string;
}

export class GoogleDriveService {
  private drive: drive_v3.Drive | null = null;

  async initialize(): Promise<void> {
    const auth = await createGoogleAuthClient({
      service: 'GoogleDrive',
      scopes: SCOPES,
      tokenFileName: 'google-tokens.json',
    });
    this.drive = google.drive({ version: 'v3', auth });
    log.info('Google Drive service initialized');
  }

  private ensureDrive(): drive_v3.Drive {
    if (!this.drive) throw new Error('GoogleDriveService not initialized');
    return this.drive;
  }

  async getLatestFileFromFolder(
    folderId: string,
    fileTypes: string[] = []
  ): Promise<DriveFile> {
    const drive = this.ensureDrive();

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      orderBy: 'modifiedTime desc',
      fields: 'files(id, name, mimeType, modifiedTime, size)',
      pageSize: 20,
    });

    const files = response.data.files as DriveFile[] | undefined;
    if (!files || files.length === 0) {
      throw new Error(`No files found in folder ${folderId}`);
    }

    let filtered = files;
    if (fileTypes.length > 0) {
      const matched = files.filter((f) =>
        fileTypes.some((t) => f.mimeType?.includes(t))
      );
      if (matched.length > 0) filtered = matched;
    }

    const latest = filtered[0];
    log.info({ name: latest.name, mimeType: latest.mimeType }, 'Selected latest file');
    return latest;
  }

  async downloadFile(fileId: string, fileName: string): Promise<string> {
    const drive = this.ensureDrive();
    await fs.ensureDir(TEMP_DIR);

    const filePath = path.join(TEMP_DIR, fileName);

    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    const writeStream = fs.createWriteStream(filePath);

    return new Promise((resolve, reject) => {
      (response.data as NodeJS.ReadableStream)
        .pipe(writeStream)
        .on('finish', () => {
          log.info({ filePath }, 'File downloaded');
          resolve(filePath);
        })
        .on('error', reject);
    });
  }

  /**
   * Find a file by exact name within a folder. Returns null if not found.
   * Used to verify an asset exists on Drive before deleting the local copy,
   * and to locate it for on-demand restore.
   */
  async findFileByName(folderId: string, name: string): Promise<DriveFile | null> {
    const drive = this.ensureDrive();
    const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    const response = await drive.files.list({
      q: `name = '${escaped}' and '${folderId}' in parents and trashed = false`,
      orderBy: 'modifiedTime desc',
      fields: 'files(id, name, mimeType, modifiedTime, size)',
      pageSize: 5,
    });

    const files = response.data.files as DriveFile[] | undefined;
    if (!files || files.length === 0) return null;
    return files[0];
  }

  /** Download a file to an explicit destination path (creates parent dirs). */
  async downloadFileTo(fileId: string, destPath: string): Promise<string> {
    const drive = this.ensureDrive();
    await fs.ensureDir(path.dirname(destPath));

    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    const writeStream = fs.createWriteStream(destPath);

    return new Promise((resolve, reject) => {
      (response.data as NodeJS.ReadableStream)
        .pipe(writeStream)
        .on('finish', () => {
          log.info({ destPath }, 'File downloaded to path');
          resolve(destPath);
        })
        .on('error', reject);
    });
  }

  async downloadLatestAudio(): Promise<DownloadResult> {
    const file = await this.getLatestFileFromFolder(AUDIO_FOLDER_ID, ['audio']);
    const filePath = await this.downloadFile(file.id, file.name);
    return { path: filePath, originalName: file.name, fileId: file.id };
  }

  async downloadLatestCover(): Promise<DownloadResult> {
    const file = await this.getLatestFileFromFolder(COVER_FOLDER_ID, ['image']);
    const filePath = await this.downloadFile(file.id, file.name);
    return { path: filePath, originalName: file.name, fileId: file.id };
  }

  async uploadFile(
    filePath: string,
    folderId: string,
    mimeType?: string
  ): Promise<{ fileId: string; webViewLink: string }> {
    const drive = this.ensureDrive();
    const fileName = path.basename(filePath);

    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType: mimeType || 'application/octet-stream',
        body: fs.createReadStream(filePath),
      },
      fields: 'id, webViewLink',
    });

    const fileId = response.data.id!;

    // Make publicly accessible
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    const webViewLink = response.data.webViewLink || '';
    log.info({ fileId, fileName }, 'File uploaded to Drive');
    return { fileId, webViewLink };
  }

  async getStreamUrl(fileId: string): Promise<string> {
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  async cleanupTemp(): Promise<void> {
    try {
      await fs.emptyDir(TEMP_DIR);
    } catch (error) {
      log.error({ error: (error as Error).message }, 'Cleanup temp failed');
    }
  }
}

// Singleton
let _instance: GoogleDriveService | null = null;
export function getGoogleDriveService(): GoogleDriveService {
  if (!_instance) _instance = new GoogleDriveService();
  return _instance;
}
