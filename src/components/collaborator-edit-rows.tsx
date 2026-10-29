'use client';

import type { ReactNode } from 'react';

import { FormDescription, FormItem, FormLabel } from '@/components/ui/form';
import { InfoPopover } from '@/components/ui/info-popover';
import { cn } from '@/lib/utils';

/**
 * Edição do colaborador em linhas numeradas: cada linha responde a uma
 * pergunta, com o nome e o efeito à esquerda e o campo à direita. No celular
 * a linha empilha. Ver docs/design/painel-lateral.md (Drawer largo de edição).
 */
export function EditSection({ title, description, help, compact, children }: {
  title: string;
  description?: string;
  help?: ReactNode;
  compact?: boolean;
  children: ReactNode;
}) {
  if (compact) return <div className="space-y-2">{children}</div>;
  return (
    <section data-ui="form-section" className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface shadow-xs">
      <header className="flex items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold tracking-tight text-ds-ink">{title}</h2>
          {description ? <p className="mt-1 text-sm text-ds-ink-muted">{description}</p> : null}
        </div>
        {help ? <InfoPopover title={title} contentClassName="w-[360px]">{typeof help === 'string' ? <p>{help}</p> : help}</InfoPopover> : null}
      </header>
      <div className="divide-y divide-ds-divider border-t border-ds-divider">{children}</div>
    </section>
  );
}

function RowNumber({ value }: { value: number }) {
  return (
    <span aria-hidden="true" className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-ds-dark text-[11px] font-extrabold text-ds-on-dark">
      {value}
    </span>
  );
}

const rowGrid = 'grid gap-3 px-5 py-4 md:grid-cols-[200px_minmax(0,1fr)] md:gap-6';

function RowHelp({ title, help }: { title: string; help?: ReactNode }) {
  if (!help) return null;
  return <InfoPopover title={title} contentClassName="w-[340px]">{typeof help === 'string' ? <p>{help}</p> : help}</InfoPopover>;
}

/** Linha sem campo de formulário (foto, vigências, resumos calculados). */
export function EditRow({ number, label, description, help, labelId, compact, children, className }: {
  number?: number;
  label: string;
  description?: ReactNode;
  help?: ReactNode;
  labelId?: string;
  compact?: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (compact) return <div className={cn('space-y-2', className)}>{children}</div>;
  return (
    <div role="group" aria-labelledby={labelId} className={cn(rowGrid, className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {number ? <RowNumber value={number} /> : null}
        <div className="flex items-center gap-1.5">
          <p id={labelId} className="text-[13px] font-extrabold text-ds-ink">{label}</p>
          <RowHelp title={label} help={help} />
        </div>
        {description ? <p className="text-xs leading-5 text-ds-ink-muted">{description}</p> : null}
      </div>
      <div className="min-w-0 space-y-2">{children}</div>
    </div>
  );
}

/**
 * Linha de um `FormField`: mantém o `FormItem`, de modo que o rótulo continua
 * associado ao controle e a mensagem de erro aparece junto do campo.
 */
export function EditFormRow({ number, label, description, help, compact, children }: {
  number?: number;
  label: string;
  description?: ReactNode;
  help?: ReactNode;
  compact?: boolean;
  children: ReactNode;
}) {
  if (compact) {
    return (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        {children}
      </FormItem>
    );
  }
  return (
    <FormItem className={cn(rowGrid, 'space-y-0')}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {number ? <RowNumber value={number} /> : null}
        <div className="flex items-center gap-1.5">
          <FormLabel className="text-[13px] font-extrabold text-ds-ink">{label}</FormLabel>
          <RowHelp title={label} help={help} />
        </div>
        {description ? <FormDescription className="text-xs leading-5 text-ds-ink-muted">{description}</FormDescription> : null}
      </div>
      <div className="min-w-0 space-y-2">{children}</div>
    </FormItem>
  );
}

/** No cadastro rápido agrupa campos em grade; na edição as linhas ficam soltas para receberem os divisores. */
export function EditRowsGroup({ compact, className, children }: { compact?: boolean; className?: string; children: ReactNode }) {
  return compact ? <div className={className}>{children}</div> : <>{children}</>;
}
