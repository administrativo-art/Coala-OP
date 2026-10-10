"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { UploadCloud, X } from 'lucide-react';

import { Field, fieldInputClass } from '@/components/patterns/field';
import { InlineConfirm } from '@/components/patterns/inline-confirm';
import { Segmented } from '@/components/patterns/segmented';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  formatSignageDuration,
  getSlideOrder,
  SIGNAGE_IMAGE_MAX_BYTES,
  SIGNAGE_IMAGE_TEXT_MAX_DURATION_MS,
  SIGNAGE_MIN_DURATION_MS,
  SIGNAGE_VIDEO_MAX_BYTES,
  SIGNAGE_VIDEO_MAX_DURATION_MS,
} from '@/lib/signage';
import { cn } from '@/lib/utils';
import { type SignageMediaItem, type SignageSlide, type SignageSlideType } from '@/types';

import { DEFAULT_TEXT_BACKGROUND, describeSchedule, SLIDE_TYPE_LABEL, type ScreenOption } from './signage-admin-shared';

const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export type SignageApiRequest = <T = unknown>(
  input: string,
  init?: { method?: string; json?: unknown; body?: BodyInit; fallbackError?: string; timeoutMs?: number }
) => Promise<T>;

type DurationUnit = 'seconds' | 'minutes';

type SlideFormState = {
  title: string;
  type: SignageSlideType;
  durationMs: number;
  screenIds: string[];
  isActive: boolean;
  assetUrl?: string;
  assetPath?: string;
  assetKind?: 'image' | 'video';
  assetName?: string;
  text: string;
  background: string;
  scheduleTimeEnabled: boolean;
  scheduleStartTime: string;
  scheduleEndTime: string;
  scheduleDateEnabled: boolean;
  scheduleStartDate: string;
  scheduleEndDate: string;
};

type FormErrors = Partial<Record<'title' | 'duration' | 'media' | 'text' | 'screens' | 'scheduleTime' | 'scheduleDate', string>>;

function initialForm(slide: SignageSlide | null, defaultScreenIds: string[], screens: ScreenOption[]): SlideFormState {
  return {
    title: slide?.title ?? '',
    type: slide?.type ?? 'image',
    durationMs: slide?.durationMs ?? 10_000,
    // Só as telas que quem edita enxerga; o servidor preserva as demais.
    screenIds: slide ? slide.screenIds.filter((screenId) => screens.some((screen) => screen.id === screenId)) : defaultScreenIds,
    isActive: slide?.isActive ?? true,
    assetUrl: slide?.assetUrl,
    assetPath: slide?.assetPath,
    assetKind: slide?.assetKind,
    text: slide?.text ?? '',
    background: slide?.background ?? DEFAULT_TEXT_BACKGROUND,
    scheduleTimeEnabled: Boolean(slide?.schedule?.startTime || slide?.schedule?.endTime),
    scheduleStartTime: slide?.schedule?.startTime ?? '08:00',
    scheduleEndTime: slide?.schedule?.endTime ?? '18:00',
    scheduleDateEnabled: Boolean(slide?.schedule?.startDate || slide?.schedule?.endDate),
    scheduleStartDate: slide?.schedule?.startDate ?? '',
    scheduleEndDate: slide?.schedule?.endDate ?? '',
  };
}

function getDurationParts(durationMs: number): { value: number; unit: DurationUnit } {
  if (durationMs >= 60_000 && durationMs % 60_000 === 0) return { value: durationMs / 60_000, unit: 'minutes' };
  return { value: Math.max(1, Math.round(durationMs / 1000)), unit: 'seconds' };
}

function toDurationMs(value: number, unit: DurationUnit) {
  return unit === 'minutes' ? value * 60_000 : value * 1000;
}

function maxDurationMs(type: SignageSlideType) {
  return type === 'video' ? SIGNAGE_VIDEO_MAX_DURATION_MS : SIGNAGE_IMAGE_TEXT_MAX_DURATION_MS;
}

