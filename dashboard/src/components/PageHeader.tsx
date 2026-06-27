import { ReactNode } from 'react';

/**
 * Unified page header used across all dashboard pages.
 * Standard style: text-2xl font-semibold + brand accent bar.
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
    <div className={`mb-6 flex items-start justify-between gap-3 ${className}`}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <span className="w-1 h-6 rounded-full bg-brand shrink-0" />
          {title}
        </h1>
        {subtitle && <p className="text-sm text-zinc-500 mt-1.5 ml-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
