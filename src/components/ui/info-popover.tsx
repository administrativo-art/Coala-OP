"use client";

import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type InfoPopoverProps = {
  title: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

/** Ajuda contextual persistente: abre por clique, foco/teclado ou toque. */
export function InfoPopover({ title, children, className, contentClassName }: InfoPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Entenda: ${title}`}
          className={cn(
            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-ds-border bg-ds-surface text-ds-ink-muted transition hover:border-ds-accent hover:text-ds-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-modal',
            className,
          )}
        >
          <Info aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        collisionPadding={16}
        className={cn('max-h-[calc(100vh-32px)] w-[390px] max-w-[calc(100vw-32px)] space-y-3 overflow-y-auto rounded-ds-btn-lg border-ds-border p-4 text-xs leading-relaxed', contentClassName)}
      >
        <p className="text-sm font-extrabold text-ds-ink">{title}</p>
        <div className="space-y-2 text-ds-ink-muted">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