function getVideoDurationMs(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    // Só endereços `blob:` do próprio navegador chegam ao elemento de vídeo.
    if (!url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a duração do vídeo.'));
      return;
    }
    const video = document.createElement('video');

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const durationSeconds = Number.isFinite(video.duration) ? video.duration : 0;
      URL.revokeObjectURL(url);
      resolve(Math.max(SIGNAGE_MIN_DURATION_MS, Math.round(durationSeconds * 1000)));
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a duração do vídeo.'));
    };
    video.src = url;
  });
}

function validate(form: SlideFormState): FormErrors {
  const errors: FormErrors = {};
  if (form.title.trim().length < 2) errors.title = 'Dê um título com pelo menos 2 caracteres.';
  if (form.durationMs < SIGNAGE_MIN_DURATION_MS) errors.duration = 'A duração mínima é de 3 segundos.';
  else if (form.durationMs > maxDurationMs(form.type)) {
    errors.duration = form.type === 'video' ? 'Vídeos podem ter no máximo 30 minutos.' : 'Imagem e texto podem ficar no máximo 2 minutos.';
  }
  if (form.type === 'text' && !form.text.trim()) errors.text = 'Escreva a mensagem que a tela vai exibir.';
  if (form.type !== 'text' && !form.assetPath) errors.media = form.type === 'video' ? 'Envie o vídeo deste slide.' : 'Envie a imagem deste slide.';
  if (!form.screenIds.length) errors.screens = 'Escolha ao menos uma tela.';
  if (form.scheduleTimeEnabled && (!form.scheduleStartTime || !form.scheduleEndTime)) {
    errors.scheduleTime = 'Informe o horário de início e de fim.';
  }
  if (form.scheduleDateEnabled) {
    if (!form.scheduleStartDate && !form.scheduleEndDate) errors.scheduleDate = 'Informe ao menos uma das datas.';
    else if (form.scheduleStartDate && form.scheduleEndDate && form.scheduleEndDate < form.scheduleStartDate) {
      errors.scheduleDate = 'A data final precisa ser igual ou posterior à inicial.';
    }
  }
  return errors;
}

function SideFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ds-on-dark-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-bold text-ds-on-dark">{value}</dd>
    </div>
  );
}

type SignageSlideDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slide: SignageSlide | null;
  defaultScreenIds: string[];
  /** Posição de um slide que entra em cada tela: o fim da playlist dela. */
  nextOrderByScreen: Record<string, number>;
  screens: ScreenOption[];
  request: SignageApiRequest;
  onSaved: () => void | Promise<void>;
  /** Abre a biblioteca como seletor; a mídia escolhida volta por `onPick`. */
  onOpenLibrary?: (kind: 'image' | 'video', onPick: (item: SignageMediaItem) => void) => void;
};

