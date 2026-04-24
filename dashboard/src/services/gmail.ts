import { google, gmail_v1 } from 'googleapis';
import { createGoogleAuthClient } from '@/lib/googleAuth';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('gmail');

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

interface TitleEmailParams {
  candidateTitles: string[];
  description: string;
  episodeNumber: number;
  baseUrl: string;
}

interface ThumbnailOption {
  label: string;
  imageBase64?: string;
  imageUrl?: string;
}

interface ThumbnailEmailParams {
  thumbnailOptions: ThumbnailOption[];
  episodeTitle: string;
  episodeNumber: number;
  baseUrl: string;
}

export class GmailService {
  private gmail: gmail_v1.Gmail | null = null;

  async initialize(): Promise<void> {
    const auth = await createGoogleAuthClient({
      service: 'Gmail',
      scopes: SCOPES,
      tokenFileName: 'google-tokens.json',
    });
    this.gmail = google.gmail({ version: 'v1', auth });
    log.info('Gmail service initialized');
  }

  private ensureGmail(): gmail_v1.Gmail {
    if (!this.gmail) throw new Error('GmailService not initialized');
    return this.gmail;
  }

  async sendTitleConfirmationEmail(params: TitleEmailParams): Promise<void> {
    const gmail = this.ensureGmail();
    const recipientEmail = process.env.RECIPIENT_EMAIL;
    if (!recipientEmail) throw new Error('RECIPIENT_EMAIL not set');

    const { candidateTitles, description, episodeNumber, baseUrl } = params;
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    const subject = `EP${episodeNumber} - ${month}/${day} AI title selection`;
    const body = this.buildTitleEmailHTML(candidateTitles, description, episodeNumber, baseUrl, month, day);

    await this.sendEmail(gmail, recipientEmail, subject, body);
    log.info({ recipientEmail, episodeNumber }, 'Title confirmation email sent');
  }

  async sendThumbnailSelectionEmail(params: ThumbnailEmailParams): Promise<void> {
    const gmail = this.ensureGmail();
    const recipientEmail = process.env.RECIPIENT_EMAIL;
    if (!recipientEmail) throw new Error('RECIPIENT_EMAIL not set');

    const { thumbnailOptions, episodeTitle, episodeNumber, baseUrl } = params;
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    const subject = `EP${episodeNumber} - ${month}/${day} YouTube thumbnail selection`;
    const body = this.buildThumbnailEmailHTML(thumbnailOptions, episodeTitle, episodeNumber, baseUrl, month, day);

    await this.sendEmail(gmail, recipientEmail, subject, body);
    log.info({ recipientEmail, episodeNumber }, 'Thumbnail selection email sent');
  }

  private async sendEmail(
    gmail: gmail_v1.Gmail,
    to: string,
    subject: string,
    htmlBody: string
  ): Promise<void> {
    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;

    const message = [
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(htmlBody).toString('base64'),
    ].join('\n');

    const raw = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
  }

  private buildTitleEmailHTML(
    titles: string[],
    description: string,
    episodeNumber: number,
    baseUrl: string,
    month: number,
    day: number
  ): string {
    const titleButtons = titles
      .map(
        (title, i) => `
      <div style="margin:15px 0">
        <a href="${baseUrl}/api/episodes/${episodeNumber}/select-title?index=${i}"
           style="display:block;background:white;color:#1e293b;padding:20px;
                  text-decoration:none;border-radius:12px;border:2px solid #e2e8f0;
                  font-weight:600;font-size:16px;text-align:center;
                  box-shadow:0 2px 4px rgba(0,0,0,0.1)">
          ${title}
        </a>
      </div>`
      )
      .join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
    <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)">
      <div style="max-width:600px;margin:0 auto;padding:40px 20px">
        <div style="text-align:center;margin-bottom:40px">
          <h1 style="color:white;font-size:28px;margin:0 0 10px">EP${episodeNumber} Title Selection</h1>
          <p style="color:rgba(255,255,255,0.9);font-size:16px;margin:0">${month}/${day}</p>
        </div>
        <div style="background:rgba(255,255,255,0.95);border-radius:20px;padding:40px;box-shadow:0 20px 40px rgba(0,0,0,0.1)">
          <div style="background:#f1f5f9;border-radius:12px;padding:20px;margin-bottom:30px">
            <h3 style="color:#1e293b;font-size:16px;margin:0 0 10px">Content Summary</h3>
            <p style="color:#475569;font-size:14px;line-height:1.6;margin:0">${description || 'AI news digest'}</p>
          </div>
          <h3 style="color:#1e293b;font-size:18px;text-align:center;margin:0 0 20px">Select a Title</h3>
          ${titleButtons}
        </div>
      </div>
    </body></html>`;
  }

  private buildThumbnailEmailHTML(
    options: ThumbnailOption[],
    episodeTitle: string,
    episodeNumber: number,
    baseUrl: string,
    month: number,
    day: number
  ): string {
    const cards = options
      .map(
        (opt, i) => `
      <div style="margin:20px 0">
        <a href="${baseUrl}/api/episodes/${episodeNumber}/select-thumbnail?index=${i}"
           style="display:block;text-decoration:none;border-radius:12px;overflow:hidden;
                  border:3px solid #e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,0.08)">
          ${opt.imageBase64 ? `<img src="data:image/png;base64,${opt.imageBase64}" style="width:100%;display:block"/>` : ''}
          <div style="background:white;padding:16px 20px;display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:16px;font-weight:700;color:#1e293b">Option ${i + 1}: ${opt.label}</span>
            <span style="background:#e8c66a;color:#2c2417;padding:8px 20px;border-radius:8px;font-size:14px;font-weight:700">Select</span>
          </div>
        </a>
      </div>`
      )
      .join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
    <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#e8c66a 0%,#d4a44a 100%)">
      <div style="max-width:680px;margin:0 auto;padding:40px 20px">
        <div style="text-align:center;margin-bottom:40px">
          <h1 style="color:white;font-size:28px;margin:0 0 10px">EP${episodeNumber} Thumbnail Selection</h1>
          <p style="color:rgba(255,255,255,0.9);font-size:16px;margin:0">${month}/${day}</p>
        </div>
        <div style="background:rgba(255,255,255,0.97);border-radius:20px;padding:36px;box-shadow:0 20px 40px rgba(0,0,0,0.1)">
          <div style="background:#f8f6f2;border-radius:12px;padding:18px 24px;margin-bottom:28px">
            <div style="font-size:13px;color:#999;margin-bottom:6px;font-weight:600">Selected Title</div>
            <div style="font-size:17px;color:#1e293b;font-weight:700">${episodeTitle}</div>
          </div>
          ${cards}
        </div>
      </div>
    </body></html>`;
  }
}

// Singleton
let _instance: GmailService | null = null;
export function getGmailService(): GmailService {
  if (!_instance) _instance = new GmailService();
  return _instance;
}
