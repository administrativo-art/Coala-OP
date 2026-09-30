"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Grip, Images, Loader2, Play, RefreshCw } from "lucide-react";

import {
  instagramStatusLabels,
  type InstagramPublishedFeedItem,
  type InstagramPublishedFeedProfile,
  type InstagramPublicationFormat,
  type InstagramScheduleListItem,
} from "./contracts";
import { ProtectedMedia } from "./protected-media";
import {
  dateKeyInBelem,
  formatTheme,
  instagramPostTitle,
  isScheduleEditable,
  longDate,
  shortDate,
  timeInBelem,
} from "./workspace-utils";

type FeedGridViewProps = {
  items: InstagramScheduleListItem[];
  publishedItems: InstagramPublishedFeedItem[];
  profile: InstagramPublishedFeedProfile | null;
  liveLoading: boolean;
  liveError: string | null;
  onRefreshLive: () => void;
  onSwap: (id: string, swapWithId: string) => Promise<void>;
  onOpen: (item: InstagramScheduleListItem) => void;
};

type GridEntry =
  | { key: string; source: "schedule"; format: InstagramPublicationFormat; date: string; item: InstagramScheduleListItem }
  | { key: string; source: "instagram"; format: InstagramPublishedFeedItem["format"]; date: string; item: InstagramPublishedFeedItem };

const feedStatuses = new Set(["scheduled", "processing", "published", "manual_review", "failed"]);

function entryTitle(entry: GridEntry) {
  if (entry.source === "schedule") return instagramPostTitle(entry.item);
  const line = entry.item.caption.split(/\r?\n/).map((part) => part.trim()).find(Boolean);
  return line || "Publicação no Instagram";
}

