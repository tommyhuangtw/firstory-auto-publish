import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import path from 'path';

/**
 * Status of the multi-agent orchestrator launchd schedule (separate from the node-cron jobs).
 * "enabled" reflects whether install-cron.sh has loaded the plists into ~/Library/LaunchAgents.
 */
export async function GET() {
  const home = process.env.HOME || '';
  const plistDir = path.join(home, 'Library', 'LaunchAgents');
  const jobs = ['morning', 'evening', 'execute'];
  const enabled = jobs.some((n) => existsSync(path.join(plistDir, `com.podcast.orchestrator.${n}.plist`)));

  return NextResponse.json({
    enabled,
    steps: [
      { time: '06:00', label: '老闆快報（彙整需要你拍板的事）' },
      { time: '12:00', label: '抽乾已批准佇列' },
      { time: '18:00', label: '小企提案 → 懶懶評估 → 小工執行 → 審核' },
      { time: '00:00', label: '抽乾已批准佇列' },
    ],
    enableCmd: 'bash dashboard/scripts/agents/install-cron.sh install',
  });
}
