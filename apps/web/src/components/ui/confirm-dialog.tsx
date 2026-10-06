'use client';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  target?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  target,
  confirmLabel,
  cancelLabel = 'انصراف',
  danger = false,
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
    >
      {target ? (
        <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          {target}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => onOpenChange(false)}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? 'danger' : 'default'}
          disabled={loading}
          onClick={onConfirm}
        >
          {loading ? 'در حال انجام...' : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