export function FeedGridView({
  items,
  publishedItems,
  profile,
  liveLoading,
  liveError,
  onRefreshLive,
  onSwap,
  onOpen,
}: FeedGridViewProps) {
  const [showReels, setShowReels] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const gridItems = useMemo(() => {
    const publishedPermalinks = new Set(publishedItems.map((item) => item.permalink));
    const scheduled: GridEntry[] = items
      .filter((item) => item.format !== "story")
      .filter((item) => showReels || item.format !== "reel")
      .filter((item) => feedStatuses.has(item.status))
      .filter((item) => item.format !== "reel" || item.shareToFeed)
      .filter((item) => !item.permalink || !publishedPermalinks.has(item.permalink))
      .map((item) => ({
        key: `schedule:${item.id}`,
        source: "schedule" as const,
        format: item.format,
        date: item.publishedAt ?? item.scheduledAt,
        item,
      }));
    const existing: GridEntry[] = publishedItems
      .filter((item) => showReels || item.format !== "reel")
      .map((item) => ({
        key: `instagram:${item.id}`,
        source: "instagram" as const,
        format: item.format,
        date: item.publishedAt,
        item,
      }));
    return [...scheduled, ...existing]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30);
  }, [items, publishedItems, showReels]);

  useEffect(() => {
    if (selectedKey && !gridItems.some((entry) => entry.key === selectedKey)) setSelectedKey(null);
  }, [gridItems, selectedKey]);

  const selected = gridItems.find((entry) => entry.key === selectedKey) ?? gridItems[0] ?? null;
  const selectedIndex = selected ? gridItems.findIndex((entry) => entry.key === selected.key) : -1;
  const neighbors = selectedIndex >= 0 ? gridItems.slice(selectedIndex + 1, selectedIndex + 7) : [];
  const repeatsFormat = selected
    ? neighbors.length >= 2
      && neighbors[0]?.format === selected.format
      && neighbors[1]?.format === selected.format
    : false;
  const mix = (["feed_image", "carousel", "reel"] as const).map((format) => ({
    format,
    count: gridItems.filter((entry) => entry.format === format).length,
  }));

  async function dropOn(target: GridEntry, fallbackId?: string) {
    const sourceId = draggedId ?? fallbackId;
    setDraggedId(null);
    setOverKey(null);
    if (!sourceId || target.source !== "schedule" || sourceId === target.item.id) return;
    const source = items.find((item) => item.id === sourceId);
    if (!source || !isScheduleEditable(source) || !isScheduleEditable(target.item)) return;
    setPending(true);
    try {
      await onSwap(sourceId, target.item.id);
      setSelectedKey(`schedule:${sourceId}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="instagram-feed-grid-title">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#EADFD3] px-4 py-4 md:px-7">
        <div>
          <h1 id="instagram-feed-grid-title" className="text-[22px] font-extrabold tracking-tight text-[#4A1A04]">Grade do feed</h1>
          <p className="text-[13px] text-[#7A5646]">Publicações atuais do Instagram e conteúdos já programados.</p>
        </div>
        <div className="ml-auto flex rounded-[9px] bg-[#F3E8DC] p-[3px] text-[13px]">
          <button type="button" aria-pressed={showReels} onClick={() => setShowReels(true)} className={`rounded-[7px] px-3 py-1.5 ${showReels ? "bg-white font-extrabold shadow-sm" : "font-medium"}`}>
            Feed + Reels
          </button>
          <button type="button" aria-pressed={!showReels} onClick={() => setShowReels(false)} className={`rounded-[7px] px-3 py-1.5 ${!showReels ? "bg-white font-extrabold shadow-sm" : "font-medium"}`}>
            Só feed
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-auto px-4 py-6 md:px-7">
          <div className="mx-auto w-full max-w-[500px]">
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-[#EADFD3] bg-white p-3 shadow-sm">
              {profile?.profilePictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.profilePictureUrl} alt="" referrerPolicy="no-referrer" className="h-11 w-11 rounded-full object-cover" />
              ) : (
                <div className="grid h-11 w-11 place-items-center rounded-full bg-[#FDE3EF] text-sm font-extrabold text-[#D90F6F]">C</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-extrabold text-[#4A1A04]">@{profile?.username || "coalashakes"}</div>
                <div className="text-[12px] text-[#7A5646]">
                  {liveLoading ? "Atualizando Instagram…" : `${publishedItems.length} publicações recentes carregadas`}
                </div>
              </div>
              <button type="button" onClick={onRefreshLive} disabled={liveLoading} className="grid h-9 w-9 place-items-center rounded-lg border border-[#EADFD3] text-[#7A5646] hover:border-[#F462A7] disabled:opacity-50" aria-label="Atualizar grade do Instagram">
                <RefreshCw className={`h-4 w-4 ${liveLoading ? "animate-spin" : ""}`} aria-hidden="true" />
              </button>
            </div>

            {liveError && (
              <div role="status" className="mb-4 rounded-xl border border-[#E8B9B3] bg-[#FBE4E1] px-3 py-2 text-[12px] font-semibold text-[#A52E24]">
                {liveError} A programação local continua disponível.
              </div>
            )}

            {gridItems.length === 0 ? (
              <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-[#D9C8B6] bg-white px-8 text-center text-[14px] text-[#7A5646]">
                {liveLoading ? <Loader2 className="h-6 w-6 animate-spin" aria-label="Carregando grade" /> : "Nenhuma publicação encontrada."}
              </div>
            ) : (
              <div className="grid h-fit w-full grid-cols-3 gap-[3px] bg-white" aria-busy={pending || liveLoading}>
                {gridItems.map((entry) => {
                  const selectedTile = selected?.key === entry.key;
                  const scheduled = entry.source === "schedule";
                  const editable = scheduled && isScheduleEditable(entry.item);
                  const theme = formatTheme[entry.format];
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      draggable={editable && !pending}
                      onDragStart={(event) => {
                        if (!scheduled) return;
                        event.dataTransfer.setData("text/plain", entry.item.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggedId(entry.item.id);
                      }}
                      onDragEnd={() => { setDraggedId(null); setOverKey(null); }}
                      onDragOver={(event) => { if (editable) { event.preventDefault(); setOverKey(entry.key); } }}
                      onDragLeave={() => setOverKey((current) => current === entry.key ? null : current)}
                      onDrop={(event) => { event.preventDefault(); void dropOn(entry, event.dataTransfer.getData("text/plain")); }}
                      onClick={() => setSelectedKey(entry.key)}
                      className="relative aspect-square overflow-hidden bg-[#F3E8DC] text-left focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#D90F6F]"
                      style={{
                        outline: overKey === entry.key ? "3px dashed #D90F6F" : selectedTile ? "3px solid #D90F6F" : scheduled ? "1px solid #F4A6D0" : "none",
                        outlineOffset: "-3px",
                        opacity: draggedId === (scheduled ? entry.item.id : "") ? 0.5 : 1,
                        background: theme.background,
                      }}
                    >
                      {scheduled ? (
                        <ProtectedMedia url={entry.item.media[0]?.previewUrl ?? null} kind={entry.item.media[0]?.kind ?? "image"} alt={`Prévia de ${entryTitle(entry)}`} />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={entry.item.previewUrl} alt={`Publicação de @${profile?.username || "coalashakes"}`} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                      )}
                      {entry.format === "carousel" && <Images className="absolute right-2 top-2 h-5 w-5 text-white drop-shadow" aria-label="Carrossel" />}
                      {entry.format === "reel" && <Play className="absolute right-2 top-2 h-5 w-5 fill-white text-white drop-shadow" aria-label="Reel" />}
                      {scheduled && (
                        <>
                          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-[#4A1A04]/90 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                            {editable && <Grip className="h-2.5 w-2.5" aria-hidden="true" />}
                            {shortDate(dateKeyInBelem(entry.item.scheduledAt))}
                          </span>
                          <span className="absolute inset-x-1.5 bottom-1.5 line-clamp-2 rounded bg-white/95 px-1.5 py-1 text-[10px] font-bold leading-tight text-[#4A1A04]">{entryTitle(entry)}</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-center text-[11px] leading-4 text-[#7A5646]">A Meta retorna as publicações por data. Fixações feitas no aplicativo podem aparecer em outra posição no perfil.</p>
          </div>
        </div>

        <aside className="border-t border-[#EADFD3] bg-white p-5 xl:border-l xl:border-t-0 xl:p-6">
          {selected ? (
            <div className="flex h-full flex-col gap-5">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-[0.09em] text-[#7A5646]">{selected.source === "instagram" ? "Já publicado" : "Na programação"}</div>
                <h2 className="mt-1 text-[20px] font-extrabold leading-tight text-[#4A1A04]">{entryTitle(selected)}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-[#7A5646]">
                  {longDate(dateKeyInBelem(selected.date))} {timeInBelem(selected.date)} · {formatTheme[selected.format].label}
                  {selected.source === "schedule" && (
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: formatTheme[selected.format].background, color: formatTheme[selected.format].ink }}>{instagramStatusLabels[selected.item.status]}</span>
                  )}
                </div>
                {selected.item.caption && <p className="mt-4 line-clamp-6 whitespace-pre-line text-[13px] leading-5 text-[#7A5646]">{selected.item.caption}</p>}
              </div>

              <div className="space-y-2.5">
                <h3 className="text-[15px] font-extrabold text-[#4A1A04]">Teste de vizinhança</h3>
                <p className="text-[13px] leading-5 text-[#7A5646]">Compara a publicação com as seis anteriores. Evite três conteúdos do mesmo formato em sequência.</p>
                <div className="flex gap-1" aria-label="Sequência de formatos">
                  {[selected, ...neighbors].map((entry) => (
                    <span key={entry.key} className="h-11 flex-1 rounded" style={{ background: formatTheme[entry.format].background, outline: entry.key === selected.key ? "2px solid #D90F6F" : "none", outlineOffset: "2px" }} title={formatTheme[entry.format].label} />
                  ))}
                </div>
                <div className={`rounded-[9px] px-3 py-2.5 text-[13px] font-extrabold ${repeatsFormat ? "bg-[#FCF1DD] text-[#B7791F]" : "bg-[#E2F4EA] text-[#1F8A5B]"}`}>
                  {repeatsFormat ? `Atenção: 3 ${formatTheme[selected.format].label} seguidos` : "Passa: o formato varia das publicações vizinhas"}
                </div>
              </div>

              <div className="space-y-2.5">
                <h3 className="text-[15px] font-extrabold text-[#4A1A04]">Formatos na grade</h3>
                {mix.map(({ format, count }) => (
                  <div key={format} className="grid grid-cols-[90px_1fr_28px] items-center gap-2 text-[13px]">
                    <span>{formatTheme[format].label}</span>
                    <span className="h-2 overflow-hidden rounded bg-[#F3E8DC]"><span className="block h-full rounded" style={{ width: `${gridItems.length ? count / gridItems.length * 100 : 0}%`, background: formatTheme[format].dot }} /></span>
                    <strong className="text-right">{count}</strong>
                  </div>
                ))}
              </div>

              {selected.source === "schedule" ? (
                <button type="button" onClick={() => onOpen(selected.item)} className="mt-auto rounded-[9px] border border-[#EADFD3] bg-white px-3 py-2.5 text-[13px] font-bold hover:border-[#F462A7]">Abrir detalhes</button>
              ) : (
                <a href={selected.item.permalink} target="_blank" rel="noreferrer" className="mt-auto flex items-center justify-center gap-2 rounded-[9px] border border-[#EADFD3] bg-white px-3 py-2.5 text-[13px] font-bold hover:border-[#F462A7]">
                  Ver no Instagram <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              )}
            </div>
          ) : (
            <div className="text-[14px] text-[#7A5646]">Selecione uma publicação para conferir a composição da grade.</div>
          )}
        </aside>
      </div>
    </section>
  );
}
