'use client';

import * as React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

export type RowAction = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

export function RowActionsMenu({ actions, label = 'اقدامات' }: { actions: RowAction[]; label?: string }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div className="relative" ref={rootRef}>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute end-0 z-20 mt-1 min-w-40 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              className={cn(
                'block w-full px-3 py-2 text-start text-sm hover:bg-slate-50 disabled:opacity-50',
                action.danger ? 'text-red-700' : 'text-slate-700',
              )}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