export function SignageSlideDialog({ open, onOpenChange, slide, defaultScreenIds, nextOrderByScreen, screens, request, onSaved, onOpenLibrary }: SignageSlideDialogProps) {
  const formId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<SlideFormState>(() => initialForm(slide, defaultScreenIds, screens));
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('seconds');

  useEffect(() => {
    if (!open) return;
    const nextForm = initialForm(slide, defaultScreenIds, screens);
    setForm(nextForm);
    setDurationUnit(getDurationParts(nextForm.durationMs).unit);
    setErrors({});
    setSaveError(null);
    setDirty(false);
    setConfirmDiscard(false);
    // Reinicia só ao abrir; as listas de telas mudam de identidade a cada render do painel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slide]);

  function update(patch: Partial<SlideFormState>, clear: Array<keyof FormErrors> = []) {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
    setSaveError(null);
    if (clear.length) {
      setErrors((prev) => {
        const next = { ...prev };
        clear.forEach((key) => delete next[key]);
        return next;
      });
    }
  }

  function requestClose() {
    if (saving || uploading) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(false);
  }

  function changeType(type: SignageSlideType) {
    const keepsAsset = type !== 'text' && form.assetKind === type;
    update({
      type,
      assetKind: type === 'text' ? undefined : type,
      assetUrl: keepsAsset ? form.assetUrl : undefined,
      assetPath: keepsAsset ? form.assetPath : undefined,
      assetName: keepsAsset ? form.assetName : undefined,
      durationMs: Math.min(form.durationMs, maxDurationMs(type)),
    }, ['media', 'text', 'duration']);
  }

  async function handleFile(file: File | undefined) {
    if (!file || uploading) return;
    const expectsVideo = form.type === 'video';
    if (expectsVideo ? !file.type.startsWith('video/') : !file.type.startsWith('image/')) {
      setErrors((prev) => ({ ...prev, media: expectsVideo ? 'Este slide é de vídeo: envie um arquivo MP4.' : 'Este slide é de imagem: envie JPG, PNG ou WebP.' }));
      return;
    }
    if (file.size > (expectsVideo ? SIGNAGE_VIDEO_MAX_BYTES : SIGNAGE_IMAGE_MAX_BYTES)) {
      setErrors((prev) => ({ ...prev, media: expectsVideo ? 'O vídeo passa do limite de 30 MB.' : 'A imagem passa do limite de 2 MB.' }));
      return;
    }

    try {
      setUploading(true);
      setErrors((prev) => ({ ...prev, media: undefined }));
      const detectedVideoDurationMs = expectsVideo ? await getVideoDurationMs(file).catch(() => null) : null;
      const body = new FormData();
      body.append('file', file);
      // O envio pelo slide também guarda a mídia na biblioteca, para ela poder ser reutilizada.
      const { item } = await request<{ item: SignageMediaItem }>('/api/signage/media', {
        method: 'POST',
        body,
        fallbackError: 'Falha no upload.',
        timeoutMs: UPLOAD_TIMEOUT_MS,
      });
      const data = { assetUrl: item.assetUrl, assetPath: item.assetPath, assetKind: item.kind };
      if (data.assetKind !== form.type) {
        setErrors((prev) => ({ ...prev, media: data.assetKind === 'video' ? 'O arquivo enviado é um vídeo; troque o tipo do slide.' : 'O arquivo enviado é uma imagem; troque o tipo do slide.' }));
        return;
      }
      const patch: Partial<SlideFormState> = {
        assetUrl: data.assetUrl,
        assetPath: data.assetPath,
        assetKind: data.assetKind,
        assetName: file.name,
      };
      if (detectedVideoDurationMs) {
        patch.durationMs = Math.min(detectedVideoDurationMs, SIGNAGE_VIDEO_MAX_DURATION_MS);
        setDurationUnit('seconds');
      }
      update(patch, ['media', 'duration']);
    } catch (error) {
      setErrors((prev) => ({ ...prev, media: error instanceof Error ? error.message : 'Falha no upload.' }));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSave() {
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const schedule = Object.fromEntries(Object.entries({
      startTime: form.scheduleTimeEnabled ? form.scheduleStartTime : undefined,
      endTime: form.scheduleTimeEnabled ? form.scheduleEndTime : undefined,
      startDate: form.scheduleDateEnabled ? form.scheduleStartDate || undefined : undefined,
      endDate: form.scheduleDateEnabled ? form.scheduleEndDate || undefined : undefined,
    }).filter(([, value]) => value !== undefined));

    const payload = {
      title: form.title.trim(),
      type: form.type,
      durationMs: form.durationMs,
      order: slide?.order ?? 0,
      screenIds: form.screenIds,
      orderByScreen: Object.fromEntries(form.screenIds.map((screenId) => [
        screenId,
        slide?.screenIds.includes(screenId) ? getSlideOrder(slide, screenId) : nextOrderByScreen[screenId] ?? 0,
      ])),
      isActive: form.isActive,
      assetPath: form.type === 'text' ? undefined : form.assetPath,
      assetKind: form.type === 'text' ? undefined : form.assetKind,
      text: form.type === 'text' ? form.text.trim() : undefined,
      background: form.type === 'text' ? form.background : undefined,
      schedule: Object.keys(schedule).length ? schedule : undefined,
    };

    try {
      setSaving(true);
      setSaveError(null);
      await request(slide ? `/api/signage/slides/${slide.id}` : '/api/signage/slides', {
        method: slide ? 'PUT' : 'POST',
        json: payload,
        fallbackError: 'Falha ao salvar o slide.',
      });
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Falha ao salvar o slide.');
    } finally {
      setSaving(false);
    }
  }

  const durationValue = durationUnit === 'minutes' ? Math.max(1, Math.round(form.durationMs / 60_000)) : Math.max(1, Math.round(form.durationMs / 1000));
  const allSelected = screens.length > 0 && screens.every((screen) => form.screenIds.includes(screen.id));
  const overnight = form.scheduleTimeEnabled && form.scheduleStartTime && form.scheduleEndTime && form.scheduleEndTime < form.scheduleStartTime;

  const selectedScreenLabels = screens.filter((screen) => form.screenIds.includes(screen.id)).map((screen) => screen.label);
  const scheduleSummary = describeSchedule({
    startTime: form.scheduleTimeEnabled ? form.scheduleStartTime || undefined : undefined,
    endTime: form.scheduleTimeEnabled ? form.scheduleEndTime || undefined : undefined,
    startDate: form.scheduleDateEnabled ? form.scheduleStartDate || undefined : undefined,
    endDate: form.scheduleDateEnabled ? form.scheduleEndDate || undefined : undefined,
  });

  const preview = (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-ds-btn bg-black ring-1 ring-white/10"
      style={form.type === 'text' ? { background: form.background || DEFAULT_TEXT_BACKGROUND } : undefined}
    >
      {form.type === 'text' ? (
        <span className="absolute inset-0 flex items-center justify-center p-4 text-center text-[15px] font-semibold leading-tight text-white">
          {form.text || 'Sua mensagem aparece aqui'}
        </span>
      ) : form.assetUrl ? (
        form.type === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element -- mídia servida pela rota de assets do signage
          <img src={form.assetUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <video src={form.assetUrl} className="h-full w-full object-contain" muted loop playsInline autoPlay controls />
        )
      ) : (
        <span className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-ds-on-dark-2">
          Envie a mídia para ver a prévia
        </span>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (nextOpen) onOpenChange(true); else requestClose(); }}>
      <DialogContent
        flush
        hideClose
        className="grid h-[min(780px,calc(100vh-48px))] w-[min(980px,calc(100vw-32px))] grid-cols-1 gap-0 overflow-hidden rounded-ds-modal border-0 bg-ds-input font-ds shadow-ds-modal sm:max-w-none sm:rounded-ds-modal md:grid-cols-[340px_minmax(0,1fr)]"
      >
        <aside className="hidden min-h-0 flex-col gap-5 overflow-y-auto bg-ds-dark px-7 py-[30px] text-ds-on-dark md:flex">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">{slide ? 'Editar slide' : 'Novo slide'}</p>
          <p className={cn('break-words text-[26px] font-extrabold leading-[1.08] tracking-[-0.03em]', !form.title.trim() && 'text-ds-on-dark-muted')}>
            {form.title.trim() || 'Sem título'}
          </p>
          <div className="space-y-2">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">Como fica na tela</p>
            {preview}
          </div>
          <dl className="space-y-2.5 rounded-ds-btn-lg bg-white/[.06] p-4 text-[12.5px]">
            <SideFact label="Tipo" value={SLIDE_TYPE_LABEL[form.type]} />
            <SideFact label="Tempo na tela" value={formatSignageDuration(form.durationMs)} />
            <SideFact label="Quando" value={scheduleSummary ?? 'O dia todo'} />
            <SideFact
              label="Telas"
              value={selectedScreenLabels.length === 0 ? 'Nenhuma' : selectedScreenLabels.length === 1 ? selectedScreenLabels[0] : `${selectedScreenLabels.length} telas`}
            />
            <SideFact label="Situação" value={form.isActive ? 'Ativo' : 'Pausado'} />
          </dl>
          <p className="mt-auto text-[11.5px] text-ds-on-dark-muted">A alteração chega à TV depois que a tela for publicada.</p>
        </aside>

        <div className="flex min-h-0 flex-col">
          <header className="flex items-start gap-4 border-b border-ds-border-footer px-7 pb-[18px] pt-6">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[21px] font-extrabold tracking-[-0.02em] text-ds-ink">{slide ? 'Editar slide' : 'Adicionar slide'}</DialogTitle>
              <DialogDescription className="mt-0.5 text-[13px] text-ds-ink-muted">
                Defina o conteúdo, por quanto tempo aparece e em quais telas.
              </DialogDescription>
            </div>
            <button
              type="button"
              aria-label="Fechar"
              onClick={requestClose}
              className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-ds-md text-ds-ink-muted hover:bg-ds-page hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-7 py-6">
            <div className="space-y-1.5 md:hidden">
              <p className="text-xs font-bold text-ds-ink-2">Como fica na tela</p>
              {preview}
            </div>

            <Field label="Título" htmlFor={`${formId}-title`} hint="Só aparece aqui no editor, para você reconhecer o slide." error={errors.title}>
              <input
                id={`${formId}-title`}
                className={fieldInputClass}
                value={form.title}
                maxLength={120}
                aria-invalid={Boolean(errors.title)}
                onChange={(event) => update({ title: event.target.value }, ['title'])}
              />
            </Field>

            <Field label="Tipo">
              <Segmented<SignageSlideType>
                aria-label="Tipo do slide"
                value={form.type}
                onChange={changeType}
                options={[
                  { value: 'image', label: SLIDE_TYPE_LABEL.image },
                  { value: 'video', label: SLIDE_TYPE_LABEL.video },
                  { value: 'text', label: SLIDE_TYPE_LABEL.text },
                ]}
              />
            </Field>

            {form.type === 'text' ? (
              <>
                <Field label="Mensagem" htmlFor={`${formId}-text`} error={errors.text}>
                  <textarea
                    id={`${formId}-text`}
                    rows={3}
                    maxLength={1200}
                    value={form.text}
                    aria-invalid={Boolean(errors.text)}
                    onChange={(event) => update({ text: event.target.value }, ['text'])}
                    className={cn(fieldInputClass, 'h-auto resize-y py-2.5')}
                  />
                </Field>
                <Field label="Cor de fundo" htmlFor={`${formId}-background`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Escolher cor de fundo"
                      value={form.background}
                      onChange={(event) => update({ background: event.target.value })}
                      className="h-10 w-12 shrink-0 cursor-pointer rounded-ds-md border border-ds-border-input bg-ds-input p-1"
                    />
                    <input
                      id={`${formId}-background`}
                      value={form.background}
                      maxLength={32}
                      onChange={(event) => update({ background: event.target.value })}
                      className={cn(fieldInputClass, 'font-ds-mono')}
                    />
                  </div>
                </Field>
              </>
            ) : (
              <Field
                label={form.type === 'video' ? 'Vídeo' : 'Imagem'}
                hint={form.type === 'video' ? 'MP4 de até 30 MB, em 1920×1080 para ocupar a tela toda.' : 'JPG, PNG ou WebP de até 2 MB, em 1920×1080 para ocupar a tela toda.'}
                error={errors.media}
              >
                <label
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    void handleFile(event.dataTransfer.files?.[0]);
                  }}
                  className={cn(
                    'flex min-h-[92px] cursor-pointer flex-col items-center justify-center gap-1 rounded-ds-btn border border-dashed px-4 py-4 text-center transition-colors',
                    'focus-within:border-ds-modal focus-within:ring-[3px] focus-within:ring-ds-modal-soft',
                    dragging ? 'border-ds-modal bg-ds-modal-soft' : 'border-ds-border-input bg-ds-surface hover:bg-ds-muted',
                    errors.media && 'border-ds-danger',
                    uploading && 'cursor-progress',
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="sr-only"
                    disabled={uploading}
                    accept={form.type === 'video' ? 'video/mp4' : 'image/webp,image/jpeg,image/png'}
                    onChange={(event) => void handleFile(event.target.files?.[0])}
                  />
                  <UploadCloud aria-hidden="true" className="h-5 w-5 text-ds-ink-muted" />
                  {uploading ? (
                    <span role="status" className="text-[13px] font-bold text-ds-ink">Enviando arquivo…</span>
                  ) : form.assetPath ? (
                    <>
                      <span className="max-w-full truncate text-[13px] font-bold text-ds-ink">{form.assetName ?? 'Mídia enviada'}</span>
                      <span className="text-xs font-bold text-ds-modal-ink">Trocar arquivo</span>
                    </>
                  ) : (
                    <>
                      <span className="text-[13px] font-bold text-ds-ink">Arraste o arquivo ou clique para escolher</span>
                      <span className="text-xs text-ds-ink-muted">{form.type === 'video' ? 'Vídeo MP4' : 'Imagem JPG, PNG ou WebP'}</span>
                    </>
                  )}
                </label>
                {onOpenLibrary && (
                  <Button
                    type="button"
                    variant="ds-link"
                    size="xs"
                    className="mt-2 h-auto p-0"
                    disabled={uploading}
                    onClick={() => onOpenLibrary(form.type === 'video' ? 'video' : 'image', (item) => {
                      update({ assetUrl: item.assetUrl, assetPath: item.assetPath, assetKind: item.kind, assetName: item.fileName }, ['media']);
                    })}
                  >
                    Escolher da biblioteca
                  </Button>
                )}
              </Field>
            )}

            <Field
              label="Tempo na tela"
              htmlFor={`${formId}-duration`}
              hint={form.type === 'video' ? 'Preenchido com a duração do vídeo; ajuste se quiser cortar antes do fim.' : 'Entre 3 segundos e 2 minutos.'}
              error={errors.duration}
            >
              <div className="flex items-center gap-2">
                <input
                  id={`${formId}-duration`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={durationValue}
                  aria-invalid={Boolean(errors.duration)}
                  onChange={(event) => update({ durationMs: toDurationMs(Math.max(1, Math.round(Number(event.target.value) || 1)), durationUnit) }, ['duration'])}
                  className={cn(fieldInputClass, 'w-24')}
                />
                <Segmented<DurationUnit>
                  aria-label="Unidade de tempo"
                  value={durationUnit}
                  onChange={(unit) => {
                    setDurationUnit(unit);
                    update({ durationMs: toDurationMs(durationValue, unit) }, ['duration']);
                  }}
                  options={[{ value: 'seconds', label: 'segundos' }, { value: 'minutes', label: 'minutos' }]}
                />
              </div>
            </Field>

            <fieldset className="space-y-3 rounded-ds-btn border border-ds-border bg-ds-surface p-4">
              <legend className="px-1 text-xs font-bold text-ds-ink-2">Quando exibir</legend>
              <p className="text-xs text-ds-ink-muted">Sem limites, o slide passa o dia todo, todos os dias.</p>

              <label className="flex cursor-pointer items-center gap-2.5 text-[13px] font-semibold text-ds-ink">
                <Checkbox
                  checked={form.scheduleTimeEnabled}
                  onCheckedChange={(checked) => update({ scheduleTimeEnabled: checked === true }, ['scheduleTime'])}
                />
                Só em um horário do dia
              </label>
              {form.scheduleTimeEnabled && (
                <div className="space-y-1.5 pl-[26px]">
                  <div className="flex items-center gap-2">
                    <input type="time" aria-label="Horário de início" value={form.scheduleStartTime} onChange={(event) => update({ scheduleStartTime: event.target.value }, ['scheduleTime'])} className={fieldInputClass} />
                    <span className="shrink-0 text-[13px] text-ds-ink-muted">até</span>
                    <input type="time" aria-label="Horário de fim" value={form.scheduleEndTime} onChange={(event) => update({ scheduleEndTime: event.target.value }, ['scheduleTime'])} className={fieldInputClass} />
                  </div>
                  {errors.scheduleTime ? (
                    <p role="alert" className="text-xs font-semibold text-ds-danger">{errors.scheduleTime}</p>
                  ) : overnight ? (
                    <p className="text-xs text-ds-ink-muted">Intervalo noturno: vai até {form.scheduleEndTime} do dia seguinte.</p>
                  ) : null}
                </div>
              )}

              <label className="flex cursor-pointer items-center gap-2.5 text-[13px] font-semibold text-ds-ink">
                <Checkbox
                  checked={form.scheduleDateEnabled}
                  onCheckedChange={(checked) => update({ scheduleDateEnabled: checked === true }, ['scheduleDate'])}
                />
                Só em um período de datas
              </label>
              {form.scheduleDateEnabled && (
                <div className="space-y-1.5 pl-[26px]">
                  <div className="flex items-center gap-2">
                    <input type="date" aria-label="Data inicial" value={form.scheduleStartDate} onChange={(event) => update({ scheduleStartDate: event.target.value }, ['scheduleDate'])} className={fieldInputClass} />
                    <span className="shrink-0 text-[13px] text-ds-ink-muted">até</span>
                    <input type="date" aria-label="Data final" value={form.scheduleEndDate} onChange={(event) => update({ scheduleEndDate: event.target.value }, ['scheduleDate'])} className={fieldInputClass} />
                  </div>
                  {errors.scheduleDate && <p role="alert" className="text-xs font-semibold text-ds-danger">{errors.scheduleDate}</p>}
                </div>
              )}
            </fieldset>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-bold text-ds-ink-2">Telas que exibem</p>
                {screens.length > 1 && (
                  <Button
                    type="button"
                    variant="ds-link"
                    className="h-auto p-0 text-xs"
                    onClick={() => update({ screenIds: allSelected ? [] : screens.map((screen) => screen.id) }, ['screens'])}
                  >
                    {allSelected ? 'Limpar seleção' : 'Selecionar todas'}
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {screens.map((screen) => {
                  const checked = form.screenIds.includes(screen.id);
                  return (
                    <label
                      key={screen.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-ds-md border px-3 py-2 text-[13px] font-semibold transition-colors',
                        checked ? 'border-ds-modal bg-ds-modal-soft text-ds-modal-ink' : 'border-ds-border-input bg-ds-surface text-ds-ink-2 hover:bg-ds-muted',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => update({
                          screenIds: next === true ? [...form.screenIds, screen.id] : form.screenIds.filter((id) => id !== screen.id),
                        }, ['screens'])}
                      />
                      <span className="min-w-0 truncate">{screen.label}</span>
                    </label>
                  );
                })}
              </div>
              {errors.screens && <p role="alert" className="text-xs font-semibold text-ds-danger">{errors.screens}</p>}
            </div>


            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2.5">
              <span>
                <span className="block text-[13px] font-bold text-ds-ink">Slide ativo</span>
                <span className="block text-xs text-ds-ink-muted">Pausado, ele fica guardado sem ir para a tela.</span>
              </span>
              <Switch checked={form.isActive} onCheckedChange={(checked) => update({ isActive: checked })} />
            </label>
          </div>

          <footer className="border-t border-ds-border-footer bg-ds-surface px-7 py-4">
            {confirmDiscard ? (
              <InlineConfirm
                message="Descartar as alterações deste slide?"
                confirmLabel="Descartar"
                loadingLabel="Descartando…"
                onConfirm={() => onOpenChange(false)}
                onCancel={() => setConfirmDiscard(false)}
              />
            ) : (
              <div className="flex items-center gap-3">
                <Button type="button" variant="ds-ghost" size="md" onClick={requestClose} disabled={saving}>Cancelar</Button>
                {saveError && <p role="alert" className="min-w-0 flex-1 text-xs font-semibold text-ds-danger">{saveError}</p>}
                <Button type="button" variant="primary-modal" size="md" className="ml-auto" loading={saving} disabled={uploading} onClick={() => void handleSave()}>
                  {slide ? 'Salvar alterações' : 'Adicionar slide'}
                </Button>
              </div>
            )}
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
