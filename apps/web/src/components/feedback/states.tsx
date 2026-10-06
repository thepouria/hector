import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils/cn';

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white px-6 py-12 text-center',
        className,
      )}
    >
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'مشکلی پیش آمد',
  message,
  requestId,
  onRetry,
}: {
  title?: string;
  message?: string;
  requestId?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-6 text-center">
      <h3 className="text-sm font-semibold text-red-800">{title}</h3>
      <p className="mt-2 text-sm text-red-700">{message ?? 'دوباره تلاش کنید.'}</p>
      {requestId ? (
        <p className="mt-2 font-mono text-xs text-red-600">requestId: {requestId}</p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          تلاش مجدد
        </Button>
      ) : null}
    </div>
  );
}

export function AccessDenied({
  message = 'شما دسترسی لازم برای مشاهده این بخش را ندارید.',
}: {
  message?: string;
}) {
  return (
    <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-8 text-center">
      <h3 className="text-sm font-semibold text-amber-900">دسترسی محدود</h3>
      <p className="mt-2 text-sm text-amber-800">{message}</p>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-7 w-48 rounded bg-slate-200" />
      <div className="h-4 w-72 rounded bg-slate-100" />
      <div className="h-40 rounded-lg bg-slate-100" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="h-10 border-b border-slate-100 bg-slate-50" />
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex h-11 items-center gap-3 border-b border-slate-50 px-4 last:border-0"
        >
          <div className="h-3 w-1/4 rounded bg-slate-100" />
          <div className="h-3 w-1/5 rounded bg-slate-100" />
          <div className="h-3 w-1/6 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export function PlaceholderModule({
  title,
  description,
  upcoming,
}: {
  title: string;
  description: string;
  upcoming: string[];
}) {
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={[{ label: 'هکتور' }, { label: title }]}
      />
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-600">
          این بخش در فاز بعدی توسعه داده می‌شود. در حال حاضر داده‌های واقعی کسب‌وکار نمایش داده
          نمی‌شود.
        </p>
        <ul className="mt-4 list-inside list-disc space-y-1 text-sm text-slate-500">
          {upcoming.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
