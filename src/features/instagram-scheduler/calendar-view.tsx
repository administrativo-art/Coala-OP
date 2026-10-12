"use client";

import { useMemo, useState } from "react";
import { AtSign, CalendarClock, CheckCircle2, GripVertical, ImageOff, MapPin, Pause } from "lucide-react";

import {
  instagramStatusLabels,
  type InstagramPublicationFormat,
  type InstagramPublicationStatus,
  type InstagramScheduleListItem,
} from "./contracts";
import { Segmented } from "@/components/patterns/segmented";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HeroChip, PulseHero } from "./hero-panel";
import { formatTone } from "./format-tone";
import { ProtectedMedia } from "./protected-media";
import { ScheduleCardMenu, type ScheduleCardActions } from "./schedule-card-menu";
import {
  addDaysToKey,
  addMonthsToKey,
  calendarMonthKeys,
  dateKeyInBelem,
  formatTheme,
  instagramPostTitle,
  isScheduleEditable,
  monthLabel,
  monthStartKey,
  moveScheduleToDate,
  parseDateKey,
  startOfWeekKey,
  timeInBelem,
  weekLabel,
} from "./workspace-utils";

const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const statusDot: Record<InstagramPublicationStatus, string> = {
  uploading: "bg-ds-info",
  scheduled: "bg-ds-accent",
  paused: "bg-ds-ink-faint",
  processing: "bg-ds-warn",
  published: "bg-ds-ok",
  failed: "bg-ds-danger",
  manual_review: "bg-ds-warn",
  cancelled: "bg-ds-ink-faint",
};

type StatusGroup = "scheduled" | "paused" | "published" | "attention";

const statusGroupOf: Record<InstagramPublicationStatus, StatusGroup | null> = {
  uploading: "scheduled",
  scheduled: "scheduled",
  processing: "scheduled",
  paused: "paused",
  published: "published",
  failed: "attention",
  manual_review: "attention",
  cancelled: null,
};

type CalendarViewProps = {
  items: InstagramScheduleListItem[];
  loading: boolean;
  onRefresh: () => void;
  onCreate: (dateKey: string) => void;
  onOpen: (item: InstagramScheduleListItem) => void;
  actions: ScheduleCardActions;
};

