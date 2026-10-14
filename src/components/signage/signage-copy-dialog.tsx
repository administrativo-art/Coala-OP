"use client";

import { useEffect, useMemo, useState } from 'react';

import { fieldInputClass } from '@/components/patterns/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { getScreenSlides } from '@/lib/signage';
import { cn } from '@/lib/utils';
import { type SignageSlide } from '@/types';

import { SlideThumb, toSlidePayload, type ScreenOption } from './signage-admin-shared';
import { type SignageApiRequest } from './signage-slide-dialog';

type SignageCopyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Telas que quem edita enxerga; qualquer uma pode ser a origem. */
  screens: ScreenOption[];
  /** Tela aberta no editor: começa como origem. */
  initialSourceId: string;
  /** Todos os slides carregados; a playlist de cada tela sai daqui. */
  allSlides: SignageSlide[];
  /** Fim da playlist de cada tela, para os slides copiados entrarem depois do que ela já exibe. */
  nextOrderByScreen: Record<string, number>;
  request: SignageApiRequest;
  onCopied: () => void | Promise<void>;
};

/**
 * Replica a playlist: os slides da origem passam a ser exibidos também nas telas escolhidas.
 * É o mesmo slide vinculado a mais telas, então uma edição futura vale para todas.
 */
export function SignageCopyDialog({ open, onOpenChange, screens, initialSourceId, allSlides, nextOrderByScreen, request, onCopied }: SignageCopyDialogProps) {
  const [sourceId, setSourceId] = useState(initialSourceId);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSourceId(initialSourceId);
    setSelectedIds([]);
    setProgress(null);
    setError(null);
  }, [initialSourceId, open]);

  const slidesByScreen = useMemo(
    () => new Map(screens.map((screen) => [screen.id, getScreenSlides(allSlides, screen.id)])),
    [allSlides, screens]
  );
  const source = screens.find((screen) => screen.id === sourceId) ?? screens[0];
  const slides = slidesByScreen.get(source?.id ?? '') ?? [];
  const targets = screens.filter((screen) => screen.id !== source?.id);
  const copying = progress !== null;
  const pending = slides.filter((slide) => selectedIds.some((screenId) => !slide.screenIds.includes(screenId)));

  async function handleCopy() {
    if (!slides.length) {
      setError('A tela de origem não tem slides para copiar.');
      return;
    }
    if (!selectedIds.length) {
      setError('Escolha ao menos uma tela de destino.');
      return;
    }
    if (!pending.length) {
      onOpenChange(false);
      return;
    }

    let failures = 0;
    setError(null);
    setProgress({ done: 0, total: pending.length });
    for (const [index, slide] of pending.entries()) {
      const added = selectedIds.filter((screenId) => !slide.screenIds.includes(screenId));
      try {
        await request(`/api/signage/slides/${slide.id}`, {
          method: 'PUT',
          json: toSlidePayload(slide, {
            screenIds: [...slide.screenIds, ...added],
            // Mantém a sequência da origem, depois do que a tela de destino já exibe.
            orderByScreen: {
              ...slide.orderByScreen,
              ...Object.fromEntries(added.map((screenId) => [screenId, (nextOrderByScreen[screenId] ?? 0) + index])),
            },
          }),
          fallbackError: 'Falha ao copiar o slide.',
        });
      } catch {
        failures += 1;
      }
      setProgress({ done: index + 1, total: pending.length });
    }

    await onCopied();
    setProgress(null);
    if (failures) {
      setError(`${failures} de ${pending.length} slides não foram copiados. Tente de novo para completar.`);
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!copying) onOpenChange(nextOpen); }}>
      <DialogContent flush className="gap-0 overflow-hidden rounded-ds-modal border-0 bg-ds-input font-ds shadow-ds-modal sm:max-w-[500px] sm:rounded-ds-modal">
        <div className="border-b border-ds-border-footer px-7 pb-[18px] pt-6 pr-12">
          <DialogTitle className="text-[21px] font-extrabold tracking-[-0.02em] text-ds-ink">Copiar playlist</DialogTitle>
          <DialogDescription className="mt-0.5 text-[13px] text-ds-ink-muted">
            Escolha de qual tela copiar e para quais levar. Os slides entram depois do que cada tela de destino já exibe.
          </DialogDescription>
        </div>

        <div className="space-y-3 px-7 py-6">
          <div>
            <label htmlFor="signage-copy-source" className="text-xs font-bold text-ds-ink-2">Copiar de</label>
            <select
              id="signage-copy-source"
              value={source?.id ?? ''}
              disabled={copying}
              onChange={(event) => { setError(null); setSourceId(event.target.value); setSelectedIds((prev) => prev.filter((id) => id !== event.target.value)); }}
              className={cn(fieldInputClass, 'mt-1.5')}
            >
              {screens.map((screen) => {
                const count = slidesByScreen.get(screen.id)?.length ?? 0;
                return <option key={screen.id} value={screen.id}>{screen.label} · {count} {count === 1 ? 'slide' : 'slides'}</option>;
              })}
            </select>
            {slides.length > 0 ? (
              <ul aria-label="Slides da tela de origem" className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                {slides.map((slide, index) => (
                  <li key={slide.id} className="w-[84px] shrink-0">
                    <SlideThumb slide={slide} className="w-full" />
                    <p className="mt-1 truncate text-[11px] text-ds-ink-muted">{index + 1}. {slide.title}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-ds-ink-muted">Esta tela ainda não tem slides.</p>
            )}
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-bold text-ds-ink-2">Copiar para</p>
            {targets.length > 1 && (
              <Button
                type="button"
                variant="ds-link"
                className="h-auto p-0 text-xs"
                disabled={copying}
                onClick={() => { setError(null); setSelectedIds(selectedIds.length === targets.length ? [] : targets.map((target) => target.id)); }}
              >
                {selectedIds.length === targets.length ? 'Limpar seleção' : 'Selecionar todas'}
              </Button>
            )}
          </div>
          <div className="flex max-h-[280px] flex-col gap-1.5 overflow-y-auto">
            {targets.map((target) => {
              const checked = selectedIds.includes(target.id);
              const alreadyThere = slides.filter((slide) => slide.screenIds.includes(target.id)).length;
              return (
                <label
                  key={target.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-ds-md border px-3 py-2 transition-colors',
                    checked ? 'border-ds-modal bg-ds-modal-soft' : 'border-ds-border-input bg-ds-surface hover:bg-ds-muted',
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={copying}
                    onCheckedChange={(next) => {
                      setError(null);
                      setSelectedIds((prev) => next === true ? [...prev, target.id] : prev.filter((id) => id !== target.id));
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[13px] font-bold', checked ? 'text-ds-modal-ink' : 'text-ds-ink')}>{target.label}</span>
                    <span className="block text-xs text-ds-ink-muted">
                      {alreadyThere === slides.length ? 'Já exibe todos estes slides' : alreadyThere > 0 ? `Já exibe ${alreadyThere} de ${slides.length}` : 'Ainda não exibe nenhum'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-ds-ink-muted">
            Cada tela guarda a própria ordem. Depois de copiar, publique as telas de destino para a mudança chegar às TVs.
          </p>
          {error && <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p>}
        </div>

        <div className="flex items-center gap-3 border-t border-ds-border-footer bg-ds-surface px-7 py-4">
          <Button type="button" variant="ds-ghost" size="md" disabled={copying} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            type="button"
            variant="primary-modal"
            size="md"
            className="ml-auto"
            loading={copying}
            loadingLabel={progress ? `Copiando ${progress.done} de ${progress.total}…` : 'Copiando…'}
            onClick={() => void handleCopy()}
          >
            Copiar playlist
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
