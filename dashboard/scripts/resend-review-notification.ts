/**
 * Resend review notification email for episode 79 (FDE quickchat)
 * After audio was replaced with 1.07x sped-up version.
 */
import { getDb } from '@/db';
import { getGmailService } from '@/services/gmail';

async function main() {
  const db = getDb();
  const ep = db.prepare(`
    SELECT id, selected_title, segment_type, audio_path, cover_path, cover_url, description, ig_caption
    FROM episodes WHERE id = 79
  `).get() as any;

  if (!ep) {
    console.error('Episode 79 not found');
    process.exit(1);
  }

  const today = new Date().toISOString().split('T')[0];
  const coverImageUrl = ep.cover_url || `file://${ep.cover_path}`;
  const reviewUrl = `http://localhost:3000/episodes/${ep.id}/review`;
  const dashboardUrl = `http://localhost:3000/episodes`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc">
  <div style="max-width:600px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#1e293b,#334155);padding:32px;color:white">
      <div style="display:inline-block;background:#f59e0b;color:white;padding:4px 12px;border-radius:6px;font-size:13px;font-weight:600;margin-bottom:12px">懶懶碎碎念 — 審核通知</div>
      <h1 style="margin:0 0 8px;font-size:22px">${ep.selected_title}</h1>
      <p style="margin:0;opacity:0.8;font-size:13px">${today} | 音檔已加速至 1.07x</p>
    </div>
    <div style="padding:32px">
      <a href="${reviewUrl}" style="display:block;background:#1e293b;color:white;text-decoration:none;padding:16px 24px;border-radius:12px;font-size:16px;font-weight:600;text-align:center;margin-bottom:24px">
        🎧 前往審核頁面 →
      </a>

      <div style="text-align:center;margin-bottom:24px">
        <img src="${coverImageUrl}" width="300" style="border-radius:8px;max-width:100%" />
      </div>

      <div style="background:#f8fafc;padding:16px;border-radius:8px;margin-bottom:16px">
        <p style="margin:0 0 8px;font-weight:600;font-size:14px;color:#1e293b">📋 本集資訊</p>
        <p style="margin:0;font-size:13px;color:#475569">
          • 類型：懶懶碎碎念（Quickchat）<br/>
          • 長度：~19 分鐘（原 20:17 → 1.07x → ~18:57）<br/>
          • 音檔：已更新為加速版<br/>
          • 狀態：待審核
        </p>
      </div>

      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0">
        <p style="margin:0 0 4px;font-size:12px;color:#94a3b8">💡 審核建議</p>
        <p style="margin:0;font-size:12px;color:#94a3b8">
          請到 Dashboard Review 頁面聽音檔確認節奏是否合適。<br/>
          確認沒問題後可直接 Approve 發布，或要求修改腳本後重新合成。
        </p>
      </div>

      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0">
        <p style="margin:0;font-size:12px;color:#94a3b8">AI懶人報 Podcast Automation</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const gmail = getGmailService();
  await gmail.initialize();
  await gmail.sendTestEmail(
    process.env.RECIPIENT_EMAIL || '',
    `[${today}] AI懶人報：懶懶碎碎念 — FDE 轉職攻略（音檔已更新）`,
    html,
  );

  console.log('✅ Review notification email sent successfully');
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