function CalendarPostCard({
  item,
  compact = false,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onReschedule,
  actions,
}: {
  item: InstagramScheduleListItem;
  actions: ScheduleCardActions;
  compact?: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onReschedule: (dateKey: string) => void;
}) {
  const theme = formatTheme[item.format];
  const tone = formatTone[item.format];
  const editable = isScheduleEditable(item);
  const preview = item.media[0]?.previewUrl ?? null;
  const kind = item.media[0]?.kind ?? "image";
  const dateKey = dateKeyInBelem(item.scheduledAt);

  if (compact) {
    return (
      <div className="group relative">
        <button
          type="button"
          draggable={editable}
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", item.id);
            event.dataTransfer.effectAllowed = "move";
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          onClick={() => !dragging && onOpen()}
          className={cn(
            "w-full truncate rounded-ds-sm py-1 pl-1.5 pr-7 text-left text-[11px] font-bold outline-none transition hover:ring-2 hover:ring-ds-accent focus-visible:ring-2 focus-visible:ring-ds-accent-ink",
            tone.chip,
            editable ? "cursor-grab" : "cursor-pointer",
            dragging && "opacity-50"
          )}
          title={`${timeInBelem(item.scheduledAt)} · ${instagramPostTitle(item)}`}
        >
          {timeInBelem(item.scheduledAt)} {item.format === "story" && item.media.length > 1 ? `Sequência · ${item.media.length} Stories · ` : ""}{instagramPostTitle(item)}{item.storyMentions.length > 0 ? ` · @${item.storyMentions.join(" · @")}` : ""}
        </button>
        <ScheduleCardMenu
          item={item}
          actions={actions}
          className="absolute right-0.5 top-1/2 -translate-y-1/2 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
        />
      </div>
    );
  }

  return (
    <article
      draggable={editable}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative rounded-ds-btn border bg-white p-2 transition hover:shadow-ds-lift",
        item.status === "published" ? "border-ds-ok" : "border-ds-border hover:border-ds-accent",
        editable ? "cursor-grab" : "cursor-default",
        dragging && "opacity-50"
      )}
    >
      <button
        type="button"
        onClick={() => !dragging && onOpen()}
        className="block w-full rounded-ds-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
      >
        <div className="flex items-center justify-between gap-1 pr-7">
          <span className="flex items-center gap-1 font-ds-mono text-[12px] font-bold text-ds-ink">
            {editable && <GripVertical className="h-3 w-3 text-ds-ink-faint" aria-hidden="true" />}
            {timeInBelem(item.scheduledAt)}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-extrabold", tone.chip)}>
            {item.format === "story" && item.media.length > 1 ? `Sequência · ${item.media.length} Stories` : theme.label}
          </span>
        </div>
        <div className={`mt-2 overflow-hidden rounded-ds-sm ${item.format === "story" || item.format === "reel" ? "h-20" : "h-16"}`}>
          {preview || kind === "video" ? (
            <ProtectedMedia url={preview} alt={`Prévia de ${instagramPostTitle(item)}`} kind={kind} />
          ) : (
            <div className="grid h-full place-items-center bg-ds-muted text-ds-ink-faint">
              <ImageOff className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
        </div>
        <h3 className="mt-2 line-clamp-2 text-[13px] font-bold leading-[1.3] text-ds-ink">{instagramPostTitle(item)}</h3>
        {item.format === "story" && item.media.length > 1 && (
          <p className="mt-1 truncate font-ds-mono text-[10px] font-bold text-ds-ink-muted">{item.media.map((_, index) => index + 1).join(" → ")}</p>
        )}
        {item.storyMentions.length > 0 && (
          <p className="mt-1 flex items-center gap-1 truncate text-[10px] font-semibold text-ds-accent-ink">
            <AtSign className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.storyMentions.map((username) => `@${username}`).join(", ")}</span>
          </p>
        )}
        {item.location && (
          <p className="mt-1 flex items-center gap-1 truncate text-[10px] font-semibold text-ds-info">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.location.name}</span>
          </p>
        )}
        {item.status === "published" ? (
          <div className="mt-2 flex items-center gap-1.5 rounded-ds-sm bg-ds-ok-bg px-2 py-1.5 text-[12px] font-extrabold text-ds-ok">
            <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{instagramStatusLabels[item.status]}</span>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ds-ink-muted">
            <span className={cn("h-2 w-2 rounded-full", statusDot[item.status])} />
            {item.status === "scheduled" && <CalendarClock className="h-3.5 w-3.5 text-ds-accent-ink" aria-hidden="true" />}
            {item.status === "paused" && <Pause className="h-3.5 w-3.5 text-ds-ink-faint" aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate">{instagramStatusLabels[item.status]}</span>
          </div>
        )}
      </button>
      <ScheduleCardMenu item={item} actions={actions} className="absolute right-1.5 top-1.5" />
      {editable && (
        <label
          className="mt-2 block border-t border-ds-divider pt-2 text-[10px] font-bold text-ds-ink-muted"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          Alterar data
          <input
            type="date"
            value={dateKey}
            min={dateKeyInBelem(new Date())}
            onChange={(event) => event.target.value && onReschedule(event.target.value)}
            className="mt-1 block h-7 w-full rounded-ds-sm border border-ds-border-input bg-ds-input px-1.5 text-[11px] text-ds-ink outline-none focus:border-ds-modal"
          />
        </label>
      )}
    </article>
  );
}

