"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  AtSign,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  Images,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Play,
  Plus,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import type { InstagramPublicationFormat } from "./contracts";
import {
  instagramFormatLabels,
  type InstagramPublishedFeedItem,
  type InstagramScheduleListItem,
} from "./contracts";
import { ProtectedMedia } from "./protected-media";
import { MediaFormatInfo } from "./media-format-info";
import { carouselHasDifferentRatios, mediaPreviewRatio, type MediaDimensions } from "./media-presentation";
import { useDraftMediaDimensions } from "./use-draft-media-dimensions";
import { ScheduleDatePicker, ScheduleTimeInput } from "./schedule-date-time-fields";
import {
  addDaysToKey,
  dateKeyInBelem,
  minimumScheduleDateTimeInBelem,
  parseDateKey,
  scheduleAtInBelem,
  timeInBelem,
} from "./workspace-utils";

const SHOPPING_AUTOMOVEL = {
  id: "755878304532279",
  name: "Shopping do Automóvel · São Luís – MA",
};

const formats: Array<{ value: InstagramPublicationFormat; label: string; description: string }> = [
  { value: "feed_image", label: "Feed", description: "Uma imagem" },
  { value: "carousel", label: "Carrossel", description: "De 2 a 10 fotos ou vídeos" },
  { value: "reel", label: "Reel", description: "Um vídeo" },
  { value: "story", label: "Stories", description: "De 1 a 10 arquivos em sequência" },
];

export type CreateInstagramScheduleInput = {
  format: InstagramPublicationFormat;
  scheduledAt: string;
  caption: string;
  files: File[];
  shareToFeed: boolean;
  storyMentions: string[];
  location: typeof SHOPPING_AUTOMOVEL | null;
};

type CreateScheduleDialogProps = {
  initialDate: string;
  busy: boolean;
  schedules: InstagramScheduleListItem[];
  publishedItems: InstagramPublishedFeedItem[];
  publishedLoading: boolean;
  publishedError: string | null;
  onClose: () => void;
  onCreate: (input: CreateInstagramScheduleInput) => Promise<boolean>;
};

type PreviewFeedEntry =
  | { key: string; source: "draft"; date: string; format: InstagramPublicationFormat; previewUrl: string | null; kind: "image" | "video" }
  | { key: string; source: "schedule"; date: string; format: InstagramPublicationFormat; item: InstagramScheduleListItem }
  | { key: string; source: "instagram"; date: string; format: InstagramPublishedFeedItem["format"]; item: InstagramPublishedFeedItem };

const previewDate = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

