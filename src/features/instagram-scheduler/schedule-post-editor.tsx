"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AtSign,
  Bookmark,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Heart,
  ImageOff,
  Images,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Send,
  Volume2,
} from "lucide-react";

import {
  instagramStatusLabels,
  type InstagramScheduleListItem,
} from "./contracts";
import { Field } from "@/components/patterns/field";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { StatTile } from "@/components/patterns/stat-tile";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { ProtectedMedia } from "./protected-media";
import { MediaFormatInfo } from "./media-format-info";
import { carouselHasDifferentRatios, mediaPreviewRatio, mediaRatio, type MediaDimensions } from "./media-presentation";
import { ScheduleDatePicker, ScheduleTimeInput } from "./schedule-date-time-fields";
import {
  dateKeyInBelem,
  formatTheme,
  instagramPostTitle,
  isScheduleEditable,
  longDate,
  minimumScheduleDateTimeInBelem,
  scheduleAtInBelem,
  timeInBelem,
} from "./workspace-utils";

type SchedulePostEditorProps = {
  item: InstagramScheduleListItem;
  onClose: () => void;
  onUpdate: (
    id: string,
    changes: { scheduledAt?: string; mediaOrder?: number[]; caption?: string },
  ) => Promise<boolean>;
  onCancel: (id: string) => Promise<boolean>;
};

const statusVariant: Record<InstagramScheduleListItem["status"], StatusPillVariant> = {
  uploading: "info",
  scheduled: "info",
  processing: "warn",
  paused: "neutral",
  published: "ok",
  failed: "danger",
  manual_review: "warn",
  cancelled: "neutral",
};

const formatDot: Record<InstagramScheduleListItem["format"], string> = {
  feed_image: "bg-ds-info",
  carousel: "bg-ds-warn",
  reel: "bg-ds-accent",
  story: "bg-ds-ink",
};

function bytesLabel(value: number) {
  if (value < 1_024 * 1_024) return `${Math.max(1, Math.round(value / 1_024))} KB`;
  return `${(value / (1_024 * 1_024)).toFixed(1).replace(".", ",")} MB`;
}

