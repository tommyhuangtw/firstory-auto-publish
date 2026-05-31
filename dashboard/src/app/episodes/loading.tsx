export default function EpisodesLoading() {
  return (
    <div className="p-4 md:p-8 animate-pulse">
      <div className="h-8 w-32 bg-zinc-800 rounded mb-2" />
      <div className="h-4 w-20 bg-zinc-800/60 rounded mb-6" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-zinc-900/60 border border-zinc-800/60 p-4">
            <div className="flex items-center gap-3">
              <div className="h-5 w-16 bg-zinc-800 rounded" />
              <div className="h-5 w-20 bg-zinc-800/60 rounded" />
              <div className="h-5 w-16 bg-zinc-800/60 rounded" />
            </div>
            <div className="h-4 w-3/4 bg-zinc-800/40 rounded mt-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
