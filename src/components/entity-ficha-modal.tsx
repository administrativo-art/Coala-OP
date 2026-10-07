"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Edit, MoreHorizontal, X } from 'lucide-react';

import { type Entity } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { initialsOf } from '@/components/cadastros/cadastros-utils';
import {
  formatEntityDate,
  formatEntityDateTime,
  icmsLabel,
  ieStatusLabel,
  isAttentionCadastralStatus,
  purposeLabel,
  signatoryScopeLabel,
} from '@/components/cadastros/entity-form-options';
import { cn } from '@/lib/utils';

export type EntityFichaEditTarget = { step: 1 | 2; fiscal?: boolean };

type FichaTab = 'general' | 'contact' | 'fiscal';

type FichaRow = { label: string; value: React.ReactNode; mono?: boolean; full?: boolean; tone?: 'ok' | 'warn' | 'muted' };

interface EntityFichaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: Entity | null;
  asoClinic?: { active: boolean };
  onEdit: (target: EntityFichaEditTarget) => void;
  actions?: Array<{ label: string; onClick: () => void; tone?: 'default' | 'danger'; disabled?: boolean }>;
}

const TAB_DESCRIPTIONS: Record<FichaTab, string> = {
  general: 'Identificação, assinatura documental e status.',
  contact: 'Canais de contato, e-mails por setor, pagamento e endereço.',
  fiscal: 'Dados da Receita Federal e inscrição estadual.',
};

const SOURCE_LABELS: Record<string, string> = {
  brasilapi: 'BrasilAPI',
  viacep: 'ViaCEP',
  sintegra: 'Sintegra',
  cache: 'Cache interno',
  internal: 'Cadastro interno',
  manual: 'Cadastro manual',
};

const toneClass = { ok: 'text-[#0f6b46]', warn: 'text-[#8a5a00]', muted: 'text-[#8a8f99]' } as const;

