'use client';

import { useRouter } from 'next/navigation';

// Copies a manual episode's settings (URLs + custom prompt + segment) into the new-episode form.
export default function CopySettingsButton({ episodeId, variant = 'icon' }: { episodeId: number; variant?: 'icon' | 'chip' }) {
  const router = useRouter();

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault(); // prevent parent Link navigation (list rows are Links)
    e.stopPropagation();
    router.push(`/episodes?prefill=${episodeId}`);
  }

  if (variant === 'chip') {
    return (
      <button
        onClick={handleCopy}
        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 hover:text-brand hover:bg-zinc-700 transition-colors shrink-0 cursor-pointer"
        title="用這集的 URLs + 客製 prompt 重新生成"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
        </svg>
        複製設定重新生成
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md text-zinc-500 hover:text-brand hover:bg-brand/10 transition-colors cursor-pointer"
      title="複製設定重新生成"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
      </svg>
    </button>
  );
}
