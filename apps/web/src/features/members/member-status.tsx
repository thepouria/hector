import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';

const MEMBER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'فعال',
  SUSPENDED: 'تعلیق‌شده',
  REMOVED: 'حذف‌شده',
};

export function memberStatusLabel(status: string): string {
  return MEMBER_STATUS_LABELS[status] ?? status;
}

export function MemberStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      className={cn(
        status === 'ACTIVE' && 'border-slate-300 bg-white text-slate-800',
        status === 'SUSPENDED' && 'border-amber-200 bg-amber-50 text-amber-900',
        status === 'REMOVED' && 'border-slate-200 bg-slate-100 text-slate-600',
      )}
    >
      <span className="me-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {memberStatusLabel(status)}
    </Badge>
  );
}
