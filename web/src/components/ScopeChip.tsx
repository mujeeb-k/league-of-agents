// A scope chip: a file or folder a run is limited to, or a note such as "Whole repository".
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  label: string;
  title?: string;
  /** "scope" for selected files and folders (purple tint), "neutral" for notes, "stale" for selected lines that changed. */
  tone?: 'scope' | 'neutral' | 'stale';
  className?: string;
  onRemove?: () => void;
  removeLabel?: string;
  /** Data attributes for the remove button. */
  removeData?: Record<`data-${string}`, string | number>;
};

export function ScopeChip({ label, title, tone = 'scope', className, onRemove, removeLabel, removeData }: Props) {
  return (
    <span
      title={title}
      className={cn(
        'chip inline-flex h-6 max-w-full items-center gap-1 rounded-md pl-2 font-mono text-xs',
        tone === 'scope'
          ? 'bg-sel-soft text-foreground'
          : tone === 'stale'
            ? 'stale bg-mod/12 text-foreground ring-1 ring-mod/50'
            : 'bg-muted text-ink2',
        !onRemove && 'pr-2',
        className,
      )}
    >
      <span className="truncate">{label}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-ink2 transition-colors hover:bg-sel-soft hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:scale-95"
          {...removeData}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