function DetailGroup({ title, onEdit, rows }: { title: string; onEdit: () => void; rows: FichaRow[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#e6e2da] bg-white">
      <header className="flex items-center justify-between border-b border-[#f0ede7] px-4 py-3">
        <h3 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-[#8a8f99]">{title}</h3>
        <button type="button" onClick={onEdit} className="text-xs font-bold text-[#5b5bd6] hover:text-[#4646b8]">Editar</button>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className={cn('min-w-0 border-t border-[#f6f4ef] px-4 py-3 first:border-t-0', row.full && 'sm:col-span-2', !row.full && 'sm:[&:nth-child(2)]:border-t-0')}>
            <p className="text-[11.5px] text-[#8a8f99]">{row.label}</p>
            <div className={cn('mt-1 break-words text-[13.5px] font-bold text-[#1a1b1f]', row.mono && 'font-mono text-[13px]', row.tone && toneClass[row.tone])}>{row.value || '—'}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function EntityFichaModal({ open, onOpenChange, entity, asoClinic, onEdit, actions = [] }: EntityFichaModalProps) {
  const { firebaseUser, permissions } = useAuth();
  const [tab, setTab] = useState<FichaTab>('general');
  const [moreOpen, setMoreOpen] = useState(false);
  const [hasPix, setHasPix] = useState<boolean | null>(null);
  const canSeePix = Boolean(permissions.registration?.entities?.edit);
  const entityId = entity?.id;

  useEffect(() => {
    if (open) { setTab('general'); setMoreOpen(false); }
  }, [open, entityId]);

  // A chave nunca é exibida na ficha: só a existência, para a leitura do status de pagamento.
  useEffect(() => {
    setHasPix(null);
    if (!open || !entityId || !firebaseUser || !canSeePix) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/financial/beneficiaries/entities/${encodeURIComponent(entityId)}`, {
          headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
          cache: 'no-store',
        });
        if (!response.ok) return;
        const payload = await response.json().catch(() => ({}));
        if (!cancelled) setHasPix(Boolean(String(payload.pixKey ?? '').trim()));
      } catch {
        // A ficha continua legível sem o status de pagamento.
      }
    })();
    return () => { cancelled = true; };
  }, [open, entityId, firebaseUser, canSeePix]);

  const isPJ = entity?.type === 'pessoa_juridica';
  const tabs = useMemo(() => [
    { id: 'general' as const, label: 'Dados gerais' },
    { id: 'contact' as const, label: 'Contato e endereço' },
    ...(isPJ ? [{ id: 'fiscal' as const, label: 'Fiscal' }] : []),
  ], [isPJ]);

  if (!entity) return null;

  const active = entity.status !== 'inactive';
  const name = entity.name;
  const initials = initialsOf(name);
  const phone = entity.contact?.phone ?? '';
  const email = entity.contact?.email ?? '';
  const departmentEmails = entity.contact?.emails ?? [];
  const address = entity.address;
  const street = [address?.street, address?.number].filter(Boolean).join(', ');
  const cityState = address?.city ? `${address.city}${address.state ? ` / ${address.state}` : ''}` : '';
  const cadastral = entity.situacao_cadastral ?? '';
  const payableLabel = hasPix === null ? '—' : hasPix && active ? 'Sim' : 'Não';
  const currentTab: FichaTab = tabs.some((item) => item.id === tab) ? tab : 'general';

  const heroFacts: Array<{ label: string; value: string; tone?: string }> = isPJ
    ? [
        { label: 'Receita', value: cadastral || '—', tone: !cadastral ? undefined : isAttentionCadastralStatus(cadastral) ? 'text-[#fbbf24]' : 'text-[#6ee7b7]' },
        { label: 'Assinatura', value: entity.documentSignatoryName || '—' },
        { label: 'E-mails por setor', value: String(departmentEmails.length) },
        ...(hasPix === null ? [] : [{ label: 'Pix', value: hasPix ? 'cadastrado' : '—', tone: hasPix ? 'text-[#6ee7b7]' : 'text-[#8e8d99]' }]),
      ]
    : [
        { label: 'Nascimento', value: formatEntityDate(entity.birthDate) || '—' },
        { label: 'Telefone', value: phone || '—' },
        ...(hasPix === null ? [] : [{ label: 'Pix', value: hasPix ? 'cadastrado' : '—', tone: hasPix ? 'text-[#6ee7b7]' : 'text-[#8e8d99]' }]),
      ];

  const tags = [
    { label: active ? 'Ativo' : 'Inativo', className: active ? 'bg-[rgba(52,211,153,.14)] text-[#6ee7b7]' : 'bg-white/10 text-[#a3a2ad]' },
    ...(isPJ && entity.documentSignatoryName ? [{ label: `Assinante: ${entity.documentSignatoryName}`, className: 'bg-[rgba(185,185,255,.14)] text-[#d4d4ff]' }] : []),
    ...(asoClinic ? [{ label: asoClinic.active ? 'ASO ativo' : 'ASO inativo', className: 'bg-[rgba(240,139,177,.14)] text-[#f8b4cd]' }] : []),
    ...(entity.nickname ? [{ label: entity.nickname, className: 'bg-white/10 text-[#c8c7d0]' }] : []),
  ];
  const quick = [
    email ? { icon: '@', value: email, href: `mailto:${email}` } : null,
    phone ? { icon: '☏', value: phone, href: `tel:${phone.replace(/[^\d+]/g, '')}` } : null,
  ].filter((item): item is { icon: string; value: string; href: string } => Boolean(item));

  const groups: Record<FichaTab, Array<{ title: string; edit: () => void; rows: FichaRow[] }>> = {
    general: isPJ
      ? [
          {
            title: 'Identificação',
            edit: () => onEdit({ step: 1 }),
            rows: [
              { label: 'Razão social', value: name, full: true },
              { label: 'Nome fantasia', value: entity.fantasyName },
              { label: 'CNPJ', value: entity.document, mono: true },
              { label: 'Responsável cadastral', value: entity.responsible },
              { label: 'Apelido', value: entity.nickname },
            ],
          },
          {
            title: 'Assinatura documental',
            edit: () => onEdit({ step: 1 }),
            rows: [
              { label: 'Pessoa responsável', value: entity.documentSignatoryName ? `${entity.documentSignatoryName}${entity.documentSignatoryEmail ? ` · ${entity.documentSignatoryEmail}` : ''}` : '' },
              { label: 'Abrangência', value: entity.documentSignatoryName ? signatoryScopeLabel(entity.documentSignatoryScope) : '' },
            ],
          },
        ]
      : [
          {
            title: 'Identificação',
            edit: () => onEdit({ step: 1 }),
            rows: [
              { label: 'Nome completo', value: name, full: true },
              { label: 'CPF', value: entity.document, mono: true },
              { label: 'RG', value: entity.rg, mono: true },
              { label: 'Data de nascimento', value: formatEntityDate(entity.birthDate) },
              { label: 'Apelido', value: entity.nickname },
            ],
          },
        ],
    contact: [
      {
        title: 'Contato',
        edit: () => onEdit({ step: 2 }),
        rows: [
          { label: 'E-mail principal', value: email },
          { label: 'Telefone / WhatsApp', value: phone, mono: true },
          ...(isPJ
            ? departmentEmails.map((entry): FichaRow => ({
                label: `E-mail · ${entry.department}`,
                value: `${entry.email}${entry.purposes?.length ? ` — ${entry.purposes.map(purposeLabel).join(', ')}` : ''}`,
                full: true,
              }))
            : []),
        ],
      },
      ...(canSeePix
        ? [{
            title: 'Pagamento',
            edit: () => onEdit({ step: 2 }),
            rows: [
              { label: 'Chave Pix', value: hasPix === null ? '' : hasPix ? 'Cadastrada' : 'Não cadastrada', tone: hasPix ? 'ok' as const : 'muted' as const },
              { label: 'Disponível para pagamento', value: payableLabel, tone: hasPix && active ? 'ok' as const : 'muted' as const },
            ],
          }]
        : []),
      {
        title: 'Endereço',
        edit: () => onEdit({ step: 2 }),
        rows: [
          { label: 'Logradouro', value: `${street}${address?.complement ? ` · ${address.complement}` : ''}`, full: true },
          { label: 'Bairro', value: address?.neighborhood },
          { label: 'Cidade / UF', value: cityState },
          { label: 'CEP', value: address?.zipCode, mono: true },
        ],
      },
    ],
    fiscal: [
      {
        title: 'Receita Federal',
        edit: () => onEdit({ step: 1, fiscal: true }),
        rows: [
          { label: 'Situação cadastral', value: cadastral, tone: !cadastral ? undefined : isAttentionCadastralStatus(cadastral) ? 'warn' : 'ok' },
          { label: 'Data de abertura', value: formatEntityDate(entity.data_abertura) },
          { label: 'Natureza jurídica', value: entity.natureza_juridica, full: true },
          { label: 'CNAE principal', value: entity.cnae_principal_codigo, mono: true },
          { label: 'Descrição do CNAE', value: entity.cnae_principal_descricao },
          { label: 'Tipo de fornecedor', value: entity.tipo_empresa },
          {
            label: 'Fonte · última consulta',
            value: [entity.origem_dados ? SOURCE_LABELS[entity.origem_dados] ?? entity.origem_dados : '', formatEntityDateTime(entity.data_ultima_consulta_cnpj)].filter(Boolean).join(' · '),
          },
        ],
      },
      {
        title: 'Inscrição estadual',
        edit: () => onEdit({ step: 1, fiscal: true }),
        rows: [
          { label: 'Inscrição estadual', value: entity.inscricao_estadual, mono: true },
          { label: 'Contribuinte ICMS', value: icmsLabel(entity.contribuinte_icms) },
          { label: 'Situação IE', value: ieStatusLabel(entity.situacao_inscricao_estadual) },
        ],
      },
    ],
  };

  const avatarClass = cn(
    'relative flex shrink-0 items-center justify-center overflow-hidden font-extrabold tracking-[-.02em]',
    isPJ ? 'rounded-3xl bg-[#dbeafe] text-[#1e40af]' : 'rounded-full bg-[#dcfce7] text-[#166534]',
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose flush className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] gap-0 overflow-y-auto overflow-x-hidden rounded-[26px] border-0 bg-[#faf9f6] sm:w-[calc(100vw-2rem)] sm:max-w-[1080px] sm:rounded-[26px]">
        <DialogTitle className="sr-only">Ficha cadastral de {name}</DialogTitle>
        <DialogDescription className="sr-only">Informações completas do cadastro de {isPJ ? 'empresa' : 'pessoa física'}.</DialogDescription>
        <div className="grid min-h-0 grid-cols-1 lg:h-[780px] lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col gap-5 bg-[#15151c] px-6 py-7 text-[#f3f2ee] sm:px-[26px] sm:py-[30px]">
            <span className="text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#8e8d99]">Ficha cadastral · {isPJ ? 'Empresa' : 'Pessoa física'}</span>
            <div className={cn(avatarClass, 'h-[92px] w-[92px] text-[32px]')}>
              {entity.imageUrl ? <Image src={entity.imageUrl} alt="" fill sizes="92px" className="object-cover" unoptimized /> : initials}
            </div>
            <div className="flex flex-col gap-2">
              <h2 className="break-words text-[28px] font-extrabold leading-[1.05] tracking-[-.03em]">{name}</h2>
              {isPJ && entity.fantasyName ? <span className="break-words text-[12.5px] text-[#a3a2ad]">{entity.fantasyName}</span> : null}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {tags.map((tag) => <span key={tag.label} className={cn('whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-bold', tag.className)}>{tag.label}</span>)}
              </div>
            </div>
            <div className="flex flex-col rounded-2xl border border-white/10 bg-white/5">
              {heroFacts.map((fact) => (
                <div key={fact.label} className="flex items-center justify-between gap-2.5 border-t border-white/5 px-3.5 py-[11px] text-[12.5px] first:border-t-0">
                  <span className="whitespace-nowrap text-[#8e8d99]">{fact.label}</span>
                  <span className={cn('min-w-0 truncate text-right font-bold', fact.tone ?? 'text-white')}>{fact.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-auto flex flex-col gap-1.5">
              {quick.map((item) => (
                <a key={item.href} href={item.href} className="flex min-w-0 items-center gap-2.5 rounded-xl bg-white/[.06] px-3 py-2.5 text-[12.5px] font-semibold text-[#f3f2ee] hover:bg-white/10">
                  <span className="w-[22px] text-center text-[#b9b9ff]">{item.icon}</span>
                  <span className="truncate">{item.value}</span>
                </a>
              ))}
            </div>
          </aside>

          <div className="flex min-h-0 flex-col">
            <header className="flex flex-col gap-3.5 border-b border-[#e6e2da] px-5 pb-3.5 pt-6 sm:px-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="tablist" aria-label="Seções da ficha" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[#efede7] p-1">
                  {tabs.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={currentTab === item.id}
                      onClick={() => setTab(item.id)}
                      className={cn('h-[34px] whitespace-nowrap rounded-[9px] px-3.5 text-[13px] font-bold', currentTab === item.id ? 'bg-white text-[#15151c] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-[#70757d]')}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {actions.length ? (
                    <button type="button" aria-label="Mais ações" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)} className="flex h-[38px] items-center rounded-xl border border-[#dcd9d1] bg-white px-3 text-[13px] font-bold">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  ) : null}
                  <button type="button" onClick={() => onEdit({ step: currentTab === 'contact' ? 2 : 1, fiscal: currentTab === 'fiscal' })} className="flex h-[38px] items-center rounded-xl bg-[#15151c] px-4 text-[13px] font-extrabold text-white">
                    <Edit className="mr-1.5 h-3.5 w-3.5" /> Editar
                  </button>
                  <button type="button" aria-label="Fechar" onClick={() => onOpenChange(false)} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#efede7] text-[#4a4f57]"><X className="h-4 w-4" /></button>
                </div>
              </div>
              {moreOpen && actions.length ? (
                <div className="flex flex-wrap gap-2">
                  {actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      disabled={action.disabled}
                      onClick={action.onClick}
                      className={cn(
                        'h-[34px] whitespace-nowrap rounded-[10px] border px-3 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50',
                        action.tone === 'danger' ? 'border-[#f3c2c8] bg-[#fdecee] text-[#b4232f]' : 'border-[#dcd9d1] bg-white text-[#4a4f57] hover:bg-[#f4f2ed]',
                      )}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="text-[13px] text-[#70757d]">{TAB_DESCRIPTIONS[currentTab]}</p>
            </header>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-3.5 px-5 py-5 sm:px-7">
                {groups[currentTab].map((group) => <DetailGroup key={group.title} title={group.title} onEdit={group.edit} rows={group.rows} />)}
                {currentTab === 'general' && entity.notes ? (
                  <section className="rounded-2xl border border-[#e6e2da] bg-white px-4 py-3">
                    <h3 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-[#8a8f99]">Observações</h3>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-[13.5px] text-[#1a1b1f]">{entity.notes}</p>
                  </section>
                ) : null}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
