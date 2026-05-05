import { NextResponse } from 'next/server';
import { getGmailService } from '@/services/gmail';

/** POST — Send a test email to verify Gmail OAuth works end-to-end */
export async function POST() {
  try {
    const gmail = getGmailService();
    await gmail.initialize();

    const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    const subject = `[Debug] Gmail OAuth 測試 — ${now}`;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc">
      <div style="max-width:500px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08)">
        <div style="background:linear-gradient(135deg,#1e293b,#334155);padding:24px;color:white">
          <div style="display:inline-block;background:#22c55e;color:white;padding:4px 12px;border-radius:6px;font-size:13px;font-weight:600;margin-bottom:8px">Test OK</div>
          <h1 style="margin:0;font-size:20px">Gmail OAuth 測試成功</h1>
        </div>
        <div style="padding:24px">
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px">Gmail OAuth token 正常運作，Email 發送功能可用。</p>
          <p style="color:#94a3b8;font-size:12px;margin:0">發送時間：${now}</p>
        </div>
      </div>
    </body></html>`;

    // Use sendPipelineNotification's underlying mechanism — but simpler: just send directly
    // Access the private sendEmail via a test-specific public method isn't ideal,
    // so we'll use the pipeline notification with a custom approach
    await gmail.sendTestEmail('tommyhuang0511@gmail.com', subject, html);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
