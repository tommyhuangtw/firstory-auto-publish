#!/usr/bin/env npx tsx
/**
 * Seed Agent Memory — populates initial memories for all 3 agents.
 * Run once to bootstrap, then agents accumulate their own memories via LSM compaction.
 *
 * Usage: cd dashboard && npx tsx scripts/agents/seed-memory.ts
 */

import { getDb } from '@/db';

function seed(agentId: string, memoryType: string, topic: string, summary: string) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO agent_memory (agent_id, memory_type, topic, current_summary, summary_version, last_updated)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
  `).run(agentId, memoryType, topic, summary);
}

// ── 小企 (Planner) — Content Strategist ──────────────────────────────

seed('planner', 'context', '品牌定位',
  'AI 懶人報：幫忙碌的專業人士用最短時間掌握 AI 最新動態。定位是「像咖啡廳跟朋友聊天一樣輕鬆分享 AI 秘密」。受眾：創業者、開發者、行銷人、設計師。語言：繁體中文 + 英文技術名詞。');

seed('planner', 'context', '內容策略',
  '目前有 4 種 segment：daily（每日 AI 工具精選 3-5 個）、weekly（每週深度分析 + 趨勢觀察）、robot（機器人觀察週報：Tesla Bot、Figure、Boston Dynamics）、sysdesign（系統設計懶懶學：深度技術用白話講）。發布節奏：週一三五六 11am daily、週四 11am robot、週日 11am weekly。');

seed('planner', 'context', '競品清單',
  '同類 AI 內容頻道：Fireship（YouTube, 英文, 快節奏 AI/Dev news）、Matt Wolfe（YouTube, AI Tools weekly）、The AI Advantage（YouTube, tutorials）、台灣 AI 相關 podcast 需要持續觀察。關注指標：選題方向、format、engagement。');

seed('planner', 'context', '資訊來源',
  '主要資訊管道：YouTube（AI channels, Google/OpenAI/Anthropic 官方）、X/Twitter（@kaborando, @AndrewYNg, @ylecun, @sama）、Reddit（r/LocalLLaMA, r/MachineLearning）、Hacker News、Product Hunt。趨勢偵測：關注新模型發布、融資消息、重大產品更新。');

seed('planner', 'context', '受眾分析',
  '目前聽眾主要在台灣，科技業背景居多。SoundOn 下載數穩定成長，YouTube 訂閱持續增加。受眾痛點：AI 資訊太多看不完、不知道哪些工具值得用、想知道 AI 對自己工作的影響。高 engagement 主題：實用工具評測、重大模型發布分析、AI 對職場的影響。');

seed('planner', 'pattern', '受眾偏好',
  '受眾反應好的內容特徵：1) 有明確 actionable takeaway 2) 用台灣人熟悉的情境舉例 3) 標題有數字或對比 4) 講到 cost/pricing 比較特別受歡迎 5) 爭議性話題（AI 取代 XX）engagement 高但要小心品質。');

seed('planner', 'context', '成長目標',
  '短期目標：維持科技榜前 3、每集穩定 300+ 下載。中期目標：YouTube 訂閱破萬、開始有穩定業配收入。長期願景：成為華語圈最受信賴的 AI 資訊來源，幫助更多人降低 AI 焦慮、找到適合自己的 AI 工具。');

// ── 小工 (Engineer) — Senior Engineer ────────────────────────────────

seed('engineer', 'context', '架構概覽',
  '系統核心：Next.js 14 + TypeScript + LangGraph + SQLite (WAL mode)。主目錄：dashboard/。13-stage linear pipeline（fetchYoutube → ... → publish）。Pipeline 暫停在 pending_review 等人工審核。每個 node 存 snapshot 到 DB 支援 retryFromStage()。');

seed('engineer', 'context', '技術棧',
  'Frontend: Next.js 14 App Router + Tailwind CSS v4 + Recharts。Backend: API Routes + SQLite (better-sqlite3)。Pipeline: LangGraph state machine。TTS: VoAI API。圖片：kie.ai (GPT Image 2) + FalAI fallback。影片：FFmpeg composite + 字幕燒錄。發布：SoundOn (Playwright), YouTube (API), IG/FB/Threads (Graph API)。');

seed('engineer', 'context', 'DB Schema',
  '24+ tables：episodes, pipeline_runs, pipeline_snapshots, llm_calls, service_costs, tools, tool_families, episode_tool_mentions, youtube_sources (3 種), shorts, settings, ad_presets, sponsor_audio_presets, soundon_daily_downloads, soundon_episodes, tasks, task_comments, knowledge_docs, content_summaries, agent_discussions, agent_proposals, alerts, agent_memory。');

seed('engineer', 'context', '關鍵服務',
  'llmService（OpenRouter LLM, 自動 cost tracking）、soundon（Playwright 自動化上傳）、videoCreator（FFmpeg 影片+字幕）、thumbnailGenerator（Playwright HTML→JPEG）、subtitleGenerator（Whisper+腳本對齊+SRT）、memory/*（工具記憶系統 LSM compaction）、notificationHub（事件派發）、knowledgeService（research doc 管理）。');

seed('engineer', 'lesson', '已知地雷',
  '1) Claude Code CLI 會在執行中切換 branch，完成後要驗證 branch 狀態。2) git add -A 在 branch 不對時會失敗。3) npm run build 是必要驗證步驟，不能跳過。4) 中文檔名 regex 要用 \\u4e00-\\u9fff。5) BASE_URL 要用 http 不是 https（localhost）。');

seed('engineer', 'lesson', 'Build 常見問題',
  'Next.js build 常見問題：1) dynamic import 的 module 不存在時只會 warning 不會 fail。2) Tailwind v4 用 @plugin 不是 @import。3) better-sqlite3 是 native module，build 時可能需要 rebuild。4) 新增 page 要確認 layout.tsx 有正確 wrap。');

seed('engineer', 'context', 'AI Agent Patterns',
  '業界 multi-agent 趨勢：1) Supervisor pattern（一個 PM agent 分配任務給 worker agents）。2) Memory management 是最大挑戰（context window 有限）。3) LSM-tree compaction 用於長期記憶壓縮。4) Honest Engineering：agent 應該承認不確定性，不要編造答案。5) Tool Use patterns：每個 agent 應有明確的 tool set boundary。');

seed('engineer', 'pattern', 'Code Review 經驗',
  'auto-executor 過去的問題：1) false completion（沒寫 code 就標 review）→ 加了 zero-output gate。2) max turns hit 但沒偵測到 → 加了 output string match。3) 沒有 build verification 就過 → 加了 npm run build check。結論：每個 gate 都要有明確的 pass/fail 判定。');

seed('engineer', 'context', 'Git 工作流',
  'Feature branch pattern：feat/task-{id}-{slug}。只能在 feature branch 上工作，不能直接改 main。Commit message 英文、不加 Co-Authored-By。完成後移到 review 等 Tommy approve。Claude Code CLI 用 --dangerously-skip-permissions flag。');

// ── 懶懶 (PM) — Orchestrator ────────────────────────────────────────

seed('pm', 'preference', 'Tommy 偏好',
  'Tommy 的風格：1) 繁體中文文件和 UI。2) Dark mode UI。3) 簡單直接，不要 over-engineer。4) 先做 MVP 再迭代。5) 有 measurable outcome 的東西才值得做。6) 重視 FDE career portfolio value。7) 一人團隊所以不想搞太複雜。');

seed('pm', 'context', '資源限制',
  '團隊：Tommy 一個人 + AI agents。預算：Claude Max subscription（有 usage limit）、OpenRouter API credits。時間：Tommy 白天有其他工作，晚上和週末處理 podcast。限制：每次 orchestrator run 最多 3 個 tasks、每 task 最多 50 turns。');

seed('pm', 'context', '品牌願景',
  '核心目標：1) 觸及更多受眾，幫助更多人降低 AI 焦慮。2) 建立自動化產線讓一人團隊也能高品質高頻率產出。3) Portfolio value — 展示 AI engineering 能力給未來 FDE 工作。4) 長期建立華語圈最受信賴的 AI 資訊來源。');

seed('pm', 'pattern', '決策原則',
  '優先順序判斷：1) 會影響聽眾體驗的 > 內部流程優化。2) 有數據支持的 > 憑感覺的。3) 小改動大效果的 > 大工程小效果的。4) research 類通常可以直接 approve。5) infra 改動要謹慎，確認不會 break 現有流程。6) 新 feature 先問 Tommy 意見。');

seed('pm', 'pattern', '提案評估標準',
  '好提案的特徵：1) 有明確的問題陳述。2) 有具體的解決方案（不只是「改善 XX」）。3) 可以用 1-2 張 ticket 完成。4) 有可衡量的 success criteria。壞提案：模糊的方向性建議、需要大規模重構但沒有明確 ROI、已經有類似的 in_progress task。');

seed('pm', 'lesson', '過去決策經驗',
  '經驗累積：1) auto-executor 第一版太粗糙（false completion）→ 加了多重 gate。2) 6-agent 提案被簡化成 3-agent MVP → Tommy 重視務實。3) Knowledge Base 做了就很有用（research 成果可視化）。4) 中文化是正確方向（Tommy 看中文快）。');

seed('pm', 'context', '團隊角色分工',
  '3-agent 架構：懶懶（PM/Orchestrator, 統籌決策不動手）→ 小企（Content Strategist, 主動提案+research）→ 小工（Senior Engineer, 實作+build+review）。三方都可主動提案，懶懶做最終決策。需要 Tommy input 時用 Alert + Telegram。');

// ── Done ─────────────────────────────────────────────────────────────
const db = getDb();
const count = (db.prepare('SELECT COUNT(*) as c FROM agent_memory').get() as { c: number }).c;
console.log(`✅ Agent memory seeded: ${count} total memories`);
