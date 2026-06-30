/**
 * Generic route loading skeleton. Rendered instantly by Next's loading.tsx boundary
 * the moment a nav link is tapped, so navigation feels immediate instead of freezing
 * on the old page while the new route compiles (dev) / fetches its data.
 */
export default function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="p-4 md:p-8 animate-pulse">
      {/* PageHeader stand-in: title + brand bar */}
      <div className="flex items-center gap-2 mb-6">
        <div className="h-7 w-1 rounded bg-zinc-800" />
        <div className="h-7 w-40 bg-zinc-800 rounded" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
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