function PlanningContextPreview({
  date,
  time,
  format,
  shareToFeed,
  draftPreviewUrl,
  draftKind,
  schedules,
  publishedItems,
  publishedLoading,
  publishedError,
}: {
  date: string;
  time: string;
  format: InstagramPublicationFormat;
  shareToFeed: boolean;
  draftPreviewUrl: string | null;
  draftKind: "image" | "video";
  schedules: InstagramScheduleListItem[];
  publishedItems: InstagramPublishedFeedItem[];
  publishedLoading: boolean;
  publishedError: string | null;
}) {
  const days = useMemo(
    () => Array.from({ length: 5 }, (_, index) => addDaysToKey(date, index - 2)),
    [date],
  );
  const draftDate = scheduleAtInBelem(date, time) || `${date}T${time || "10:00"}:00-03:00`;
  const appearsInFeed = format !== "story" && (format !== "reel" || shareToFeed);
  const feedEntries = useMemo(() => {
    if (!appearsInFeed) return [];
    const publishedPermalinks = new Set(publishedItems.map((item) => item.permalink));
    const existing: PreviewFeedEntry[] = schedules
      .filter((item) => item.status !== "cancelled" && item.status !== "uploading")
      .filter((item) => item.format !== "story" && (item.format !== "reel" || item.shareToFeed))
      .filter((item) => !item.permalink || !publishedPermalinks.has(item.permalink))
      .map((item) => ({ key: `schedule:${item.id}`, source: "schedule", date: item.publishedAt ?? item.scheduledAt, format: item.format, item }));
    const live: PreviewFeedEntry[] = publishedItems.map((item) => ({
      key: `instagram:${item.id}`,
      source: "instagram",
      date: item.publishedAt,
      format: item.format,
      item,
    }));
    const draft: PreviewFeedEntry = {
      key: "draft",
      source: "draft",
      date: draftDate,
      format,
      previewUrl: draftPreviewUrl,
      kind: draftKind,
    };
    const ordered = [draft, ...existing, ...live].sort((left, right) => right.date.localeCompare(left.date));
    const draftIndex = ordered.findIndex((entry) => entry.source === "draft");
    const start = Math.max(0, Math.min(draftIndex - 4, Math.max(0, ordered.length - 12)));
    return ordered.slice(start, start + 12);
  }, [appearsInFeed, draftDate, draftKind, draftPreviewUrl, format, publishedItems, schedules]);

  return (
    <section className="rounded-2xl border border-[#EADFD3] bg-white p-4" aria-labelledby="planning-context-title">
      <div className="mb-3">
        <h2 id="planning-context-title" className="text-[15px] font-extrabold text-[#4A1A04]">Prévia do planejamento</h2>
        <p className="text-[11px] leading-4 text-[#7A5646]">Confira os dois dias anteriores e posteriores antes de agendar.</p>
      </div>
      <div className={`grid gap-4 ${appearsInFeed ? "xl:grid-cols-[minmax(0,1fr)_300px]" : "grid-cols-1"}`}>
        <div className="min-w-0 overflow-x-auto">
          <div className="grid min-w-[610px] grid-cols-5 gap-2">
            {days.map((day) => {
              const dayItems = schedules
                .filter((item) => item.status !== "cancelled" && dateKeyInBelem(item.scheduledAt) === day)
                .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
              const parsed = parseDateKey(day);
              return (
                <div key={day} className={`min-h-36 rounded-xl border p-2 ${day === date ? "border-[#D90F6F] bg-[#FFF1F7]" : "border-[#EADFD3] bg-[#FAF5EF]"}`}>
                  <div className="mb-2 text-[10px] font-extrabold uppercase tracking-wide text-[#7A5646]">
                    {parsed ? previewDate.format(parsed) : day}
                  </div>
                  <div className="space-y-1.5">
                    {dayItems.map((item) => (
                      <div key={item.id} className="overflow-hidden rounded-lg border border-[#EADFD3] bg-white">
                        <div className="h-12 bg-[#F3E8DC]">
                          <ProtectedMedia url={item.media[0]?.previewUrl ?? null} kind={item.media[0]?.kind ?? "image"} alt="" />
                        </div>
                        <div className="px-1.5 py-1 text-[9px] font-bold leading-3 text-[#4A1A04]">
                          {timeInBelem(item.scheduledAt)} · {item.format === "story" && item.media.length > 1 ? `${item.media.length} Stories` : instagramFormatLabels[item.format]}
                        </div>
                      </div>
                    ))}
                    {day === date && (
                      <div className="rounded-lg border border-dashed border-[#D90F6F] bg-white px-1.5 py-2 text-center text-[9px] font-extrabold leading-3 text-[#D90F6F]">
                        {time || "10:00"} · Nova {instagramFormatLabels[format]}
                      </div>
                    )}
                    {dayItems.length === 0 && day !== date && <div className="py-7 text-center text-[10px] font-semibold text-[#9B7C6D]">Sem publicação</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {appearsInFeed && <div className="rounded-xl bg-[#FAF5EF] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-[13px] font-extrabold text-[#4A1A04]">Sequência prevista no feed</h3>
              <p className="text-[9px] text-[#7A5646]">Mais recentes primeiro</p>
            </div>
            {publishedLoading && <span className="text-[9px] font-bold text-[#217A8F]">Atualizando…</span>}
          </div>
          <>
              <div className="grid grid-cols-3 gap-[2px] overflow-hidden rounded-lg bg-white">
                {feedEntries.map((entry) => (
                  <div key={entry.key} className={`relative aspect-square overflow-hidden bg-[#EADFD3] ${entry.source === "draft" ? "ring-2 ring-inset ring-[#D90F6F]" : ""}`}>
                    {entry.source === "instagram" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={entry.item.previewUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    ) : entry.source === "schedule" ? (
                      <ProtectedMedia url={entry.item.media[0]?.previewUrl ?? null} kind={entry.item.media[0]?.kind ?? "image"} alt="" />
                    ) : entry.previewUrl ? (
                      entry.kind === "video"
                        ? <video src={entry.previewUrl} muted playsInline className="h-full w-full object-cover" />
                        // eslint-disable-next-line @next/next/no-img-element
                        : <img src={entry.previewUrl} alt="Nova publicação" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center bg-[#FDE3EF] text-[#D90F6F]"><Plus className="h-5 w-5" /></div>
                    )}
                    {entry.source === "draft" && <span className="absolute left-1 top-1 rounded bg-[#D90F6F] px-1 py-0.5 text-[7px] font-extrabold uppercase text-white">Nova</span>}
                    {entry.source === "schedule" && <span className="absolute left-1 top-1 rounded bg-[#4A1A04]/85 px-1 py-0.5 text-[7px] font-extrabold uppercase text-white">Programada</span>}
                    {entry.format === "carousel" && <Images className="absolute right-1 top-1 h-3.5 w-3.5 text-white drop-shadow" />}
                    {entry.format === "reel" && <Play className="absolute right-1 top-1 h-3.5 w-3.5 fill-white text-white drop-shadow" />}
                  </div>
                ))}
              </div>
              {publishedError && <p className="mt-2 text-[9px] font-semibold text-[#A52E24]">O feed real não carregou; a programação local continua na prévia.</p>}
              <p className="mt-2 text-[9px] leading-3.5 text-[#7A5646]">A posição considera data e horário. Fixações do Instagram podem mudar a ordem visual do perfil.</p>
          </>
        </div>}
      </div>
    </section>
  );
}

function DraftStorySequencePreview({ files, urls }: { files: File[]; urls: string[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, files.length - 1)));
  }, [files.length]);

  function show(index: number) {
    const next = Math.max(0, Math.min(files.length - 1, index));
    setActiveIndex(next);
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTo({ left: viewport.clientWidth * next, behavior: "smooth" });
  }

  return (
    <div className="h-fit rounded-2xl border border-[#EADFD3] bg-[#F4ECE2] p-3" aria-label="Prévia da sequência de Stories">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-extrabold text-[#4A1A04]">Prévia da sequência</h3>
          <p className="text-[10px] text-[#7A5646]">Arraste a arte para o lado ou use as setas.</p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-[#7D184A]">{activeIndex + 1} de {files.length}</span>
      </div>
      <div className="relative mx-auto w-full max-w-[310px] rounded-[34px] bg-[#283137] p-2.5 shadow-[0_18px_35px_rgba(74,26,4,.16)]">
        <div className="relative aspect-[9/16] overflow-hidden rounded-[27px] bg-[#181818] text-white">
          <div
            ref={viewportRef}
            onScroll={(event) => {
              const viewport = event.currentTarget;
              if (viewport.clientWidth > 0) setActiveIndex(Math.round(viewport.scrollLeft / viewport.clientWidth));
            }}
            className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {files.map((file, index) => (
              <div key={`${file.name}-${file.lastModified}-${index}`} className="relative h-full min-w-full snap-center">
                {file.type.startsWith("video/") ? (
                  <video src={urls[index]} muted playsInline controls className="h-full w-full object-contain" aria-label={`Story ${index + 1} de ${files.length}`} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[index]} alt={`Story ${index + 1} de ${files.length}`} className="h-full w-full object-contain" />
                )}
              </div>
            ))}
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-3 pb-14 pt-3">
            <div className="flex gap-1">
              {files.map((file, index) => (
                <span key={`${file.name}-progress-${index}`} className="h-0.5 flex-1 overflow-hidden rounded bg-white/35">
                  <span className={`block h-full rounded bg-white ${index <= activeIndex ? "w-full" : "w-0"}`} />
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

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/65 to-transparent px-3 pb-4 pt-16">
            <span className="flex-1 rounded-full border border-white/80 px-3 py-2 text-[10px] font-semibold">Enviar mensagem</span>
            <Heart className="h-5 w-5" aria-hidden="true" />
            <Send className="h-5 w-5" aria-hidden="true" />
          </div>

          <button type="button" onClick={() => show(activeIndex - 1)} disabled={activeIndex === 0} aria-label="Story anterior" className="absolute inset-y-20 left-0 w-1/3 disabled:cursor-default">
            {activeIndex > 0 && <span className="absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/35"><ChevronLeft className="h-5 w-5" /></span>}
          </button>
          <button type="button" onClick={() => show(activeIndex + 1)} disabled={activeIndex === files.length - 1} aria-label="Próximo Story" className="absolute inset-y-20 right-0 w-1/3 disabled:cursor-default">
            {activeIndex < files.length - 1 && <span className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/35"><ChevronRight className="h-5 w-5" /></span>}
          </button>
        </div>
      </div>
      <div className="mt-3 flex justify-center gap-1.5" aria-label={`Story ${activeIndex + 1} de ${files.length}`}>
        {files.map((file, index) => (
          <button key={`${file.name}-dot-${index}`} type="button" onClick={() => show(index)} aria-label={`Mostrar Story ${index + 1}`} aria-current={index === activeIndex ? "true" : undefined} className={`h-2 rounded-full transition-all ${index === activeIndex ? "w-6 bg-[#D90F6F]" : "w-2 bg-[#D9C8B6]"}`} />
        ))}
      </div>
    </div>
  );
}

function DraftFeedPreview({
  format,
  files,
  urls,
  caption,
  locationEnabled,
  dimensions,
}: {
  format: Exclude<InstagramPublicationFormat, "story">;
  files: File[];
  urls: string[];
  caption: string;
  locationEnabled: boolean;
  dimensions: MediaDimensions[];
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const vertical = format === "reel";
  const mixedCarousel = format === "carousel" && carouselHasDifferentRatios(dimensions);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, files.length - 1)));
  }, [files.length]);

  function show(index: number) {
    const next = Math.max(0, Math.min(files.length - 1, index));
    setActiveIndex(next);
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTo({ left: viewport.clientWidth * next, behavior: "smooth" });
  }

  return (
    <div className="h-fit rounded-2xl border border-[#EADFD3] bg-[#F4ECE2] p-3" aria-label={`Prévia de ${instagramFormatLabels[format]}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-extrabold text-[#4A1A04]">Prévia · {instagramFormatLabels[format]}</h3>
          <p className="text-[10px] text-[#7A5646]">Visualização aproximada no Instagram.</p>
        </div>
        {files.length > 1 && <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-[#7D184A]">{activeIndex + 1} de {files.length}</span>}
      </div>

      <div className={`relative mx-auto w-full max-w-[310px] overflow-hidden ${vertical ? "rounded-[34px] border-[10px] border-[#283137] bg-[#181818] text-white" : "rounded-2xl border border-[#EADFD3] bg-white text-[#4A1A04]"}`}>
        {!vertical && (
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="h-8 w-8 rounded-full bg-[#FDE3EF]" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-extrabold">coalashakes</div>
              {locationEnabled && <div className="truncate text-[9px] text-[#7A5646]">Shopping do Automóvel · São Luís – MA</div>}
            </div>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </div>
        )}

        <div className="relative">
          <div
            ref={viewportRef}
            className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth bg-black [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ aspectRatio: mediaPreviewRatio(format, dimensions[activeIndex], dimensions[0]) }}
            onScroll={(event) => {
              const viewport = event.currentTarget;
              if (viewport.clientWidth > 0) setActiveIndex(Math.round(viewport.scrollLeft / viewport.clientWidth));
            }}
          >
            {files.map((file, index) => (
              <div key={`${file.name}-preview-${index}`} className="relative h-full min-w-full snap-center">
                {urls[index] ? (
                  file.type.startsWith("video/") ? (
                    <video src={urls[index]} muted playsInline controls className={`h-full w-full ${mixedCarousel ? "object-cover" : "object-contain"}`} aria-label={`${instagramFormatLabels[format]} ${index + 1} de ${files.length}`} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={urls[index]} alt={`${instagramFormatLabels[format]} ${index + 1} de ${files.length}`} className={`h-full w-full ${mixedCarousel ? "object-cover" : "object-contain"}`} />
                  )
                ) : <div className="h-full w-full bg-[#F3E8DC]" />}
              </div>
            ))}
          </div>

          {files.length > 1 && (
            <>
              <button type="button" onClick={() => show(activeIndex - 1)} disabled={activeIndex === 0} aria-label="Mídia anterior" className="absolute inset-y-0 left-0 w-1/3 disabled:cursor-default">
                {activeIndex > 0 && <span className="absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white"><ChevronLeft className="h-5 w-5" /></span>}
              </button>
              <button type="button" onClick={() => show(activeIndex + 1)} disabled={activeIndex === files.length - 1} aria-label="Próxima mídia" className="absolute inset-y-0 right-0 w-1/3 disabled:cursor-default">
                {activeIndex < files.length - 1 && <span className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white"><ChevronRight className="h-5 w-5" /></span>}
              </button>
            </>
          )}

          {vertical && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pb-4 pt-20">
              <div className="text-[11px] font-extrabold">@coalashakes</div>
            </div>
          )}
        </div>

        {!vertical && (
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-3">
              <Heart className="h-5 w-5" aria-hidden="true" />
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
              <Send className="h-5 w-5" aria-hidden="true" />
              <Bookmark className="ml-auto h-5 w-5" aria-hidden="true" />
            </div>
            {files.length > 1 && (
              <div className="mt-2 flex justify-center gap-1" aria-label={`Mídia ${activeIndex + 1} de ${files.length}`}>
                {files.map((file, index) => <button key={`${file.name}-feed-dot-${index}`} type="button" onClick={() => show(index)} aria-label={`Mostrar mídia ${index + 1}`} className={`h-1.5 rounded-full ${index === activeIndex ? "w-4 bg-[#D90F6F]" : "w-1.5 bg-[#D9C8B6]"}`} />)}
              </div>
            )}
            {caption && <p className="mt-2 whitespace-pre-wrap break-words text-[10px] leading-4"><strong>coalashakes</strong> {caption}</p>}
          </div>
        )}
      </div>
      {vertical && caption && (
        <div className="mx-auto mt-3 w-full max-w-[310px] rounded-xl bg-white px-3 py-2.5 text-[10px] leading-4 text-[#4A1A04]">
          <p className="whitespace-pre-wrap break-words"><strong>coalashakes</strong> {caption}</p>
        </div>
      )}
    </div>
  );
}

function mentionsFromText(value: string) {
  return Array.from(new Set(
    value
      .split(/[\s,;]+/)
      .map((part) => part.trim().replace(/^@/, ""))
      .filter(Boolean),
  ));
}

export function CreateScheduleDialog({
  initialDate,
  busy,
  schedules,
  publishedItems,
  publishedLoading,
  publishedError,
  onClose,
  onCreate,
}: CreateScheduleDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [minimumSchedule, setMinimumSchedule] = useState(() => minimumScheduleDateTimeInBelem());
  const safeInitialDate = initialDate < minimumSchedule.date ? minimumSchedule.date : initialDate;
  const [format, setFormat] = useState<InstagramPublicationFormat>("feed_image");
  const [date, setDate] = useState(safeInitialDate);
  const [time, setTime] = useState(() => safeInitialDate === minimumSchedule.date && "10:00" < minimumSchedule.time
    ? minimumSchedule.time
    : "10:00");
  const [caption, setCaption] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [shareToFeed, setShareToFeed] = useState(true);
  const [mentions, setMentions] = useState("");
  const [mentionFocused, setMentionFocused] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [draftMediaUrls, setDraftMediaUrls] = useState<string[]>([]);
  const draftDimensions = useDraftMediaDimensions(files, draftMediaUrls);

  const accept = format === "reel"
    ? "video/mp4,video/quicktime"
    : format === "story" || format === "carousel"
      ? "image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
      : "image/jpeg,image/png,image/webp";
  const multiple = format === "carousel" || format === "story";
  const storyMentions = useMemo(() => mentionsFromText(mentions), [mentions]);
  const knownMentions = useMemo(
    () => Array.from(new Set(schedules.flatMap((item) => item.storyMentions))).sort((left, right) => left.localeCompare(right)),
    [schedules],
  );
  const mentionFragment = useMemo(
    () => (mentions.split(/[\s,;]+/).at(-1) ?? "").replace(/^@/, "").toLocaleLowerCase("pt-BR"),
    [mentions],
  );
  const mentionSuggestions = useMemo(
    () => knownMentions
      .filter((username) => !mentionFragment || username.toLocaleLowerCase("pt-BR").includes(mentionFragment))
      .filter((username) => !storyMentions.includes(username) || username.toLocaleLowerCase("pt-BR") === mentionFragment)
      .slice(0, 6),
    [knownMentions, mentionFragment, storyMentions],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  useEffect(() => {
    const updateMinimum = () => setMinimumSchedule(minimumScheduleDateTimeInBelem());
    const interval = window.setInterval(updateMinimum, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (date < minimumSchedule.date) {
      setDate(minimumSchedule.date);
      setTime(minimumSchedule.time);
      return;
    }
    if (date === minimumSchedule.date && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) && time < minimumSchedule.time) {
      setTime(minimumSchedule.time);
    }
  }, [date, minimumSchedule, time]);

  useEffect(() => {
    const objectUrls = files.map((file) => URL.createObjectURL(file));
    setDraftMediaUrls(objectUrls.map((url) => encodeURI(url)));
    return () => objectUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  function changeFormat(next: InstagramPublicationFormat) {
    setFormat(next);
    setFiles([]);
    setLocalError(null);
  }

  function addFiles(selection: FileList | null) {
    if (!selection?.length) return;
    const selected = Array.from(selection);
    setFiles((current) => multiple ? [...current, ...selected].slice(0, 10) : selected.slice(0, 1));
    setLocalError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function moveFile(index: number, direction: -1 | 1) {
    setFiles((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function selectMention(username: string) {
    const prefix = mentions.replace(/[^\s,;]*$/, "");
    setMentions(`${prefix}@${username} `);
    setMentionFocused(false);
  }

  function validate() {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return "Digite o horário no formato HH:MM.";
    }
    const scheduledAt = scheduleAtInBelem(date, time);
    if (!scheduledAt || new Date(scheduledAt).getTime() < Date.now() + 120_000) {
      return "Escolha um horário com pelo menos dois minutos de antecedência.";
    }
    if (files.length === 0) return "Selecione a mídia da publicação.";
    if (format === "feed_image" && (files.length !== 1 || !files[0]?.type.startsWith("image/"))) {
      return "O Feed exige uma imagem.";
    }
    if (format === "carousel" && files.length < 2) {
      return "O Carrossel exige de 2 a 10 fotos ou vídeos.";
    }
    if (format === "reel" && (files.length !== 1 || !files[0]?.type.startsWith("video/"))) {
      return "O Reel exige um vídeo.";
    }
    if (storyMentions.length > 20) return "Use no máximo 20 menções.";
    if (storyMentions.some((value) => !/^[A-Za-z0-9._]{1,30}$/.test(value))) {
      return "Revise os usuários mencionados.";
    }
    return null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const issue = validate();
    if (issue) {
      setLocalError(issue);
      return;
    }
    const success = await onCreate({
      format,
      scheduledAt: scheduleAtInBelem(date, time),
      caption: format === "story" ? "" : caption,
      files,
      shareToFeed,
      storyMentions: format === "story" ? storyMentions : [],
      location: locationEnabled && format !== "story" ? SHOPPING_AUTOMOVEL : null,
    });
    if (!success) setLocalError("Não foi possível criar o agendamento. Confira a mensagem acima.");
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-[#4A1A04]/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="create-instagram-title" className="flex max-h-[96vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-t-[20px] bg-[#FAF5EF] shadow-2xl sm:rounded-[20px]">
        <header className="flex items-center gap-3 border-b border-[#EADFD3] bg-white px-5 py-4">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-[#FDE3EF] text-[#D90F6F]"><Plus className="h-5 w-5" /></div>
          <div>
            <h1 id="create-instagram-title" className="text-[20px] font-extrabold text-[#4A1A04]">Planejar publicação</h1>
            <p className="text-[12px] text-[#7A5646]">Você pode criar várias publicações no mesmo dia.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Fechar" className="ml-auto grid h-9 w-9 place-items-center rounded-lg border border-[#EADFD3] bg-white disabled:opacity-50"><X className="h-4 w-4" /></button>
        </header>

        <form onSubmit={(event) => void submit(event)} className="min-h-0 overflow-y-auto p-5">
          <fieldset disabled={busy} className="space-y-6">
            <section>
              <legend className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.08em] text-[#7A5646]">Formato</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {formats.map((option) => (
                  <button key={option.value} type="button" aria-pressed={format === option.value} onClick={() => changeFormat(option.value)} className={`rounded-xl border p-3 text-left ${format === option.value ? "border-[#D90F6F] bg-[#FDE3EF]" : "border-[#EADFD3] bg-white"}`}>
                    <strong className="block text-[14px]">{option.label}</strong>
                    <span className="mt-1 block text-[10px] leading-4 text-[#7A5646]">{option.description}</span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-[14px] font-extrabold">Mídia</h2>
                <span className="text-[11px] text-[#7A5646]">{files.length} / {multiple ? 10 : 1}</span>
              </div>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#D9C8B6] bg-white px-4 py-5 text-[13px] font-extrabold text-[#D90F6F] hover:border-[#F462A7]">
                <Upload className="h-4 w-4" /> Selecionar {multiple ? "arquivos" : "arquivo"}
              </button>
              <input ref={fileInputRef} type="file" multiple={multiple} accept={accept} className="sr-only" onChange={(event) => addFiles(event.target.files)} />
              {files.length > 0 && (
                <div className="mt-3 grid items-start gap-4 lg:grid-cols-2">
                  <div className="min-w-0">
                    <div className="space-y-1.5">
                      {files.map((file, index) => (
                        <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-2 rounded-lg border border-[#EADFD3] bg-white px-3 py-2 text-[12px]">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#FDE3EF] font-extrabold text-[#D90F6F]">{index + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-bold">{file.name}</p>
                            <MediaFormatInfo format={format} media={{ ...draftDimensions[index], kind: file.type.startsWith("video/") ? "video" : "image" }} />
                          </div>
                          {multiple && <>
                            <button type="button" onClick={() => moveFile(index, -1)} disabled={index === 0} aria-label={`Mover ${file.name} para antes`} className="disabled:opacity-25"><ArrowUp className="h-4 w-4" /></button>
                            <button type="button" onClick={() => moveFile(index, 1)} disabled={index === files.length - 1} aria-label={`Mover ${file.name} para depois`} className="disabled:opacity-25"><ArrowDown className="h-4 w-4" /></button>
                          </>}
                          <button type="button" onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Remover ${file.name}`}><Trash2 className="h-4 w-4 text-[#A52E24]" /></button>
                        </div>
                      ))}
                    </div>
                    {format === "story" && files.length > 1 && <p className="mt-2 flex items-center gap-2 rounded-lg bg-[#FDEAF3] px-3 py-2 text-[11px] font-semibold text-[#7D184A]"><Images className="h-4 w-4" /> A ordem ao lado será a ordem da sequência de Stories.</p>}
                    {format === "carousel" && files.length > 1 && <p className="mt-2 flex items-center gap-2 rounded-lg bg-[#FDEAF3] px-3 py-2 text-[11px] font-semibold text-[#7D184A]"><Images className="h-4 w-4" /> A ordem ao lado será a ordem do Carrossel.</p>}
                    {format === "carousel" && carouselHasDifferentRatios(draftDimensions) && <p className="mt-2 text-[11px] text-[#8A5A18]">Proporções diferentes: a prévia usa a primeira mídia como referência e mostra o possível corte das demais.</p>}
                  </div>
                  {format === "story"
                    ? <DraftStorySequencePreview files={files} urls={draftMediaUrls} />
                    : <DraftFeedPreview format={format} files={files} urls={draftMediaUrls} caption={caption} locationEnabled={locationEnabled} dimensions={draftDimensions} />}
                </div>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <div className="text-[12px] font-bold text-[#7A5646]">Data
                <ScheduleDatePicker
                  value={date}
                  minimum={minimumSchedule.date}
                  onChange={(value) => {
                    setDate(value);
                    setLocalError(null);
                  }}
                  className="mt-1.5"
                />
              </div>
              <label className="text-[12px] font-bold text-[#7A5646]">Horário de São Luís · HH:MM
                <ScheduleTimeInput
                  value={time}
                  minimum={date === minimumSchedule.date ? minimumSchedule.time : undefined}
                  onChange={(value) => {
                    setTime(value);
                    setLocalError(null);
                  }}
                  className="mt-1.5"
                />
              </label>
            </section>

            <PlanningContextPreview
              date={date}
              time={time}
              format={format}
              shareToFeed={shareToFeed}
              draftPreviewUrl={draftMediaUrls[0] ?? null}
              draftKind={files[0]?.type.startsWith("video/") ? "video" : "image"}
              schedules={schedules}
              publishedItems={publishedItems}
              publishedLoading={publishedLoading}
              publishedError={publishedError}
            />

            {format !== "story" && (
              <label className="block text-[12px] font-bold text-[#7A5646]">Legenda
                <textarea value={caption} onChange={(event) => setCaption(event.target.value.slice(0, 2200))} rows={5} placeholder="Escreva a legenda da publicação…" className="mt-1.5 w-full resize-y rounded-xl border border-[#EADFD3] bg-white p-3 text-[14px] leading-5 text-[#4A1A04]" />
                <span className="mt-1 block text-right text-[10px] font-medium">{caption.length} / 2.200</span>
              </label>
            )}

            {format === "story" ? (
              <label className="relative block text-[12px] font-bold text-[#7A5646]"><span className="flex items-center gap-1"><AtSign className="h-4 w-4 text-[#D90F6F]" /> Menções invisíveis · arroba exato</span>
                <input
                  value={mentions}
                  onChange={(event) => setMentions(event.target.value)}
                  onFocus={() => setMentionFocused(true)}
                  onBlur={() => window.setTimeout(() => setMentionFocused(false), 120)}
                  placeholder="Digite @shop…"
                  autoComplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={mentionFocused && mentionSuggestions.length > 0}
                  aria-controls="instagram-mention-suggestions"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#EADFD3] bg-white px-3 text-[14px] text-[#4A1A04]"
                />
                {mentionFocused && mentionSuggestions.length > 0 && (
                  <div id="instagram-mention-suggestions" role="listbox" className="absolute inset-x-0 top-[66px] z-20 overflow-hidden rounded-xl border border-[#EADFD3] bg-white p-1.5 shadow-xl">
                    <div className="px-2 py-1 text-[9px] font-extrabold uppercase tracking-wide text-[#7A5646]">Usados anteriormente</div>
                    {mentionSuggestions.map((username) => (
                      <button
                        key={username}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectMention(username)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] font-bold text-[#4A1A04] hover:bg-[#FDE3EF]"
                      >
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-[#FDE3EF] text-[#D90F6F]">@</span>
                        @{username}
                      </button>
                    ))}
                  </div>
                )}
                <span className="mt-1 block text-[10px] font-medium">As sugestões vêm do histórico. Para outro perfil, informe o @ exato; separe vários por espaço ou vírgula.</span>
              </label>
            ) : (
              <label className="flex items-center gap-2 rounded-xl border border-[#EADFD3] bg-white p-3 text-[13px] font-bold"><input type="checkbox" checked={locationEnabled} onChange={(event) => setLocationEnabled(event.target.checked)} className="accent-[#D90F6F]" /><MapPin className="h-4 w-4 text-[#217A8F]" /> Marcar {SHOPPING_AUTOMOVEL.name}</label>
            )}

            {format === "reel" && <label className="flex items-center gap-2 text-[13px] font-bold"><input type="checkbox" checked={shareToFeed} onChange={(event) => setShareToFeed(event.target.checked)} className="accent-[#D90F6F]" /> Mostrar também na grade do feed</label>}

            {localError && <p role="alert" className="rounded-lg bg-[#FBE4E1] px-3 py-2 text-[12px] font-bold text-[#A52E24]">{localError}</p>}
          </fieldset>

          <div className="mt-6 flex justify-end gap-2 border-t border-[#EADFD3] pt-4">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-[#EADFD3] bg-white px-4 py-2.5 text-[13px] font-bold disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={busy} className="rounded-lg bg-[#F462A7] px-5 py-2.5 text-[13px] font-extrabold text-[#4A1A04] disabled:cursor-wait disabled:opacity-60">{busy ? "Agendando…" : "Agendar publicação"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
