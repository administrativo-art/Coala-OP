"use client";

import { useEffect, useMemo, useState } from "react";
import { Grip, Images, Play } from "lucide-react";

import {
  instagramStatusLabels,
  type InstagramPublishedFeedItem,
  type InstagramPublishedFeedProfile,
  type InstagramPublicationFormat,
  type InstagramScheduleListItem,
} from "./contracts";
import { Segmented } from "@/components/patterns/segmented";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { HeroChip, PulseHero } from "./hero-panel";
import { formatTone, publicationStatusVariant } from "./format-tone";
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

  const scheduledCount = gridItems.filter((entry) => entry.source === "schedule").length;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-5 bg-ds-warm px-4 py-5 font-ds text-ds-ink md:px-7" aria-labelledby="instagram-feed-grid-title">
      <PulseHero
        kicker="Programação do Instagram"
        title="Grade do feed"
        titleId="instagram-feed-grid-title"
        subtitle="Publicações atuais do Instagram e conteúdos já programados."
        actions={<Button type="button" variant="on-dark-secondary" size="xl" onClick={onRefreshLive} disabled={liveLoading} aria-label="Atualizar grade do Instagram">{liveLoading ? "Atualizando…" : "Atualizar grade"}</Button>}
        compactActions={<Button type="button" variant="on-dark-secondary" size="md" onClick={onRefreshLive} disabled={liveLoading} aria-label="Atualizar grade do Instagram">{liveLoading ? "Atualizando…" : "Atualizar grade"}</Button>}
        chips={(
          <>
            <HeroChip value={gridItems.length - scheduledCount} label="Já publicadas" />
            <HeroChip value={scheduledCount} label="Na programação" tone="info" />
            {mix.map(({ format, count }) => <HeroChip key={format} value={count} label={formatTheme[format].label} />)}
          </>
        )}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={showReels ? "all" : "feed"}
          onChange={(value) => setShowReels(value === "all")}
          aria-label="Conteúdo da grade"
          options={[{ value: "all", label: "Feed + Reels" }, { value: "feed", label: "Só feed" }]}
        />
        <span className="text-[13px] text-ds-ink-muted">
          @{profile?.username || "coalashakes"} · {liveLoading ? "atualizando…" : `${publishedItems.length} publicações recentes carregadas`}
        </span>
      </div>

      {liveError && (
        <div role="status" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">
          {liveError} A programação local continua disponível.
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 overflow-auto">
          <div className="mx-auto w-full max-w-[500px]">
            {gridItems.length === 0 ? (
              <div className="grid min-h-72 place-items-center rounded-ds-card-lg border border-dashed border-ds-border-input px-8 text-center text-[14px] text-ds-ink-muted">
                {liveLoading ? <span role="status">Carregando grade…</span> : "Nenhuma publicação encontrada."}
              </div>
            ) : (
              <div className="grid h-fit w-full grid-cols-3 gap-[3px] overflow-hidden rounded-ds-card bg-white" aria-busy={pending || liveLoading}>
                {gridItems.map((entry) => {
                  const selectedTile = selected?.key === entry.key;
                  const scheduled = entry.source === "schedule";
                  const editable = scheduled && isScheduleEditable(entry.item);
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
                      className={cn(
                        "relative aspect-square -outline-offset-[3px] overflow-hidden text-left focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ds-accent-ink",
                        formatTone[entry.format].tile,
                        overKey === entry.key ? "outline outline-[3px] outline-dashed outline-ds-accent-ink" : selectedTile ? "outline outline-[3px] outline-ds-accent-ink" : scheduled && "outline outline-1 outline-ds-accent",
                        draggedId === (scheduled ? entry.item.id : "") && "opacity-50"
                      )}
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
                          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-ds-sm bg-ds-dark/90 px-1.5 py-0.5 font-ds-mono text-[10px] font-bold text-white">
                            {editable && <Grip className="h-2.5 w-2.5" aria-hidden="true" />}
                            {shortDate(dateKeyInBelem(entry.item.scheduledAt))}
                          </span>
                          <span className="absolute inset-x-1.5 bottom-1.5 line-clamp-2 rounded-ds-sm bg-white/95 px-1.5 py-1 text-[10px] font-bold leading-tight text-ds-ink">{entryTitle(entry)}</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-center text-[11px] leading-4 text-ds-ink-muted">A Meta retorna as publicações por data. Fixações feitas no aplicativo podem aparecer em outra posição no perfil.</p>
          </div>
        </div>

        <aside className="rounded-ds-card-lg border border-ds-border bg-ds-surface p-5 xl:self-start xl:p-6">
          {selected ? (
            <div className="flex h-full flex-col gap-5">
              <div>
                <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">{selected.source === "instagram" ? "Já publicado" : "Na programação"}</p>
                <h2 className="mt-1 text-[20px] font-extrabold leading-tight">{entryTitle(selected)}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ds-ink-muted">
                  {longDate(dateKeyInBelem(selected.date))} <span className="font-ds-mono">{timeInBelem(selected.date)}</span> · {formatTheme[selected.format].label}
                  {selected.source === "schedule" && (
                    <StatusPill variant={publicationStatusVariant[selected.item.status]}>{instagramStatusLabels[selected.item.status]}</StatusPill>
                  )}
                </div>
                {selected.item.caption && <p className="mt-4 line-clamp-6 whitespace-pre-line text-[13px] leading-5 text-ds-ink-muted">{selected.item.caption}</p>}
              </div>

              <div className="space-y-2.5">
                <h3 className="text-[15px] font-extrabold">Teste de vizinhança</h3>
                <p className="text-[13px] leading-5 text-ds-ink-muted">Compara a publicação com as seis anteriores. Evite três conteúdos do mesmo formato em sequência.</p>
                <div className="flex gap-1" aria-label="Sequência de formatos">
                  {[selected, ...neighbors].map((entry) => (
                    <span key={entry.key} className={cn("h-11 flex-1 rounded-ds-sm", formatTone[entry.format].tile, entry.key === selected.key && "outline outline-2 outline-offset-2 outline-ds-accent-ink")} title={formatTheme[entry.format].label} />
                  ))}
                </div>
                <div className={cn("rounded-ds-btn px-3 py-2.5 text-[13px] font-extrabold", repeatsFormat ? "bg-ds-warn-bg text-ds-warn" : "bg-ds-ok-bg text-ds-ok")}>
                  {repeatsFormat ? `Atenção: 3 ${formatTheme[selected.format].label} seguidos` : "Passa: o formato varia das publicações vizinhas"}
                </div>
              </div>

              <div className="space-y-2.5">
                <h3 className="text-[15px] font-extrabold">Formatos na grade</h3>
                {mix.map(({ format, count }) => (
                  <div key={format} className="grid grid-cols-[90px_1fr_28px] items-center gap-2 text-[13px]">
                    <span>{formatTheme[format].label}</span>
                    <span className="h-2 overflow-hidden rounded bg-ds-muted"><span className={cn("block h-full rounded", formatTone[format].dot)} style={{ width: `${gridItems.length ? count / gridItems.length * 100 : 0}%` }} /></span>
                    <strong className="text-right font-ds-mono">{count}</strong>
                  </div>
                ))}
              </div>

              {selected.source === "schedule" ? (
                <Button type="button" variant="ds-secondary" size="md" onClick={() => onOpen(selected.item)} className="mt-auto">Abrir detalhes</Button>
              ) : (
                <Button asChild variant="ds-secondary" size="md" className="mt-auto">
                  <a href={selected.item.permalink} target="_blank" rel="noreferrer">Ver no Instagram ↗</a>
                </Button>
              )}
            </div>
          ) : (
            <div className="text-[14px] text-ds-ink-muted">Selecione uma publicação para conferir a composição da grade.</div>
          )}
        </aside>
      </div>
    </section>
  );
}
