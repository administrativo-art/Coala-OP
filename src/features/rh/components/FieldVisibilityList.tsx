'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Eye, EyeOff, Globe2, Lock, Search, type LucideIcon } from 'lucide-react';

import { InlineConfirm } from '@/components/patterns/inline-confirm';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusPillVariant } from '@/components/ui/status-pill';
import { useAuth } from '@/hooks/use-auth';
import {
  diffVisibility,
  FIELD_VISIBILITY_LEVELS,
  keysOverriddenBy,
  summarizeVisibility,
} from '@/features/rh/lib/field-visibility';
import { cn } from '@/lib/utils';
import { normalizeFieldVisibility, type NormalizedFieldVisibility } from '@/types/rh';

type VisibilityField = { label: string; section: string; order: number; visibility: NormalizedFieldVisibility };
type VisibilityPayload = { fields: Record<string, VisibilityField>; section_order: Record<string, number | string> };

const LEVEL_LABEL: Record<NormalizedFieldVisibility, string> = {
  public: 'Sem restrição',
  restricted_partial: 'Restrito parcial',
  restricted_total: 'Restrito total',
  confidential: 'Confidencial',
};

const LEVEL_SHORT: Record<NormalizedFieldVisibility, string> = {
  public: 'sem restrição',
  restricted_partial: 'parcial',
  restricted_total: 'total',
  confidential: 'confidencial',
};

const LEVEL_ICON: Record<NormalizedFieldVisibility, LucideIcon> = {
  public: Globe2,
  restricted_partial: Eye,
  restricted_total: Lock,
  confidential: EyeOff,
};

const LEVEL_PILL: Record<NormalizedFieldVisibility, StatusPillVariant> = {
  public: 'ok',
  restricted_partial: 'info',
  restricted_total: 'warn',
  confidential: 'danger',
};

const LEVEL_TONE: Record<NormalizedFieldVisibility, string> = {
  public: 'border-ds-ok bg-ds-ok text-white',
  restricted_partial: 'border-ds-info bg-ds-info text-white',
  restricted_total: 'border-ds-warn bg-ds-warn text-white',
  confidential: 'border-ds-danger bg-ds-danger text-white',
};

const LEVEL_SOFT: Record<NormalizedFieldVisibility, string> = {
  public: 'bg-ds-ok-bg text-ds-ok',
  restricted_partial: 'bg-ds-info-bg text-ds-info',
  restricted_total: 'bg-ds-warn-bg text-ds-warn',
  confidential: 'bg-ds-danger-bg text-ds-danger',
};

const LEVEL_HELP: Record<NormalizedFieldVisibility, string> = {
  public: 'Visível para todos os usuários que já têm acesso geral ao cadastro.',
  restricted_partial: 'Visível para gestão, administração, a própria pessoa e liberações explícitas.',
  restricted_total: 'Visível para gestão, administração e quem for liberado de forma explícita.',
  confidential: 'Visível para a administração autorizada e liberações explícitas de alta confiança.',
};

const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_repeat(4,92px)] items-center gap-2';

function compositionText(counts: Record<NormalizedFieldVisibility, number>) {
  return FIELD_VISIBILITY_LEVELS.filter((level) => counts[level] > 0)
    .map((level) => `${counts[level]} ${LEVEL_SHORT[level]}`)
    .join(' · ');
}