export function SchedulePostEditor({ item, onClose, onUpdate, onCancel }: SchedulePostEditorProps) {
  const editable = isScheduleEditable(item);
  const theme = formatTheme[item.format];
  const originalDate = dateKeyInBelem(item.scheduledAt);
  const originalTime = timeInBelem(item.scheduledAt);
  const [minimumSchedule, setMinimumSchedule] = useState(() => minimumScheduleDateTimeInBelem());
  const [date, setDate] = useState(originalDate);
  const [time, setTime] = useState(originalTime);
  const [caption, setCaption] = useState(item.caption);
  const [dimensions, setDimensions] = useState<Record<string, MediaDimensions>>({});
  const [mediaOrder, setMediaOrder] = useState(() => item.media.map((_, index) => index));
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const scheduledAt = useMemo(() => scheduleAtInBelem(date, time), [date, time]);
  const scheduleChanged = date !== originalDate || time !== originalTime;
  const orderChanged = mediaOrder.some((originalIndex, index) => originalIndex !== index);
  const captionChanged = caption !== item.caption;
  const changed = scheduleChanged || orderChanged || captionChanged;
  const orderedMedia = useMemo(
    () => mediaOrder.map((originalIndex) => item.media[originalIndex]).filter((media) => media !== undefined)
      .map((media) => ({ ...media, ...dimensions[media.previewUrl ?? ""] })),
    [item.media, mediaOrder, dimensions],
  );
  const activeMedia = orderedMedia[activeMediaIndex] ?? orderedMedia[0] ?? null;
  const mixedCarousel = item.format === "carousel" && carouselHasDifferentRatios(orderedMedia);

  function recordDimensions(url: string | null, value: MediaDimensions) {
    if (!url) return;
    setDimensions((current) => current[url]?.width === value.width && current[url]?.height === value.height
      ? current : { ...current, [url]: value });
  }

  useEffect(() => {
    const updateMinimum = () => setMinimumSchedule(minimumScheduleDateTimeInBelem());
    const interval = window.setInterval(updateMinimum, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  function showPreviousMedia() {
    setActiveMediaIndex((current) => (current - 1 + orderedMedia.length) % orderedMedia.length);
  }

  function showNextMedia() {
    setActiveMediaIndex((current) => (current + 1) % orderedMedia.length);
  }

  function moveMedia(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= mediaOrder.length) return;
    setMediaOrder((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
    setActiveMediaIndex(nextIndex);
  }

  async function save() {
    if (!editable || !changed) return;
    if (scheduleChanged && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setLocalError("Digite o horário no formato HH:MM.");
      return;
    }
    if (scheduleChanged && (date < minimumSchedule.date || (date === minimumSchedule.date && time < minimumSchedule.time))) {
      setLocalError("Escolha um horário com pelo menos dois minutos de antecedência.");
      return;
    }
    if (!scheduledAt) {
      setLocalError("Escolha uma data e um horário válidos.");
      return;
    }
    setSaving(true);
    setLocalError(null);
    try {
      const saved = await onUpdate(item.id, {
        ...(captionChanged ? { caption } : {}),
        ...(scheduleChanged ? { scheduledAt } : {}),
        ...(orderChanged ? { mediaOrder } : {}),
      });
      if (saved) onClose();
    } finally {
      setSaving(false);
    }
  }

  async function cancelSchedule() {
    if (!editable) return;
    setSaving(true);
    setLocalError(null);
    try {
      const cancelled = await onCancel(item.id);
      if (cancelled) onClose();
    } finally {
      setSaving(false);
      setConfirmingCancel(false);
    }
  }

  const panelClass = "rounded-ds-card-lg border border-ds-border bg-ds-surface p-4";
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-ds-warm font-ds text-ds-ink" aria-labelledby="instagram-editor-title">
      <header className="flex flex-wrap items-center gap-3 border-b border-ds-border bg-ds-dark px-4 py-4 md:px-7">
        <Button type="button" variant="on-dark-secondary" size="md" onClick={onClose}>← Voltar</Button>
        <div className="min-w-0">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Publicação · {theme.label}</p>
          <h1 id="instagram-editor-title" className="truncate text-[22px] font-extrabold tracking-[-0.02em] text-ds-on-dark">
            {instagramPostTitle(item)}
          </h1>
        </div>
        <StatusPill variant={statusVariant[item.status]}>{instagramStatusLabels[item.status]}</StatusPill>
        {item.permalink && (
          <Button asChild variant="on-dark-secondary" size="md" className="ml-auto">
            <a href={item.permalink} target="_blank" rel="noreferrer">Ver no Instagram ↗</a>
          </Button>
        )}
      </header>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6 overflow-auto px-4 py-5 md:px-7 md:py-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={panelClass}>
              <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Formato</p>
              <div className="mt-2 flex items-center gap-2 text-[16px] font-extrabold">
                <span className={cn("h-3 w-3 rounded-full", formatDot[item.format])} />
                {theme.label}
              </div>
              {orderedMedia.length > 1 && <p className="mt-2 text-[11px] text-ds-ink-muted">Mídia {activeMediaIndex + 1} de {orderedMedia.length}</p>}
              <MediaFormatInfo format={item.format} media={activeMedia} />
              {mixedCarousel && <p className="mt-2 text-[11px] text-ds-warn">Proporções diferentes: o carrossel usa o enquadramento da primeira mídia e pode cortar as demais.</p>}
            </div>
            <StatTile label="Publicação" value={<span className="text-[18px]">{longDate(originalDate)} · <span className="font-ds-mono">{originalTime}</span></span>} />
            <StatTile label="Destino" value={<span className="text-[18px]">Instagram{item.shareToFeed && item.format === "reel" ? " + grade" : ""}</span>} />
          </div>

          <section aria-labelledby="editor-media-title">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 id="editor-media-title" className="text-[14px] font-extrabold">Mídia</h2>
              <span className="text-[12px] text-ds-ink-muted">{item.media.length} {item.media.length === 1 ? "arquivo" : "arquivos"}</span>
            </div>
            {item.format === "story" && item.media.length > 1 && (
              <p className="mb-3 rounded-ds-btn border border-ds-border bg-ds-accent-soft px-3 py-2 text-[12px] font-semibold leading-5 text-ds-accent-ink">
                A Meta publicará os quadros na ordem abaixo, do 1 ao {item.media.length}.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {orderedMedia.map((media, index) => (
                <div
                  key={`${media.fileName}-${mediaOrder[index]}`}
                  className={cn("overflow-hidden rounded-ds-btn-lg border bg-white", activeMediaIndex === index ? "border-ds-accent-ink" : "border-ds-border")}
                >
                  <button
                    type="button"
                    aria-pressed={activeMediaIndex === index}
                    onClick={() => setActiveMediaIndex(index)}
                    className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
                  >
                    <div className="relative" style={{ aspectRatio: mediaRatio(media) ?? 1 }}>
                      {media.previewUrl || media.kind === "video" ? (
                        <ProtectedMedia
                          url={media.previewUrl}
                          kind={media.kind}
                          alt={`Mídia ${index + 1} de ${instagramPostTitle(item)}`}
                          eager={index === 0}
                          className="h-full w-full object-contain"
                          onDimensions={(value) => recordDimensions(media.previewUrl, value)}
                        />
                      ) : (
                        <div className="grid h-full place-items-center bg-ds-muted text-ds-ink-faint"><ImageOff className="h-6 w-6" /></div>
                      )}
                      {orderedMedia.length > 1 && (
                        <span className="absolute left-2 top-2 rounded-full bg-ds-dark/90 px-2 py-0.5 font-ds-mono text-[10px] font-bold text-white">{index + 1}</span>
                      )}
                    </div>
                    <div className="p-2.5">
                      <div className="truncate text-[11px] font-bold" title={media.fileName}>{media.fileName}</div>
                      <div className="mt-0.5 font-ds-mono text-[10px] text-ds-ink-muted">{bytesLabel(media.sizeBytes)}</div>
                      <MediaFormatInfo format={item.format} media={media} />
                    </div>
                  </button>
                  {editable && item.format === "story" && orderedMedia.length > 1 && (
                    <div className="grid grid-cols-2 border-t border-ds-divider">
                      <button
                        type="button"
                        onClick={() => moveMedia(index, -1)}
                        disabled={index === 0 || saving}
                        aria-label={`Mover ${media.fileName} para antes`}
                        className="flex items-center justify-center gap-1 border-r border-ds-divider px-2 py-2 text-[10px] font-extrabold text-ds-ink-muted hover:bg-ds-muted disabled:opacity-30"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Antes
                      </button>
                      <button
                        type="button"
                        onClick={() => moveMedia(index, 1)}
                        disabled={index === orderedMedia.length - 1 || saving}
                        aria-label={`Mover ${media.fileName} para depois`}
                        className="flex items-center justify-center gap-1 px-2 py-2 text-[10px] font-extrabold text-ds-ink-muted hover:bg-ds-muted disabled:opacity-30"
                      >
                        Depois <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {item.format !== "story" && (
            <section aria-labelledby="editor-caption-title">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 id="editor-caption-title" className="text-[14px] font-extrabold">Legenda</h2>
                <span className="font-ds-mono text-[12px] text-ds-ink-muted">{caption.length} / 2.200</span>
              </div>
              <textarea aria-labelledby="editor-caption-title" value={caption}
                onChange={(event) => setCaption(event.target.value)} disabled={!editable || saving}
                maxLength={2_200} rows={7} placeholder="Sem legenda."
                className="w-full resize-y rounded-ds-md border border-ds-border-input bg-ds-input p-4 text-[14px] leading-6 text-ds-ink placeholder:text-ds-ink-faint focus-visible:border-ds-modal focus-visible:bg-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ds-modal-soft disabled:opacity-75" />
            </section>
          )}

          {item.location && (
            <section className={cn(panelClass, "flex items-start gap-3")}>
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-ds-info" aria-hidden="true" />
              <div>
                <h2 className="text-[13px] font-extrabold">Localização marcada</h2>
                <p className="mt-0.5 text-[13px] text-ds-ink-muted">{item.location.name}</p>
              </div>
            </section>
          )}

          {item.storyMentions.length > 0 && (
            <section className={cn(panelClass, "flex items-start gap-3")}>
              <AtSign className="mt-0.5 h-5 w-5 shrink-0 text-ds-accent-ink" aria-hidden="true" />
              <div>
                <h2 className="text-[13px] font-extrabold">Menção no Story</h2>
                <p className="mt-0.5 text-[13px] text-ds-ink-muted">
                  {item.storyMentions.map((username) => `@${username}`).join(", ")} · sem adesivo visível
                </p>
              </div>
            </section>
          )}

          <section className={panelClass} aria-labelledby="editor-schedule-title">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-ds-accent-ink" aria-hidden="true" />
              <h2 id="editor-schedule-title" className="text-[14px] font-extrabold">Quando publicar</h2>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Field label="Data" className="min-w-[180px] flex-1">
                <ScheduleDatePicker
                  value={date}
                  minimum={minimumSchedule.date}
                  disabled={!editable || saving}
                  onChange={(value) => {
                    setDate(value);
                    setLocalError(null);
                  }}
                />
              </Field>
              <Field label="Horário · HH:MM" className="min-w-[150px] flex-1">
                <ScheduleTimeInput
                  value={time}
                  minimum={date === minimumSchedule.date ? minimumSchedule.time : undefined}
                  disabled={!editable || saving}
                  onChange={(value) => {
                    setTime(value);
                    setLocalError(null);
                  }}
                />
              </Field>
            </div>
            <p className="mt-3 text-[12px] leading-5 text-ds-ink-muted">
              {editable
                ? "Horário de São Luís. Escolha pelo menos dois minutos no futuro."
                : "Esta publicação está disponível somente para consulta."}
            </p>
            {localError && <p role="alert" className="mt-2 text-[12px] font-bold text-ds-danger">{localError}</p>}
          </section>
        </div>

        <aside className="border-t border-ds-border bg-ds-muted px-5 py-7 xl:border-l xl:border-t-0">
          <div className="sticky top-7 mx-auto flex max-w-[310px] flex-col items-center gap-3">
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Prévia · {theme.label}</div>
            <div className="w-full rounded-[34px] bg-[#283137] p-2.5 shadow-[0_20px_40px_rgba(74,26,4,.18)]">
              {item.format === "story" ? (
                <div className="relative aspect-[9/16] overflow-hidden rounded-[27px] bg-[#181818] text-white">
                  <ProtectedMedia
                    url={activeMedia?.previewUrl ?? null}
                    kind={activeMedia?.kind ?? "image"}
                    alt={`Prévia do Story de ${instagramPostTitle(item)}`}
                    className="h-full w-full object-contain"
                    onDimensions={(value) => recordDimensions(activeMedia?.previewUrl ?? null, value)}
                    previewVideo
                    eager
                  />
                  <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/55 to-transparent px-3 pb-12 pt-3">
                    <div className="flex gap-1">
                      {orderedMedia.map((media, index) => (
                        <span key={`${media.fileName}-story-progress`} className="h-0.5 flex-1 rounded bg-white/45">
                          <span className={`block h-full rounded ${index <= activeMediaIndex ? "w-full bg-white" : "w-0"}`} />
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-[11px] font-extrabold">
                      <span className="h-7 w-7 rounded-full border-2 border-white bg-[#FDE3EF]" />
                      <span>coalashakes</span>
                      <span className="font-medium text-white/75">agora</span>
                      <MoreHorizontal className="ml-auto h-4 w-4" aria-hidden="true" />
                    </div>
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/60 to-transparent px-3 pb-4 pt-14">
                    <span className="flex-1 rounded-full border border-white/80 px-3 py-2 text-[10px] font-semibold">Enviar mensagem</span>
                    <Heart className="h-5 w-5" aria-hidden="true" />
                    <Send className="h-5 w-5" aria-hidden="true" />
                  </div>
                  {orderedMedia.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={showPreviousMedia}
                        disabled={activeMediaIndex === 0}
                        aria-label="Story anterior"
                        className="absolute inset-y-16 left-0 w-1/3 disabled:cursor-default"
                      />
                      <button
                        type="button"
                        onClick={showNextMedia}
                        disabled={activeMediaIndex === orderedMedia.length - 1}
                        aria-label="Próximo Story"
                        className="absolute inset-y-16 right-0 w-1/3 disabled:cursor-default"
                      />
                    </>
                  )}
                </div>
              ) : item.format === "reel" ? (
                <div className="relative aspect-[9/16] overflow-hidden rounded-[27px] bg-[#181818] text-white">
                  <ProtectedMedia
                    url={activeMedia?.previewUrl ?? null}
                    kind={activeMedia?.kind ?? "video"}
                    alt={`Prévia do Reel de ${instagramPostTitle(item)}`}
                    className="h-full w-full object-contain"
                    onDimensions={(value) => recordDimensions(activeMedia?.previewUrl ?? null, value)}
                    previewVideo
                    eager
                  />
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/50 to-transparent px-4 pb-12 pt-4 text-[15px] font-extrabold">
                    <span>Reels</span>
                    <Volume2 className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 grid grid-cols-[1fr_auto] items-end gap-3 bg-gradient-to-t from-black/75 to-transparent px-3 pb-4 pt-24">
                    <div className="min-w-0 text-[10px] leading-[1.4]">
                      <div className="mb-2 flex items-center gap-2 font-extrabold">
                        <span className="h-7 w-7 rounded-full border border-white bg-[#FDE3EF]" />
                        coalashakes
                      </div>
                      {caption && <p className="line-clamp-3 whitespace-pre-wrap">{caption}</p>}
                      {item.location && <p className="mt-1 font-semibold">⌖ {item.location.name}</p>}
                    </div>
                    <div className="flex flex-col items-center gap-4">
                      <Heart className="h-5 w-5" aria-hidden="true" />
                      <MessageCircle className="h-5 w-5" aria-hidden="true" />
                      <Send className="h-5 w-5" aria-hidden="true" />
                      <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="overflow-hidden rounded-[27px] bg-white">
                  <div className="flex items-center gap-2 px-3 py-3 text-[11px]">
                    <span className="h-7 w-7 rounded-full bg-[#FDE3EF]" />
                    <span className="min-w-0 flex-1">
                      <strong className="block leading-tight">coalashakes</strong>
                      {item.location && <span className="block truncate text-[9px] font-medium">{item.location.name}</span>}
                    </span>
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="relative" style={{ aspectRatio: mediaPreviewRatio(item.format, activeMedia, orderedMedia[0]) }}>
                    <ProtectedMedia
                      url={activeMedia?.previewUrl ?? null}
                      kind={activeMedia?.kind ?? "image"}
                      alt={`Prévia de ${instagramPostTitle(item)}`}
                      className={`h-full w-full ${mixedCarousel ? "object-cover" : "object-contain"}`}
                      onDimensions={(value) => recordDimensions(activeMedia?.previewUrl ?? null, value)}
                      previewVideo
                      eager
                    />
                    {item.format === "carousel" && item.media.length > 1 && (
                      <>
                        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[9px] font-bold text-white">
                          <Images className="h-3 w-3" aria-hidden="true" /> {activeMediaIndex + 1}/{item.media.length}
                        </span>
                        <button type="button" onClick={showPreviousMedia} aria-label="Mídia anterior" className="absolute left-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white">
                          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button type="button" onClick={showNextMedia} aria-label="Próxima mídia" className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white">
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 px-3 pb-1.5 pt-2.5 text-[#181818]">
                    <Heart className="h-5 w-5" aria-hidden="true" />
                    <MessageCircle className="h-5 w-5" aria-hidden="true" />
                    <Send className="h-5 w-5" aria-hidden="true" />
                    {item.format === "carousel" && item.media.length > 1 && (
                      <div className="ml-auto flex gap-1" aria-label={`Mídia ${activeMediaIndex + 1} de ${item.media.length}`}>
                        {item.media.map((media, index) => (
                          <button
                            key={`${media.fileName}-dot`}
                            type="button"
                            onClick={() => setActiveMediaIndex(index)}
                            aria-label={`Mostrar mídia ${index + 1}`}
                            className={`h-1.5 w-1.5 rounded-full ${index === activeMediaIndex ? "bg-[#0095F6]" : "bg-[#D9D9D9]"}`}
                          />
                        ))}
                      </div>
                    )}
                    <Bookmark className={`${item.format === "carousel" && item.media.length > 1 ? "ml-0" : "ml-auto"} h-5 w-5`} aria-hidden="true" />
                  </div>
                  <div className="max-h-36 overflow-auto whitespace-pre-wrap px-3 pb-3 pt-1 text-[11px] leading-[1.45]">
                    <strong>coalashakes</strong>{caption ? ` ${caption}` : " Sem legenda."}
                  </div>
                </div>
              )}
            </div>
            <div className="text-center text-[12px] text-ds-ink-muted">{longDate(date)} · <span className="font-ds-mono">{time}</span></div>
            <p className="text-center text-[10px] text-ds-ink-muted">Prévia aproximada. A proporção não verifica todos os requisitos de publicação.</p>
          </div>
        </aside>
      </div>

      <footer className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-ds-border bg-white px-4 py-3 md:px-7">
        {confirmingCancel ? (
          <InlineConfirm
            className="flex-1"
            message="Cancelar este agendamento? A publicação não será feita."
            confirmLabel="Confirmar cancelamento"
            cancelLabel="Manter"
            loadingLabel="Cancelando…"
            loading={saving}
            onCancel={() => setConfirmingCancel(false)}
            onConfirm={() => void cancelSchedule()}
          />
        ) : (
          <>
            <div className="text-[12px] text-ds-ink-muted">
              {editable ? "Confira a prévia, a legenda, a ordem e o horário antes de salvar." : instagramStatusLabels[item.status]}
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              {editable && (
                <Button type="button" variant="danger-link" size="md" disabled={saving} onClick={() => setConfirmingCancel(true)}>Cancelar agendamento</Button>
              )}
              <Button type="button" variant="ds-secondary" size="md" disabled={saving} onClick={onClose}>Fechar</Button>
              {editable && (
                <Button type="button" variant="primary-modal" size="md" loading={saving} loadingLabel="Salvando…" disabled={!changed || !scheduledAt} onClick={() => void save()} className="min-w-[150px]">
                  Salvar alterações
                </Button>
              )}
            </div>
          </>
        )}
      </footer>
    </section>
  );
}
