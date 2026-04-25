import { getDb } from '@/db';

export const dynamic = 'force-dynamic';

export default function Dashboard() {
  const db = getDb();

  const tableCount = (db.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as { c: number }).c;
  const episodeCount = (db.prepare('SELECT count(*) as c FROM episodes').get() as { c: number }).c;
  const recentRuns = db.prepare(`SELECT count(*) as c FROM pipeline_runs WHERE started_at > datetime('now', '-7 days')`).get() as { c: number };
  const episodes = db.prepare(
    'SELECT id, episode_number, segment_type, status, created_at FROM episodes ORDER BY created_at DESC LIMIT 5'
  ).all() as { id: number; episode_number: number; segment_type: string; status: string; created_at: string }[];

  return (
    <div className="p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">AI Podcast Automation</h1>
        <p className="text-zinc-300 mt-1">Dashboard — AI懶人報</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* DB Status */}
        <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Database</h2>
          <p className="text-2xl font-bold mt-2">
            <span className="text-green-400">Connected</span>
          </p>
          <p className="text-zinc-400 text-sm mt-1">{tableCount} tables</p>
        </div>

        {/* Episodes */}
        <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Episodes</h2>
          <p className="text-2xl font-bold mt-2">{episodeCount}</p>
          <p className="text-zinc-400 text-sm mt-1">total episodes</p>
        </div>

        {/* Pipeline */}
        <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Pipeline</h2>
          <p className="text-2xl font-bold mt-2">{recentRuns.c}</p>
          <p className="text-zinc-400 text-sm mt-1">recent runs (7d)</p>
        </div>
      </div>

      {/* Recent Episodes */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Episodes</h2>
        {episodes.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-300 border-b border-zinc-800">
                <th className="text-left py-2">EP#</th>
                <th className="text-left py-2">Segment</th>
                <th className="text-left py-2">Status</th>
                <th className="text-left py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((ep) => (
                <tr key={ep.id} className="border-b border-zinc-800/50">
                  <td className="py-2">{ep.episode_number}</td>
                  <td className="py-2">{ep.segment_type}</td>
                  <td className="py-2">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-zinc-800">
                      {ep.status}
                    </span>
                  </td>
                  <td className="py-2 text-zinc-300">{ep.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-zinc-400">No episodes yet. Start a pipeline to generate your first episode.</p>
        )}
      </div>
    </div>
  );
}
