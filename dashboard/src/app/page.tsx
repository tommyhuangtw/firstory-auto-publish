async function getStats() {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const [healthRes, episodesRes, pipelineRes] = await Promise.all([
      fetch(`${baseUrl}/api/health`, { cache: 'no-store' }),
      fetch(`${baseUrl}/api/episodes?limit=5`, { cache: 'no-store' }),
      fetch(`${baseUrl}/api/pipeline/status`, { cache: 'no-store' }),
    ]);
    return {
      health: await healthRes.json(),
      episodes: await episodesRes.json(),
      pipeline: await pipelineRes.json(),
    };
  } catch {
    return null;
  }
}

export default async function Dashboard() {
  const stats = await getStats();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">AI Podcast Automation</h1>
        <p className="text-zinc-400 mt-1">Dashboard — AI懶人報</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* DB Status */}
        <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Database</h2>
          <p className="text-2xl font-bold mt-2">
            {stats?.health?.db === 'connected' ? (
              <span className="text-green-400">Connected</span>
            ) : (
              <span className="text-red-400">Disconnected</span>
            )}
          </p>
          <p className="text-zinc-500 text-sm mt-1">
            {stats?.health?.tables ?? 0} tables
          </p>
        </div>

        {/* Episodes */}
        <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Episodes</h2>
          <p className="text-2xl font-bold mt-2">{stats?.episodes?.total ?? 0}</p>
          <p className="text-zinc-500 text-sm mt-1">total episodes</p>
        </div>

        {/* Pipeline */}
        <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Pipeline</h2>
          <p className="text-2xl font-bold mt-2">
            {stats?.pipeline?.runs?.length ?? 0}
          </p>
          <p className="text-zinc-500 text-sm mt-1">recent runs</p>
        </div>
      </div>

      {/* Recent Episodes */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Episodes</h2>
        {stats?.episodes?.episodes?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-400 border-b border-zinc-800">
                <th className="text-left py-2">EP#</th>
                <th className="text-left py-2">Segment</th>
                <th className="text-left py-2">Status</th>
                <th className="text-left py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {stats.episodes.episodes.map((ep: Record<string, unknown>) => (
                <tr key={ep.id as number} className="border-b border-zinc-800/50">
                  <td className="py-2">{ep.episode_number as number}</td>
                  <td className="py-2">{ep.segment_type as string}</td>
                  <td className="py-2">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-zinc-800">
                      {ep.status as string}
                    </span>
                  </td>
                  <td className="py-2 text-zinc-400">{ep.created_at as string}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-zinc-500">No episodes yet. Start a pipeline to generate your first episode.</p>
        )}
      </div>
    </div>
  );
}
