export default function ReviewLoading() {
  return (
    <div className="p-4 md:p-8 animate-pulse">
      {/* Header skeleton */}
      <div className="h-5 w-24 bg-zinc-800 rounded mb-4" />
      <div className="h-8 w-3/4 bg-zinc-800 rounded mb-2" />
      <div className="h-4 w-1/2 bg-zinc-800/60 rounded mb-6" />

      {/* Cover + Audio skeleton */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="w-full sm:w-40 aspect-square bg-zinc-800 rounded-xl" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-16 bg-zinc-800 rounded" />
          <div className="h-12 bg-zinc-800 rounded-lg" />
          <div className="flex gap-2">
            <div className="h-8 w-16 bg-zinc-800 rounded-lg" />
            <div className="h-8 w-16 bg-zinc-800 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Title section skeleton */}
      <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-5 space-y-3">
        <div className="h-5 w-20 bg-zinc-800 rounded" />
        <div className="space-y-2">
          <div className="h-10 bg-zinc-800/60 rounded-lg" />
          <div className="h-10 bg-zinc-800/60 rounded-lg" />
          <div className="h-10 bg-zinc-800/60 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
