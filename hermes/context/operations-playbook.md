# Operations Playbook

## Daily Schedule
- Mon/Wed/Fri/Sat 11:00 — daily segment pipeline
- Thu 11:00 — robot segment pipeline
- Sun 11:00 — weekly segment pipeline

## When Pipeline Fails
1. 系統自動在 60 秒後從失敗階段重試一次
2. 如果重試也失敗，Gmail + Telegram 通知
3. 手動介入：用 pipeline_retry tool 從失敗階段重跑
4. 常見失敗原因：
   - fetchYoutube: YouTube API quota 用完 → 等隔天重設
   - generateCover: kie.ai/fal.ai 超時 → 重試通常成功
   - synthesizeTts: VoAI 超時 → 重試
   - uploadAssets: Google Drive OAuth token 過期 → 需重新授權

## When Episode Needs Review
1. Pipeline 完成後 status = pending_review
2. 在 dashboard /episodes/:id/review 頁面審核
3. 或透過 Telegram 用 episode_approve tool 直接 approve
4. Approve 後自動發布到所有平台

## When Publish Partially Fails
- 各平台獨立發布，一個失敗不影響其他
- 用 episode_republish tool 對失敗的平台重發
- SoundOn 失敗最常見原因：Playwright session 過期

## Cost Monitoring
- 用 metrics_overview tool 查看成本趨勢
- 正常每集成本 ~$0.05-0.15 USD
- 如果成本異常飆高，檢查 llm_calls 表是否有大量重試

## Hermes Branch 改善流程
1. 只能在 hermes/* branch 工作
2. 改動後必須跑 npm run build 通過
3. 不能自行 merge 到 main
4. 透過 Telegram 通知 Tommy review
