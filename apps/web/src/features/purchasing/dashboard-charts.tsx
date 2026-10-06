'use client';

/** Lightweight RTL-friendly charts — no extra chart dependency. */

export function HorizontalBarList({
  rows,
  emptyLabel = 'در این بازه خریدی ثبت نشده است.',
}: {
  rows: Array<{ id: string; label: string; valueLabel: string; ratio: number; href?: string }>;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const width = `${Math.max(4, Math.min(100, row.ratio * 100))}%`;
        const inner = (
          <>
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="font-medium text-slate-800">{row.label}</span>
              <span className="font-mono text-xs tabular-nums text-slate-600" dir="ltr">
                {row.valueLabel}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-slate-100">
              <div className="h-full rounded bg-slate-700" style={{ width }} />
            </div>
          </>
        );
        return (
          <li key={row.id}>
            {row.href ? (
              <a href={row.href} className="block rounded-md hover:bg-slate-50">
                {inner}
              </a>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function SimpleTrendBars({
  points,
  emptyLabel = 'در این بازه خریدی ثبت نشده است.',
}: {
  points: Array<{ key: string; label: string; value: number; tip: string }>;
  emptyLabel?: string;
}) {
  if (points.length === 0 || points.every((p) => p.value <= 0)) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <div className="flex h-40 items-end gap-1 overflow-x-auto pb-6" dir="ltr">
      {points.map((point) => {
        const height = `${Math.max(4, (point.value / max) * 100)}%`;
        return (
          <div
            key={point.key}
            className="group relative flex min-w-[18px] flex-1 flex-col items-center justify-end"
            title={point.tip}
          >
            <div
              className="w-full max-w-[28px] rounded-t bg-slate-700 transition-colors group-hover:bg-slate-900"
              style={{ height }}
            />
            <span className="absolute -bottom-5 max-w-[48px] truncate text-[10px] text-slate-500">
              {point.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SegmentBars({
  segments,
}: {
  segments: Array<{ id: string; label: string; count: number; href?: string }>;
}) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) {
    return <p className="text-sm text-slate-500">در این بازه خریدی ثبت نشده است.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden rounded bg-slate-100" dir="ltr">
        {segments.map((seg, index) => {
          const colors = ['bg-slate-800', 'bg-sky-600', 'bg-amber-600', 'bg-emerald-700'];
          const width = `${(seg.count / total) * 100}%`;
          return (
            <div
              key={seg.id}
              className={colors[index % colors.length]}
              style={{ width }}
              title={`${seg.label}: ${seg.count}`}
            />
          );
        })}
      </div>
      <ul className="space-y-1 text-sm">
        {segments.map((seg) => (
          <li key={seg.id} className="flex justify-between gap-2">
            {seg.href ? (
              <a href={seg.href} className="underline-offset-2 hover:underline">
                {seg.label}
              </a>
            ) : (
              <span>{seg.label}</span>
            )}
            <span className="font-mono tabular-nums text-slate-600" dir="ltr">
              {seg.count} ({Math.round((seg.count / total) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