function LevelDot({ level, selected, label, onSelect, disabled }: {
  level: NormalizedFieldVisibility;
  selected: boolean;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={LEVEL_LABEL[level]}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'mx-auto grid h-6 w-6 place-items-center rounded-full border-2 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-modal focus-visible:ring-offset-2',
        selected ? LEVEL_TONE[level] : 'border-ds-border-input bg-ds-surface hover:border-ds-ink-faint',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {selected ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
    </button>
  );
}

function LevelHeader() {
  return (
    <div className={cn(ROW_GRID, 'border-b border-ds-divider bg-ds-muted px-5 py-2')}>
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Campo</span>
      {FIELD_VISIBILITY_LEVELS.map((level) => {
        const Icon = LEVEL_ICON[level];
        return (
          <span key={level} className="flex flex-col items-center gap-1 text-center" title={LEVEL_HELP[level]}>
            <span className={cn('grid h-6 w-6 place-items-center rounded-full', LEVEL_SOFT[level])}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="text-[11px] font-bold leading-tight text-ds-ink-2">{LEVEL_LABEL[level]}</span>
          </span>
        );
      })}
    </div>
  );
}

export function FieldVisibilityList() {
  const { firebaseUser } = useAuth();
  const [base, setBase] = useState<VisibilityPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, NormalizedFieldVisibility>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<NormalizedFieldVisibility | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [pendingBlock, setPendingBlock] = useState<{ section: string; level: NormalizedFieldVisibility } | null>(null);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch('/api/rh/field-visibility', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Não foi possível carregar os campos.');
      const next = payload as VisibilityPayload;
      setBase(next);
      setDraft(Object.fromEntries(Object.entries(next.fields).map(([key, field]) => [key, field.visibility])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os campos.');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    void load();
  }, [load]);

  const baseLevels = useMemo(
    () => Object.fromEntries(Object.entries(base?.fields ?? {}).map(([key, field]) => [key, field.visibility])),
    [base],
  );
  const changes = useMemo(() => diffVisibility(baseLevels, draft), [baseLevels, draft]);
  const changedCount = Object.keys(changes).length;

  const sections = useMemo(() => {
    const groups: Record<string, Array<{ key: string; field: VisibilityField }>> = {};
    for (const [key, field] of Object.entries(base?.fields ?? {})) {
      (groups[field.section] ??= []).push({ key, field });
    }
    Object.values(groups).forEach((items) => items.sort((a, b) => a.field.order - b.field.order));
    return Object.entries(groups).sort(([a], [b]) => {
      const left = Number(base?.section_order?.[a] ?? Number.MAX_SAFE_INTEGER);
      const right = Number(base?.section_order?.[b] ?? Number.MAX_SAFE_INTEGER);
      return left - right || a.localeCompare(b, 'pt-BR');
    });
  }, [base]);

  const normalizedQuery = query.trim().toLowerCase();
  const levelTotals = useMemo(() => summarizeVisibility(Object.values(draft)), [draft]);

  function setLevel(keys: string[], level: NormalizedFieldVisibility) {
    setDraft((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, level])) }));
    setNotice(null);
  }

  function requestBlockLevel(section: string, items: Array<{ key: string }>, level: NormalizedFieldVisibility) {
    const entries = items.map(({ key }) => ({ key, visibility: draft[key] }));
    const overridden = keysOverriddenBy(entries, level);
    if (overridden.length === 0) return;
    const summary = summarizeVisibility(entries.map((entry) => entry.visibility));
    if (summary.mixed) {
      setPendingBlock({ section, level });
      return;
    }
    setLevel(overridden, level);
  }

  function discard() {
    if (!base) return;
    setDraft(Object.fromEntries(Object.entries(base.fields).map(([key, field]) => [key, field.visibility])));
    setPendingBlock(null);
    setError(null);
    setNotice(null);
  }

  async function save() {
    if (!firebaseUser || changedCount === 0) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch('/api/rh/field-visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ changes }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Não foi possível salvar a visibilidade.');
      setNotice(`${changedCount} ${changedCount === 1 ? 'alteração salva' : 'alterações salvas'}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a visibilidade.');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !base) return <div className="h-40 animate-pulse rounded-ds-card bg-ds-muted" />;
  if (!base) {
    return (
      <div role="alert" className="rounded-ds-card border border-ds-alert-border bg-ds-alert-bg px-4 py-3 text-sm font-semibold text-ds-alert-ink">
        {error ?? 'Não foi possível carregar os campos.'}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-center gap-3 rounded-ds-card border border-ds-border bg-ds-surface p-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar campo ou bloco…"
            aria-label="Buscar campo ou bloco"
            className="h-10 w-full rounded-ds-md border border-ds-border-input bg-ds-input pl-10 pr-3 text-[13px] text-ds-ink outline-hidden focus:border-ds-modal focus:bg-ds-surface focus:ring-[3px] focus:ring-ds-modal-soft"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por nível">
          <button
            type="button"
            aria-pressed={levelFilter === null}
            onClick={() => setLevelFilter(null)}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded-ds-pill border px-3 text-xs font-bold', levelFilter === null ? 'border-ds-dark bg-ds-dark text-white' : 'border-ds-border-input bg-ds-surface text-ds-ink-2 hover:bg-ds-muted')}
          >
            Todos <span className="font-ds-mono text-[11px]">{levelTotals.total}</span>
          </button>
          {FIELD_VISIBILITY_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={levelFilter === level}
              onClick={() => setLevelFilter(levelFilter === level ? null : level)}
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-ds-pill border px-3 text-xs font-bold', levelFilter === level ? 'border-ds-dark bg-ds-dark text-white' : 'border-ds-border-input bg-ds-surface text-ds-ink-2 hover:bg-ds-muted')}
            >
              {LEVEL_LABEL[level]} <span className="font-ds-mono text-[11px]">{levelTotals.counts[level]}</span>
            </button>
          ))}
        </div>
      </div>

      {sections.map(([section, items]) => {
        const visibleItems = items.filter(({ key, field }) => {
          const matchesQuery = !normalizedQuery || section.toLowerCase().includes(normalizedQuery) || field.label.toLowerCase().includes(normalizedQuery) || key.toLowerCase().includes(normalizedQuery);
          const matchesLevel = !levelFilter || draft[key] === levelFilter;
          return matchesQuery && matchesLevel;
        });
        if (visibleItems.length === 0) return null;

        const summary = summarizeVisibility(items.map(({ key }) => draft[key]));
        const forcedOpen = Boolean(normalizedQuery || levelFilter);
        const expanded = forcedOpen || open[section] === true;
        const blockChanged = items.filter(({ key }) => key in changes).length;
        const confirming = pendingBlock?.section === section ? pendingBlock : null;
        const overriddenNames = confirming
          ? items.filter(({ key }) => draft[key] !== confirming.level).map(({ field }) => field.label)
          : [];

        return (
          <section key={section} className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
            <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <button
                type="button"
                onClick={() => setOpen((current) => ({ ...current, [section]: !expanded }))}
                aria-expanded={expanded}
                aria-label={`${expanded ? 'Recolher' : 'Expandir'} ${section}`}
                disabled={forcedOpen}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-ds-sm text-ds-ink-muted hover:bg-ds-muted disabled:opacity-40"
              >
                <ChevronDown className={cn('h-[18px] w-[18px] transition-transform', !expanded && '-rotate-90')} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[15.5px] font-extrabold text-ds-ink">{section}</h2>
                  <span className="text-xs text-ds-ink-muted">{items.length} {items.length === 1 ? 'campo' : 'campos'}</span>
                  {blockChanged > 0 ? <StatusPill variant="warn">{blockChanged} alterado{blockChanged === 1 ? '' : 's'}</StatusPill> : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {summary.mixed || !summary.level ? (
                    <>
                      <StatusPill variant="neutral">Visibilidade mista</StatusPill>
                      <span className="text-xs text-ds-ink-muted">{compositionText(summary.counts)}</span>
                    </>
                  ) : (
                    <StatusPill variant={LEVEL_PILL[summary.level]}>{LEVEL_LABEL[summary.level]}</StatusPill>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-ds-ink-muted">Aplicar a todos</span>
                <div role="radiogroup" aria-label={`Aplicar um nível a todos os campos de ${section}`} className="flex items-center gap-1 rounded-ds-md bg-ds-seg p-[3px]">
                  {FIELD_VISIBILITY_LEVELS.map((level) => {
                    const Icon = LEVEL_ICON[level];
                    const selected = !summary.mixed && summary.level === level;
                    return (
                      <button
                        key={level}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={`${LEVEL_LABEL[level]} em todos os campos de ${section}`}
                        title={LEVEL_LABEL[level]}
                        onClick={() => requestBlockLevel(section, items, level)}
                        className={cn(
                          'grid h-8 w-8 place-items-center rounded-ds-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-modal',
                          selected ? 'bg-ds-surface shadow-sm ' + LEVEL_SOFT[level] : 'text-ds-ink-muted hover:bg-ds-surface/60',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {confirming ? (
              <div className="px-5 pb-3">
                <InlineConfirm
                  message={
                    <>
                      Aplicar <b>{LEVEL_LABEL[confirming.level]}</b> muda {overriddenNames.length} {overriddenNames.length === 1 ? 'campo' : 'campos'}
                      {overriddenNames.length <= 3 ? `: ${overriddenNames.join(', ')}` : ''}. As exceções deste bloco deixam de existir.
                    </>
                  }
                  confirmLabel="Aplicar a todos"
                  onCancel={() => setPendingBlock(null)}
                  onConfirm={() => {
                    setLevel(items.map(({ key }) => key), confirming.level);
                    setPendingBlock(null);
                  }}
                />
              </div>
            ) : null}

            {expanded ? (
              <div>
                <LevelHeader />
                {visibleItems.map(({ key, field }) => {
                  const current = draft[key] ?? field.visibility;
                  const changed = key in changes;
                  return (
                    <div key={key} role="radiogroup" aria-label={`Visibilidade de ${field.label}`} className={cn(ROW_GRID, 'border-b border-ds-divider px-5 py-2.5 last:border-b-0', changed && 'bg-ds-accent-row')}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-extrabold text-ds-ink">{field.label}</span>
                          {changed ? <StatusPill variant="warn">alterado</StatusPill> : null}
                        </div>
                        <span className="font-ds-mono text-[11px] text-ds-ink-faint">{key}</span>
                      </div>
                      {FIELD_VISIBILITY_LEVELS.map((level) => (
                        <LevelDot
                          key={level}
                          level={level}
                          selected={current === normalizeFieldVisibility(level)}
                          label={`${LEVEL_LABEL[level]} em ${field.label}`}
                          onSelect={() => setLevel([key], level)}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}

      {error ? <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p> : null}
      {notice ? <p role="status" className="text-xs font-semibold text-ds-ok">{notice}</p> : null}

      {changedCount > 0 ? (
        <div className="sticky bottom-4 z-10 mx-auto flex w-fit max-w-full items-center gap-4 rounded-ds-card bg-ds-dark py-2.5 pl-5 pr-2.5 text-[13.5px] font-bold text-ds-on-dark shadow-ds-menu">
          <span className="h-2 w-2 rounded-full bg-ds-accent-kicker" aria-hidden />
          <span aria-live="polite">{changedCount} {changedCount === 1 ? 'alteração pendente' : 'alterações pendentes'}</span>
          <Button variant="on-dark-secondary" size="xs" onClick={discard} disabled={saving}>Descartar</Button>
          <Button variant="primary-page" size="md" onClick={() => void save()} loading={saving} loadingLabel="Salvando…">Salvar alterações</Button>
        </div>
      ) : null}
    </div>
  );
}
