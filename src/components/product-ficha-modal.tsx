"use client";

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import { Edit, ImageIcon, X, ZoomIn } from 'lucide-react';

import { type BaseProduct, type Product } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type ProductFichaTab = 'general' | 'aliases' | 'extra';

interface ProductFichaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  baseProduct?: BaseProduct | null;
  onEdit: (step: number) => void;
  actions?: Array<{
    label: string;
    onClick: () => void;
    tone?: 'default' | 'danger';
    disabled?: boolean;
  }>;
}

const packageAbbreviation: Record<string, string> = {
  Unidade: 'un',
  Caixa: 'cx',
  Pacote: 'pct',
  Lata: 'lt',
  Garrafa: 'gf',
  Frasco: 'fr',
  Sachê: 'sch',
  Pote: 'pt',
  Balde: 'bd',
  Galão: 'gl',
  Bag: 'bag',
};

function formatAmount(value?: number, unit?: string) {
  if (!Number.isFinite(Number(value))) return `— ${unit || ''}`.trim();
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(value))} ${unit || ''}`.trim();
}

function countingLabel(product: Product) {
  if (product.defaultCountingUnit === 'base') return 'Unidade do Insumo Base';
  if (product.defaultCountingUnit === 'content') return 'Unidade do Conteúdo';
  return 'Unidade do Lote';
}

function DetailGroup({
  title,
  onEdit,
  rows,
}: {
  title: string;
  onEdit: () => void;
  rows: Array<{ label: string; value: React.ReactNode; mono?: boolean }>;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#e6e2da] bg-white">
      <header className="flex items-center justify-between border-b border-[#f0ede7] px-4 py-3">
        <h3 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-[#8a8f99]">{title}</h3>
        <button type="button" onClick={onEdit} className="text-xs font-bold text-[#5b5bd6] hover:text-[#4646b8]">Editar</button>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0 border-t border-[#f6f4ef] px-4 py-3 first:border-t-0 sm:[&:nth-child(2)]:border-t-0">
            <p className="text-[11.5px] text-[#8a8f99]">{row.label}</p>
            <div className={cn('mt-1 break-words text-[13.5px] font-bold text-[#1a1b1f]', row.mono && 'font-mono text-[13px]')}>{row.value || '—'}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ProductFichaModal({ open, onOpenChange, product, baseProduct, onEdit, actions = [] }: ProductFichaModalProps) {
  const [tab, setTab] = useState<ProductFichaTab>('general');
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const isUniform = product?.category === 'Vestimenta' || product?.operationalDestination === 'uniform';
  const showNutrition = product?.operationalCategoryId === 'insumo' || product?.operationalCategoryName?.toLocaleLowerCase('pt-BR') === 'insumo';
  const aliases = product?.aliases ?? [];
  const extraLabel = isUniform ? 'Instruções' : 'Nutricional';
  const grouping = product?.multiplo_caixa && product.rotulo_caixa
    ? `1 ${product.rotulo_caixa.toLowerCase()} = ${product.multiplo_caixa} ${(product.packageType || 'embalagem').toLowerCase()}${product.multiplo_caixa === 1 ? '' : 's'}`
    : 'Avulso';
  const tabs = useMemo(() => [
    { id: 'general' as const, label: 'Dados gerais' },
    { id: 'aliases' as const, label: `Aliases (${aliases.length})` },
    ...(isUniform || showNutrition ? [{ id: 'extra' as const, label: extraLabel }] : []),
  ], [aliases.length, extraLabel, isUniform, showNutrition]);

  if (!product) return null;

  const packageLabel = (product.packageType || 'Embalagem').toLowerCase();
  const packageAmount = formatAmount(product.packageSize, product.unit);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent hideClose flush className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] gap-0 overflow-y-auto overflow-x-hidden rounded-[26px] border-0 bg-[#faf9f6] sm:w-[calc(100vw-2rem)] sm:max-w-[1080px] sm:rounded-[26px]">
          <DialogTitle className="sr-only">Ficha cadastral de {product.baseName}</DialogTitle>
          <DialogDescription className="sr-only">Informações completas do insumo derivado.</DialogDescription>
          <div className="grid min-h-0 grid-cols-1 lg:h-[800px] lg:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col gap-[22px] bg-[#15151c] px-6 py-7 text-[#f3f2ee] sm:px-7 sm:py-[30px]">
              <button
                type="button"
                onClick={() => product.imageUrl && setZoomedImage(product.imageUrl)}
                disabled={!product.imageUrl}
                className={cn('relative flex h-[170px] overflow-hidden rounded-[20px] border border-white/10 text-left disabled:cursor-default', product.imageUrl ? 'bg-white' : 'bg-[repeating-linear-gradient(135deg,#1f1f28_0_10px,#24242e_10px_20px)]')}
              >
                {product.imageUrl ? <Image src={product.imageUrl} alt={product.baseName} fill sizes="360px" className="object-contain" /> : null}
                <span className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
                  <span className="text-[11px] font-bold text-[#c8c7d0]">{product.imageUrl ? 'Ampliar foto' : 'Sem foto do insumo'}</span>
                  <span className="rounded-lg bg-[#f3f2ee] px-2 py-1 text-[11px] font-extrabold tracking-[.06em] text-[#15151c]">
                    {packageAbbreviation[product.packageType || ''] || 'un'} · {packageAmount}
                  </span>
                </span>
              </button>

              <div className="flex flex-col gap-2.5">
                <span className="text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#8e8d99]">Ficha cadastral · insumo derivado</span>
                <h2 className="break-words text-[30px] font-extrabold leading-[1.05] tracking-[-.03em]">{product.baseName.toLocaleUpperCase('pt-BR')}</h2>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-[rgba(185,185,255,.14)] px-2.5 py-[3px] text-[11.5px] font-bold text-[#d4d4ff]">{product.operationalCategoryName || 'Sem categoria'}</span>
                  <span className="rounded-full border border-white/15 px-2.5 py-0.5 text-[11.5px] font-semibold text-[#c8c7d0]">{product.brand || 'Sem marca'}</span>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                <div className="flex items-baseline justify-between gap-3 px-4 py-3.5">
                  <span className="text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#8e8d99]">1 {packageLabel}</span>
                  <span className="font-mono text-[26px] font-bold tracking-[-.03em] text-[#b9b9ff]">{packageAmount}</span>
                </div>
                <div className="flex justify-between gap-3 border-t border-white/5 px-4 py-3 text-[12.5px]">
                  <span className="text-[#8e8d99]">Insumo base</span>
                  <strong className="truncate text-right">{baseProduct?.name || '—'}</strong>
                </div>
                <div className="flex justify-between gap-3 border-t border-white/5 px-4 py-3 text-[12.5px]">
                  <span className="text-[#8e8d99]">Contagem</span>
                  <strong className="truncate text-right">{countingLabel(product)}</strong>
                </div>
              </div>

              <div className="mt-auto border-t border-white/10 pt-4">
                <p className="text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#8e8d99]">Código de barras</p>
                <p className="mt-1 font-mono text-[15px] font-bold">{product.barcode || '—'}</p>
              </div>
            </aside>

            <div className="flex min-h-0 flex-col">
              <header className="border-b border-[#e6e2da] px-5 pb-3.5 pt-6 sm:px-[30px]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div role="tablist" aria-label="Seções da ficha" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[#efede7] p-1">
                    {tabs.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.id}
                        onClick={() => setTab(item.id)}
                        className={cn('h-[34px] whitespace-nowrap rounded-[9px] px-3.5 text-[13px] font-bold', tab === item.id ? 'bg-white text-[#15151c] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-[#70757d]')}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => onEdit(tab === 'aliases' ? 2 : tab === 'extra' ? (isUniform ? 4 : 5) : 1)} className="flex h-[38px] items-center rounded-xl border border-[#dcd9d1] bg-white px-4 text-[13px] font-bold">
                      <Edit className="mr-1.5 h-3.5 w-3.5" /> Editar
                    </button>
                    <button type="button" aria-label="Fechar" onClick={() => onOpenChange(false)} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#efede7] text-[#4a4f57]"><X className="h-4 w-4" /></button>
                  </div>
                </div>
                <p className="mt-3 text-[13px] text-[#70757d]">
                  {tab === 'general' ? 'Identificação, embalagem, contagem e fiscal.' : tab === 'aliases' ? 'Nomes reconhecidos automaticamente nas importações de pedido.' : isUniform ? 'Instruções de lavagem, conservação e uso.' : 'Fotos da embalagem e dados transcritos.'}
                </p>
              </header>

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-3.5 px-5 py-[22px] sm:px-[30px]">
                  {tab === 'general' ? (
                    <>
                      <DetailGroup title="Identificação" onEdit={() => onEdit(1)} rows={[
                        { label: 'Nome', value: product.baseName },
                        { label: 'Marca', value: product.brand || '—' },
                        { label: 'Categoria do item', value: product.operationalCategoryName || '—' },
                        { label: isUniform ? 'Tamanho e cor' : 'Insumo base', value: isUniform ? [product.apparelSize, product.apparelColor].filter(Boolean).join(' · ') || '—' : baseProduct?.name || '—' },
                      ]} />
                      <DetailGroup title="Embalagem e contagem" onEdit={() => onEdit(3)} rows={[
                        { label: 'Embalagem', value: `1 ${packageLabel} = ${packageAmount}` },
                        { label: 'Agrupamento', value: grouping },
                        { label: 'Contagem padrão', value: countingLabel(product) },
                        { label: 'Instrução de contagem', value: product.countingInstruction || product.countingInstructionImageUrl ? 'Cadastrada' : 'Nenhuma' },
                      ]} />
                      <DetailGroup title="Fiscal" onEdit={() => onEdit(1)} rows={[
                        { label: 'NCM', value: product.ncm || '—', mono: true },
                        { label: 'CEST', value: product.cest || '—', mono: true },
                        { label: 'Código de barras', value: product.barcode || '—', mono: true },
                        { label: 'Fonte dos dados', value: product.dataSource ? `${product.dataSource}${product.confidence != null ? ` · ${Math.round(product.confidence * 100)}%` : ''}` : 'Cadastro manual' },
                      ]} />
                    </>
                  ) : null}

                  {tab === 'aliases' ? (
                    aliases.length ? (
                      <div className="overflow-hidden rounded-2xl border border-[#e6e2da] bg-white">
                        {aliases.map((alias, index) => (
                          <div key={`${alias}-${index}`} className="flex items-center gap-3 border-t border-[#f0ede7] px-4 py-3 first:border-t-0">
                            <span className="w-[18px] text-[10.5px] font-extrabold text-[#8a8f99]">{index + 1}</span>
                            <span className="font-mono text-[13px] font-semibold">{alias}</span>
                          </div>
                        ))}
                      </div>
                    ) : <p className="rounded-2xl border border-dashed border-[#d6d2c8] p-8 text-center text-[13px] text-[#70757d]">Nenhum alias cadastrado.</p>
                  ) : null}

                  {tab === 'extra' && isUniform ? (
                    product.uniformCareInstructions?.length ? product.uniformCareInstructions.map((section, index) => (
                      <section key={section.id || index} className="rounded-2xl border border-[#e6e2da] bg-white p-4">
                        <h3 className="text-sm font-extrabold">{section.name || `Seção ${index + 1}`}</h3>
                        <ol className="mt-3 space-y-2">
                          {section.etapas.map((step, stepIndex) => (
                            <li key={step.id || stepIndex} className="flex items-start gap-2.5 text-[13px] leading-normal text-[#4a4f57]"><span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#15151c] text-[11px] font-extrabold text-white">{stepIndex + 1}</span>{step.text}</li>
                          ))}
                        </ol>
                      </section>
                    )) : <p className="rounded-2xl border border-dashed border-[#d6d2c8] p-8 text-center text-[13px] text-[#70757d]">Nenhuma instrução cadastrada.</p>
                  ) : null}

                  {tab === 'extra' && showNutrition ? (
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      {[
                        { label: 'Tabela nutricional', image: product.nutritionalTableImageUrl },
                        { label: 'Composição e ingredientes', image: product.compositionImageUrl },
                      ].map((slot) => (
                        <button key={slot.label} type="button" disabled={!slot.image} onClick={() => slot.image && setZoomedImage(slot.image)} className="overflow-hidden rounded-2xl border border-[#e6e2da] bg-white p-3.5 text-left disabled:cursor-default">
                          <span className="relative flex h-[260px] items-center justify-center overflow-hidden rounded-xl border border-dashed border-[#d6d2c8] bg-[#f4f3ef]">
                            {slot.image ? <Image src={slot.image} alt={slot.label} fill sizes="360px" className="object-contain" /> : <ImageIcon className="h-8 w-8 text-[#b7b2a8]" />}
                            {slot.image ? <ZoomIn className="absolute right-3 top-3 h-5 w-5 rounded-md bg-black/55 p-1 text-white" /> : null}
                          </span>
                          <span className="mt-3 block text-[13.5px] font-extrabold">{slot.label}</span>
                          <span className={cn('mt-0.5 block text-[11.5px] font-bold', slot.image ? 'text-[#0f6b46]' : 'text-[#8a8f99]')}>{slot.image ? 'Foto enviada' : 'Sem foto'}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </ScrollArea>
              {actions.length ? (
                <footer className="flex flex-wrap justify-end gap-2 border-t border-[#e6e2da] px-5 py-3 sm:px-[30px]">
                  {actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      disabled={action.disabled}
                      onClick={action.onClick}
                      className={cn(
                        'h-9 rounded-xl border px-4 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50',
                        action.tone === 'danger'
                          ? 'border-[#f0c7cf] bg-[#fff4f6] text-[#b4233f] hover:bg-[#ffe8ed]'
                          : 'border-[#dcd9d1] bg-white text-[#4a4f57] hover:bg-[#f4f2ed]',
                      )}
                    >
                      {action.label}
                    </button>
                  ))}
                </footer>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {zoomedImage ? (
        <Dialog open onOpenChange={() => setZoomedImage(null)}>
          <DialogContent className="max-w-3xl border-none bg-black p-2">
            <DialogTitle className="sr-only">Imagem ampliada</DialogTitle>
            <Image src={zoomedImage} alt="Imagem ampliada" width={900} height={1200} className="max-h-[85vh] w-full rounded object-contain" />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
