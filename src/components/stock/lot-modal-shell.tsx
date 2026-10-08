"use client";

import * as React from 'react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export const MODAL_INPUT =
  'h-[42px] w-full rounded-[11px] border border-[#dcd9d1] bg-white px-3 text-[13.5px] outline-none focus:border-[#5b5bd6] disabled:bg-[#eceae5] disabled:text-[#70757d]';

export const MODAL_ERROR_TEXT = 'text-xs font-semibold text-[#be123c]';

export function pickClass(on: boolean) {
  return cn(
    'h-10 cursor-pointer whitespace-nowrap rounded-full px-4 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50',
    on ? 'border-2 border-[#5b5bd6] bg-[#eeeefc] text-[#3f3fb0]' : 'border border-[#dcd9d1] bg-white text-[#4a4f57] hover:bg-[#f6f4ef]',
  );
}

interface LotModalShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Largura do modal em px (máximo: a viewport). */
  width: number;
  /** Altura fixa em px em telas grandes; sem valor, o modal acompanha o conteúdo. */
  height?: number;
  sidebarWidth?: number;
  sidebar: React.ReactNode;
  children: React.ReactNode;
  footer: React.ReactNode;
}

/** Casca dos modais de estoque: painel escuro à esquerda (de borda a borda), conteúdo à direita e rodapé fixo. */
export function LotModalShell({ open, onOpenChange, title, description, width, height, sidebarWidth = 300, sidebar, children, footer }: LotModalShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        flush
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] gap-0 overflow-hidden rounded-[26px] border-0 bg-[#faf9f6] shadow-[0_30px_80px_rgba(21,21,28,.3),0_2px_6px_rgba(0,0,0,.06)] sm:w-[calc(100vw-2rem)] sm:rounded-[26px]"
        style={{ maxWidth: width, height: height ? `min(${height}px, calc(100dvh - 1rem))` : undefined }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <div
          className="grid h-full min-h-0 grid-cols-1 overflow-y-auto md:overflow-hidden md:[grid-template-columns:var(--sidebar)_minmax(0,1fr)]"
          style={{ ['--sidebar' as string]: `${sidebarWidth}px` }}
        >
          <aside className="flex min-h-0 flex-col gap-[18px] overflow-auto bg-[#15151c] px-6 py-7 text-[#f3f2ee]">{sidebar}</aside>
          <div className="flex min-h-0 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-auto px-[30px] py-[26px]">{children}</div>
            <div className="flex items-center justify-between gap-3 border-t border-[#e6e2da] bg-[#faf9f6] px-7 py-4">{footer}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ShellEyebrow({ children }: { children: React.ReactNode }) {
  return <span className="text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#8e8d99]">{children}</span>;
}

/** Bloco de fatos do painel escuro: rótulo à esquerda, valor à direita. */
export function ShellFacts({ rows }: { rows: { label: string; value: React.ReactNode; mono?: boolean; className?: string }[] }) {
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/5 text-[12.5px]">
      {rows.map((row, index) => (
        <div key={row.label} className={cn('flex justify-between gap-2.5 px-3.5 py-[11px]', index > 0 && 'border-t border-white/[.06]')}>
          <span className="text-[#8e8d99]">{row.label}</span>
          <span className={cn('text-right font-bold', row.mono && 'font-mono', row.className)}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export function CancelButton({ onClick, children = 'Cancelar' }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-11 whitespace-nowrap rounded-xl px-3.5 text-[13.5px] font-bold text-[#70757d] hover:bg-[#f0eee9] hover:text-[#1a1b1f]">
      {children}
    </button>
  );
}

export function PrimaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn('h-11 whitespace-nowrap rounded-xl bg-[#15151c] px-[22px] text-sm font-extrabold text-white hover:bg-[#2a2a35] disabled:cursor-not-allowed disabled:bg-[#b9b8c2]', props.className)}
    >
      {children}
    </button>
  );
}
