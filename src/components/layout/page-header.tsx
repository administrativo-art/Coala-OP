import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
};

/**
 * Cabeçalho canônico das páginas internas.
 * Mantém título, descrição e ações na mesma hierarquia em todos os módulos.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      data-ui="page-header"
      className={cn('flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between', className)}
    >
      <div className="min-w-0">
        <h1 data-ui="page-title" className="text-2xl font-bold tracking-tight">
          {title}
        </h1>
        {description ? (
          <p data-ui="page-description" className="text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
