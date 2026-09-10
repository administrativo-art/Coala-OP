import { AlertTriangle, CarFront, Clock3 } from 'lucide-react';
import { uberRecognitionView } from '@/features/financial/lib/uber-recognition';
import { cn } from '@/lib/utils';

type UberRecognitionStatusProps = {
  record: Record<string, unknown>;
  compact?: boolean;
  className?: string;
};

export function UberRecognitionStatus({ record, compact = false, className }: UberRecognitionStatusProps) {
  const view = uberRecognitionView(record);
  if (!view) return null;
  const Icon = view.status === 'matched' ? CarFront : view.status === 'ambiguous' ? AlertTriangle : Clock3;
  const styles = view.status === 'matched'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : view.status === 'ambiguous'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-sky-200 bg-sky-50 text-sky-800';
  const compactTextStyle = view.status === 'matched'
    ? 'text-emerald-700'
    : view.status === 'ambiguous'
      ? 'text-amber-700'
      : 'text-sky-700';

  if (compact) {
    return (
      <p className={cn('mt-1 flex items-center gap-1 text-[10px] font-medium', compactTextStyle, className)}>
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{view.title}</span>
      </p>
    );
  }

  return (
    <div className={cn('sm:col-span-3 flex items-start gap-2 rounded-xl border p-3', styles, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-semibold">{view.title}</p>
        {view.detail ? <p className="mt-0.5 text-[11px] opacity-80">{view.detail}</p> : null}
      </div>
    </div>
  );
}
