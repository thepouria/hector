import Link from 'next/link';
import { cn } from '@/lib/utils/cn';

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {breadcrumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="inline-flex items-center gap-1">
                {index > 0 ? <span aria-hidden>/</span> : null}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-slate-800 hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className={cn(index === breadcrumbs.length - 1 && 'text-slate-700')}>
                    {crumb.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