export function CalendarView({ items, loading, onRefresh, onCreate, onOpen, actions }: CalendarViewProps) {
  const today = dateKeyInBelem(new Date());
  const [mode, setMode] = useState<"week" | "month">("week");
  const [weekStart, setWeekStart] = useState(() => startOfWeekKey(today));
  const [month, setMonth] = useState(() => monthStartKey(today));
  const [formatFilter, setFormatFilter] = useState<InstagramPublicationFormat | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusGroup | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overDate, setOverDate] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDaysToKey(weekStart, index)), [weekStart]);
  const monthDays = useMemo(() => calendarMonthKeys(month), [month]);
  const periodDays = mode === "week" ? weekDays : monthDays;

  const formatItems = useMemo(
    () => items.filter((item) => formatFilter === null || item.format === formatFilter),
    [formatFilter, items],
  );
  const periodItems = useMemo(() => {
    const days = new Set(periodDays);
    return formatItems.filter((item) => days.has(dateKeyInBelem(item.scheduledAt)));
  }, [formatItems, periodDays]);
  const groupCount = (group: StatusGroup) => periodItems.filter((item) => statusGroupOf[item.status] === group).length;
  const visibleItems = useMemo(
    () => formatItems.filter((item) => statusFilter === null || statusGroupOf[item.status] === statusFilter),
    [formatItems, statusFilter],
  );
  const itemsByDay = useMemo(() => {
    const map = new Map<string, InstagramScheduleListItem[]>();
    for (const item of visibleItems) {
      const key = dateKeyInBelem(item.scheduledAt);
      const group = map.get(key) ?? [];
      group.push(item);
      map.set(key, group);
    }
    for (const group of map.values()) {
      group.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    }
    return map;
  }, [visibleItems]);

  async function reschedule(item: InstagramScheduleListItem, dateKey: string) {
    if (!isScheduleEditable(item) || dateKey === dateKeyInBelem(item.scheduledAt)) return;
    setPendingId(item.id);
    try {
      await actions.onReschedule(item.id, moveScheduleToDate(item.scheduledAt, dateKey));
    } finally {
      setPendingId(null);
    }
  }

  async function dropOn(dateKey: string, fallbackId?: string) {
    if (dateKey < today) return;
    const id = draggedId ?? fallbackId;
    setDraggedId(null);
    setOverDate(null);
    const item = items.find((candidate) => candidate.id === id);
    if (item) await reschedule(item, dateKey);
  }

  function navigate(direction: -1 | 1) {
    if (mode === "week") setWeekStart((value) => addDaysToKey(value, direction * 7));
    else setMonth((value) => addMonthsToKey(value, direction));
  }

  function goToday() {
    setWeekStart(startOfWeekKey(today));
    setMonth(monthStartKey(today));
  }

  const periodText = mode === "week" ? weekLabel(weekStart) : monthLabel(month);
  const toggleStatus = (group: StatusGroup) => setStatusFilter((current) => (current === group ? null : group));
  const dayDropProps = (day: string) => ({
    onDragOver: (event: React.DragEvent) => {
      if (day < today) return;
      event.preventDefault();
      setOverDate(day);
    },
    onDragLeave: () => setOverDate((current) => (current === day ? null : current)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      if (day < today) return;
      void dropOn(day, event.dataTransfer.getData("text/plain"));
    },
  });
  const cardHandlers = (item: InstagramScheduleListItem) => ({
    item,
    dragging: draggedId === item.id || pendingId === item.id,
    onDragStart: () => setDraggedId(item.id),
    onDragEnd: () => {
      setDraggedId(null);
      setOverDate(null);
    },
    onOpen: () => onOpen(item),
    onReschedule: (nextDay: string) => void reschedule(item, nextDay),
    actions,
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-5 bg-ds-warm px-4 py-5 font-ds text-ds-ink md:px-7" aria-labelledby="instagram-calendar-title">
      <PulseHero
        kicker="Programação do Instagram"
        title="Calendário"
        titleId="instagram-calendar-title"
        subtitle={<span className="whitespace-nowrap text-[15px] font-bold">{periodText}</span>}
        actions={<Button type="button" variant="primary-page" size="xl" onClick={() => onCreate(today)} className="whitespace-nowrap">+ Planejar publicação</Button>}
        compactInfo={periodText}
        compactActions={<Button type="button" variant="primary-page" size="md" onClick={() => onCreate(today)} className="whitespace-nowrap">+ Planejar publicação</Button>}
        chips={(
          <>
            <HeroChip value={groupCount("scheduled")} label="Programadas" tone="info" active={statusFilter === "scheduled"} onClick={() => toggleStatus("scheduled")} />
            <HeroChip value={groupCount("paused")} label="Pausadas" tone="warning" active={statusFilter === "paused"} onClick={() => toggleStatus("paused")} />
            <HeroChip value={groupCount("published")} label="Publicadas" tone="neutral" active={statusFilter === "published"} onClick={() => toggleStatus("published")} />
            <HeroChip value={groupCount("attention")} label="Exigem atenção" tone="danger" active={statusFilter === "attention"} onClick={() => toggleStatus("attention")} />
          </>
        )}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5" role="toolbar" aria-label="Ferramentas do calendário">
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="ds-secondary" size="md" onClick={() => navigate(-1)} aria-label="Período anterior">‹</Button>
          <Button type="button" variant="ds-secondary" size="md" onClick={goToday}>Hoje</Button>
          <Button type="button" variant="ds-secondary" size="md" onClick={() => navigate(1)} aria-label="Próximo período">›</Button>
        </div>
        <Segmented
          value={mode}
          onChange={setMode}
          aria-label="Visão do calendário"
          options={[{ value: "week", label: "Semana" }, { value: "month", label: "Mês" }]}
        />
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Formato">
          {[{ value: null, label: "Todos os formatos", count: items.length }, ...(Object.keys(formatTheme) as InstagramPublicationFormat[]).map((format) => ({
            value: format,
            label: formatTheme[format].label,
            count: items.filter((item) => item.format === format).length,
          }))].map((chip) => {
            const active = formatFilter === chip.value;
            return (
              <button
                key={chip.value ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => setFormatFilter(chip.value)}
                className={cn(
                  "h-8 rounded-full border px-3 text-[12.5px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink",
                  active ? "border-ds-ink bg-ds-ink text-white" : "border-ds-border-input bg-white text-ds-ink-2 hover:bg-ds-muted"
                )}
              >
                {chip.label} <span className="font-semibold opacity-60">{chip.count}</span>
              </button>
            );
          })}
        </div>
        <Button type="button" variant="ds-secondary" size="md" onClick={onRefresh} disabled={loading} aria-label="Atualizar calendário" className="ml-auto">
          {loading ? "Atualizando…" : "Atualizar"}
        </Button>
      </div>

      {mode === "week" ? (
        <div className="min-h-0 flex-1 overflow-x-auto rounded-ds-card-lg border border-ds-border bg-ds-warm">
          <div className="grid min-h-full min-w-[1050px] grid-cols-7">
            {weekDays.map((day) => {
              const dayItems = itemsByDay.get(day) ?? [];
              const date = parseDateKey(day);
              const isToday = day === today;
              const isPast = day < today;
              return (
                <div
                  key={day}
                  {...dayDropProps(day)}
                  className={cn(
                    "flex min-w-0 flex-col border-r border-ds-divider last:border-r-0",
                    overDate === day ? "bg-ds-accent-soft" : isToday ? "bg-white" : isPast ? "bg-ds-muted/50" : ""
                  )}
                >
                  <div className="flex items-baseline gap-1.5 border-b border-ds-divider px-3 py-2.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-ds-ink-muted">{weekdays[(date?.getUTCDay() ?? 1) === 0 ? 6 : (date?.getUTCDay() ?? 1) - 1]}</span>
                    <span className={cn("rounded-xl px-2 py-0.5 text-[17px] font-extrabold", isToday && "bg-ds-accent-ink text-white")}>{date?.getUTCDate()}</span>
                    {dayItems.length > 0 && <span className="ml-auto text-[11px] text-ds-ink-muted">{dayItems.length}</span>}
                    {!isPast && (
                      <button type="button" onClick={() => onCreate(day)} aria-label={`Planejar publicação em ${day}`} className={cn(dayItems.length === 0 && "ml-auto", "grid h-6 w-6 place-items-center rounded-ds-sm font-bold text-ds-accent-ink hover:bg-ds-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink")}>+</button>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-2">
                    {dayItems.map((item) => <CalendarPostCard key={item.id} {...cardHandlers(item)} />)}
                    {dayItems.length === 0 && !isPast && (
                      <button type="button" onClick={() => onCreate(day)} className="rounded-ds-btn border border-dashed border-ds-border-input px-2 py-3 text-center text-[12px] leading-5 text-ds-ink-muted hover:border-ds-accent hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink">
                        Dia livre
                        <br />
                        <span className="font-bold text-ds-accent-ink">Pronto para planejar</span>
                      </button>
                    )}
                    {dayItems.length > 0 && !isPast && (
                      <button type="button" onClick={() => onCreate(day)} className="mt-auto flex items-center justify-center gap-1 rounded-ds-btn border border-dashed border-ds-border-input bg-white/60 px-2 py-2 text-[11px] font-extrabold text-ds-accent-ink hover:border-ds-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink">
                        + Mais uma publicação
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto rounded-ds-card-lg border border-ds-border bg-ds-warm">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-7 border-b border-ds-divider">
              {weekdays.map((weekday) => (
                <div key={weekday} className="px-2.5 py-2 text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-ds-ink-faint">{weekday}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {monthDays.map((day) => {
                const dayItems = itemsByDay.get(day) ?? [];
                const date = parseDateKey(day);
                const inMonth = date?.getUTCMonth() === parseDateKey(month)?.getUTCMonth();
                return (
                  <div
                    key={day}
                    {...dayDropProps(day)}
                    className={cn(
                      "flex min-h-[116px] min-w-0 flex-col gap-1 border-b border-r border-ds-divider p-1.5",
                      !inMonth && "opacity-45",
                      overDate === day ? "bg-ds-accent-soft" : day === today ? "bg-white" : ""
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={cn("self-start rounded-xl px-2 py-0.5 text-[12px] font-extrabold", day === today && "bg-ds-accent-ink text-white")}>{date?.getUTCDate()}</span>
                      {day >= today && <button type="button" onClick={() => onCreate(day)} aria-label={`Planejar publicação em ${day}`} className="grid h-6 w-6 place-items-center rounded-ds-sm font-bold text-ds-accent-ink hover:bg-ds-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink">+</button>}
                    </div>
                    {dayItems.slice(0, 3).map((item) => <CalendarPostCard key={item.id} compact {...cardHandlers(item)} />)}
                    {dayItems.length > 3 && <span className="text-[11px] font-bold text-ds-ink-muted">+{dayItems.length - 3}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-ds-ink-muted">
        Use o + para criar quantas publicações quiser no mesmo dia. Clique em uma arte para abrir os detalhes ou arraste uma publicação programada para outra data.
      </p>
    </section>
  );
}
