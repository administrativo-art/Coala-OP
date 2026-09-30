"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  AtSign,
  Bookmark,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Heart,
  ImageOff,
  Images,
  Loader2,
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
import { ProtectedMedia } from "./protected-media";
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
    changes: { scheduledAt?: string; mediaOrder?: number[] },
  ) => Promise<boolean>;
};

function bytesLabel(value: number) {
  if (value < 1_024 * 1_024) return `${Math.max(1, Math.round(value / 1_024))} KB`;
  return `${(value / (1_024 * 1_024)).toFixed(1).replace(".", ",")} MB`;
}

export function SchedulePostEditor({ item, onClose, onUpdate }: SchedulePostEditorProps) {
  const editable = isScheduleEditable(item);
  const theme = formatTheme[item.format];
  const originalDate = dateKeyInBelem(item.scheduledAt);
  const originalTime = timeInBelem(item.scheduledAt);
  const [minimumSchedule, setMinimumSchedule] = useState(() => minimumScheduleDateTimeInBelem());
  const [date, setDate] = useState(originalDate);
  const [time, setTime] = useState(originalTime);
  const [mediaOrder, setMediaOrder] = useState(() => item.media.map((_, index) => index));
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const scheduledAt = useMemo(() => scheduleAtInBelem(date, time), [date, time]);
  const scheduleChanged = date !== originalDate || time !== originalTime;
  const orderChanged = mediaOrder.some((originalIndex, index) => originalIndex !== index);
  const changed = scheduleChanged || orderChanged;
  const orderedMedia = useMemo(
    () => mediaOrder.map((originalIndex) => item.media[originalIndex]).filter((media) => media !== undefined),
    [item.media, mediaOrder],
  );
  const activeMedia = orderedMedia[activeMediaIndex] ?? orderedMedia[0] ?? null;

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
        ...(scheduleChanged ? { scheduledAt } : {}),
        ...(orderChanged ? { mediaOrder } : {}),
      });
      if (saved) onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="instagram-editor-title">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#EADFD3] bg-white px-4 py-3.5 md:px-7">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-bold text-[#7A5646] hover:bg-[#F4ECE2] hover:text-[#4A1A04]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar
        </button>
        <div className="min-w-0">
          <h1 id="instagram-editor-title" className="truncate text-[20px] font-extrabold tracking-tight text-[#4A1A04]">
            {instagramPostTitle(item)}
          </h1>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[11px] font-extrabold"
          style={{ background: theme.background, color: theme.ink }}
        >
          {instagramStatusLabels[item.status]}
        </span>
        {item.permalink && (
          <a
            href={item.permalink}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-[#EADFD3] bg-white px-3 py-2 text-[12px] font-bold hover:border-[#F462A7]"
          >
            Ver no Instagram <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </header>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6 overflow-auto px-4 py-5 md:px-7 md:py-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[#EADFD3] bg-white p-4">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#7A5646]">Formato</div>
              <div className="mt-2 flex items-center gap-2 text-[16px] font-extrabold">
                <span className="h-3 w-3 rounded-full" style={{ background: theme.dot }} />
                {theme.label}
              </div>
            </div>
            <div className="rounded-xl border border-[#EADFD3] bg-white p-4">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#7A5646]">Publicação</div>
              <div className="mt-2 text-[15px] font-extrabold">{longDate(originalDate)} · {originalTime}</div>
            </div>
            <div className="rounded-xl border border-[#EADFD3] bg-white p-4">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#7A5646]">Destino</div>
              <div className="mt-2 text-[15px] font-extrabold">Instagram{item.shareToFeed && item.format === "reel" ? " + grade" : ""}</div>
            </div>
          </div>

          <section aria-labelledby="editor-media-title">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 id="editor-media-title" className="text-[14px] font-extrabold text-[#4A1A04]">Mídia</h2>
              <span className="text-[12px] text-[#7A5646]">{item.media.length} {item.media.length === 1 ? "arquivo" : "arquivos"}</span>
            </div>
            {item.format === "story" && item.media.length > 1 && (
              <p className="mb-3 rounded-lg bg-[#FDEAF3] px-3 py-2 text-[12px] font-semibold leading-5 text-[#7D184A]">
                A Meta publicará os quadros na ordem abaixo, do 1 ao {item.media.length}.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {orderedMedia.map((media, index) => (
                <div
                  key={`${media.fileName}-${mediaOrder[index]}`}
                  className="overflow-hidden rounded-xl border bg-white"
                  style={{ borderColor: activeMediaIndex === index ? "#D90F6F" : "#EADFD3" }}
                >
                  <button
                    type="button"
                    aria-pressed={activeMediaIndex === index}
                    onClick={() => setActiveMediaIndex(index)}
                    className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-[#D90F6F]"
                  >
                    <div className={`relative ${item.format === "story" || item.format === "reel" ? "aspect-[9/16]" : "aspect-[4/5]"}`}>
                      {media.previewUrl || media.kind === "video" ? (
                        <ProtectedMedia
                          url={media.previewUrl}
                          kind={media.kind}
                          alt={`Mídia ${index + 1} de ${instagramPostTitle(item)}`}
                          eager={index === 0}
                        />
                      ) : (
                        <div className="grid h-full place-items-center bg-[#F3E8DC] text-[#7A5646]"><ImageOff className="h-6 w-6" /></div>
                      )}
                      {orderedMedia.length > 1 && (
                        <span className="absolute left-2 top-2 rounded-full bg-[#4A1A04]/90 px-2 py-0.5 text-[10px] font-extrabold text-white">{index + 1}</span>
                      )}
                    </div>
                    <div className="p-2.5">
                      <div className="truncate text-[11px] font-bold" title={media.fileName}>{media.fileName}</div>
                      <div className="mt-0.5 text-[10px] text-[#7A5646]">{bytesLabel(media.sizeBytes)}</div>
                    </div>
                  </button>
                  {editable && item.format === "story" && orderedMedia.length > 1 && (
                    <div className="grid grid-cols-2 border-t border-[#EADFD3]">
                      <button
                        type="button"
                        onClick={() => moveMedia(index, -1)}
                        disabled={index === 0 || saving}
                        aria-label={`Mover ${media.fileName} para antes`}
                        className="flex items-center justify-center gap-1 border-r border-[#EADFD3] px-2 py-2 text-[10px] font-extrabold text-[#7A5646] disabled:opacity-30"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Antes
                      </button>
                      <button
                        type="button"
                        onClick={() => moveMedia(index, 1)}
                        disabled={index === orderedMedia.length - 1 || saving}
                        aria-label={`Mover ${media.fileName} para depois`}
                        className="flex items-center justify-center gap-1 px-2 py-2 text-[10px] font-extrabold text-[#7A5646] disabled:opacity-30"
                      >
                        Depois <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="editor-caption-title">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 id="editor-caption-title" className="text-[14px] font-extrabold text-[#4A1A04]">Legenda</h2>
              <span className="text-[12px] text-[#7A5646]">{item.caption.length} / 2.200</span>
            </div>
            <div className="whitespace-pre-wrap rounded-xl border border-[#EADFD3] bg-white p-4 text-[14px] leading-6 text-[#4A1A04]">
              {item.caption || <span className="text-[#7A5646]">Sem legenda.</span>}
            </div>
            {item.format === "story" && item.caption && (
              <p className="mt-2 rounded-lg bg-[#FCF1DD] px-3 py-2 text-[12px] font-semibold leading-5 text-[#8A5A18]">
                Stories são publicados sem essa legenda. Inclua o texto diretamente na arte se ele precisar aparecer.
              </p>
            )}
          </section>

          {item.location && (
            <section className="flex items-start gap-3 rounded-xl border border-[#EADFD3] bg-white p-4">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#217A8F]" aria-hidden="true" />
              <div>
                <h2 className="text-[13px] font-extrabold">Localização marcada</h2>
                <p className="mt-0.5 text-[13px] text-[#7A5646]">{item.location.name}</p>
              </div>
            </section>
          )}

          {item.storyMentions.length > 0 && (
            <section className="flex items-start gap-3 rounded-xl border border-[#EADFD3] bg-white p-4">
              <AtSign className="mt-0.5 h-5 w-5 shrink-0 text-[#D90F6F]" aria-hidden="true" />
              <div>
                <h2 className="text-[13px] font-extrabold">Menção no Story</h2>
                <p className="mt-0.5 text-[13px] text-[#7A5646]">
                  {item.storyMentions.map((username) => `@${username}`).join(", ")} · sem adesivo visível
                </p>
              </div>
            </section>
          )}

          <section className="rounded-xl border border-[#EADFD3] bg-white p-4" aria-labelledby="editor-schedule-title">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-[#D90F6F]" aria-hidden="true" />
              <h2 id="editor-schedule-title" className="text-[14px] font-extrabold">Quando publicar</h2>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <div className="flex min-w-[180px] flex-1 flex-col gap-1.5 text-[12px] font-bold text-[#7A5646]">
                Data
                <ScheduleDatePicker
                  value={date}
                  minimum={minimumSchedule.date}
                  disabled={!editable || saving}
                  onChange={(value) => {
                    setDate(value);
                    setLocalError(null);
                  }}
                />
              </div>
              <label className="flex min-w-[150px] flex-1 flex-col gap-1.5 text-[12px] font-bold text-[#7A5646]">
                Horário · HH:MM
                <ScheduleTimeInput
                  value={time}
                  minimum={date === minimumSchedule.date ? minimumSchedule.time : undefined}
                  disabled={!editable || saving}
                  onChange={(value) => {
                    setTime(value);
                    setLocalError(null);
                  }}
                />
              </label>
            </div>
            <p className="mt-3 text-[12px] leading-5 text-[#7A5646]">
              {editable
                ? "Horário de São Luís. Escolha pelo menos dois minutos no futuro."
                : "Esta publicação está disponível somente para consulta."}
            </p>
            {localError && <p role="alert" className="mt-2 text-[12px] font-bold text-[#C0392B]">{localError}</p>}
          </section>
        </div>

        <aside className="border-t border-[#EADFD3] bg-[#F4ECE2] px-5 py-7 xl:border-l xl:border-t-0">
          <div className="sticky top-7 mx-auto flex max-w-[310px] flex-col items-center gap-3">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#7A5646]">Prévia · {theme.label}</div>
            <div className="w-full rounded-[34px] bg-[#283137] p-2.5 shadow-[0_20px_40px_rgba(74,26,4,.18)]">
              {item.format === "story" ? (
                <div className="relative aspect-[9/16] overflow-hidden rounded-[27px] bg-[#181818] text-white">
                  <ProtectedMedia
                    url={activeMedia?.previewUrl ?? null}
                    kind={activeMedia?.kind ?? "image"}
                    alt={`Prévia do Story de ${instagramPostTitle(item)}`}
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
                      {item.caption && <p className="line-clamp-3 whitespace-pre-wrap">{item.caption}</p>}
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
                  <div className="relative aspect-[4/5]">
                    <ProtectedMedia
                      url={activeMedia?.previewUrl ?? null}
                      kind={activeMedia?.kind ?? "image"}
                      alt={`Prévia de ${instagramPostTitle(item)}`}
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
                    <strong>coalashakes</strong>{item.caption ? ` ${item.caption}` : " Sem legenda."}
                  </div>
                </div>
              )}
            </div>
            <div className="text-center text-[12px] text-[#7A5646]">{longDate(date)} · {time}</div>
          </div>
        </aside>
      </div>

      <footer className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-[#EADFD3] bg-white px-4 py-3 md:px-7">
        <div className="text-[12px] text-[#7A5646]">
          {editable ? "Confira a prévia, a ordem e o horário antes de salvar." : instagramStatusLabels[item.status]}
        </div>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-[#EADFD3] bg-white px-4 py-2.5 text-[13px] font-bold disabled:opacity-50"
          >
            Fechar
          </button>
          {editable && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !changed || !scheduledAt}
              className="flex min-w-[150px] items-center justify-center gap-2 rounded-lg bg-[#F462A7] px-4 py-2.5 text-[13px] font-extrabold text-[#4A1A04] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Salvar alterações
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
