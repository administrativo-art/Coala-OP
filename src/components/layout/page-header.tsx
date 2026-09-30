import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { BackButton } from '@/components/navigation/back-button';
import { cn } from '@/lib/utils';

type PageHeaderProps = {
  title: string;
  titleSize?: 'default' | 'compact';
  description?: string;
  actions?: ReactNode;
  className?: string;
  back?: {
    fallbackHref: string;
    parentLabel: string;
    ariaLabel?: string;
  };
};

/**
 * Cabeçalho canônico das páginas internas.
 * Mantém título, descrição e ações na mesma hierarquia em todos os módulos.
 */
export function PageHeader({ title, titleSize = 'default', description, actions, className, back }: PageHeaderProps) {
  return (
    <div
      data-ui="page-header"
      className={cn('flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between', className)}
    >
      <div className="min-w-0">
        {back ? (
          <div data-ui="page-breadcrumb" className="flex min-w-0 items-center gap-2">
            <BackButton
              fallbackHref={back.fallbackHref}
              ariaLabel={back.ariaLabel ?? `Voltar para ${back.parentLabel}`}
              iconOnly
              variant="ghost"
              className="h-8 w-8 shrink-0 rounded-lg bg-white p-0 text-[#777784] shadow-sm ring-1 ring-[#dedfe4] hover:bg-white hover:text-[#df2f78]"
              iconClassName="h-5 w-5"
            />
            <span className="shrink-0 text-xs font-black text-[#8f8f9b]">{back.parentLabel}</span>
            <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[#b5b5bf]" />
            <h1 data-ui="page-title" className="min-w-0 truncate text-lg font-black leading-tight text-[#181820]">
              {title}
            </h1>
          </div>
        ) : (
          <h1
            data-ui="page-title"
            className={cn(
              titleSize === 'compact'
                ? 'text-lg font-black leading-tight tracking-tight text-[#181820]'
                : 'text-2xl font-bold tracking-tight',
            )}
          >
            {title}
          </h1>
        )}
        {description ? (
          <p data-ui="page-description" className={cn('text-muted-foreground', back && 'mt-2 sm:pl-10')}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
