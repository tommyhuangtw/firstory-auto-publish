import { ReactNode } from 'react';

/**
 * Unified page header used across all dashboard pages.
 * Standard style: text-2xl font-semibold + brand accent bar.
 *
 * Mobile-first: title + actions stack vertically on phones (actions wrap),
 * and sit side-by-side from `sm:` up so desktop keeps the original look.
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${className}`}
    >
      <div className="sm:shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <span className="w-1 h-6 rounded-full bg-brand shrink-0" />
          {title}
        </h1>
        {subtitle && <p className="text-sm text-zinc-500 mt-1.5 ml-3">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-wrap min-w-0">{actions}</div>
      )}
    </div>
  );
}
