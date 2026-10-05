"use client";

import { useMemo, useState } from "react";
import { AtSign, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, GripVertical, ImageOff, MapPin, Pause, Plus, RefreshCw } from "lucide-react";

import {
  instagramStatusLabels,
  type InstagramPublicationFormat,
  type InstagramPublicationStatus,
  type InstagramScheduleListItem,
} from "./contracts";
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
  uploading: "#7B4BA8",
  scheduled: "#F462A7",
  paused: "#8F9BA6",
  processing: "#F9C430",
  published: "#A7AFB5",
  failed: "#C0392B",
  manual_review: "#E07A1F",
  cancelled: "#7A5646",
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
        className={`w-full truncate rounded-md py-1 pl-1.5 pr-7 text-left text-[11px] font-bold outline-none transition hover:ring-2 hover:ring-[#F462A7] focus-visible:ring-2 focus-visible:ring-[#D90F6F] ${editable ? "cursor-grab" : "cursor-pointer"}`}
        style={{ background: theme.background, color: theme.ink, opacity: dragging ? 0.5 : 1 }}
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
      className={`group relative rounded-[10px] border bg-white p-2 shadow-sm transition hover:border-[#F4A6D0] hover:shadow-md ${item.status === "published" ? "border-[#A9D9B8]" : "border-[#EADFD3]"} ${editable ? "cursor-grab" : "cursor-default"}`}
      style={{ opacity: dragging ? 0.5 : 1 }}
    >
      <button
        type="button"
        onClick={() => !dragging && onOpen()}
        className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[#D90F6F]"
      >
        <div className="flex items-center justify-between gap-1 pr-7">
          <span className="flex items-center gap-1 text-[12px] font-extrabold text-[#4A1A04]">
            {editable && <GripVertical className="h-3 w-3 text-[#D9C8B6]" aria-hidden="true" />}
            {timeInBelem(item.scheduledAt)}
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-extrabold"
            style={{ background: theme.background, color: theme.ink }}
          >
            {item.format === "story" && item.media.length > 1 ? `Sequência · ${item.media.length} Stories` : theme.label}
          </span>
        </div>
        <div className={`mt-2 overflow-hidden rounded-md ${item.format === "story" || item.format === "reel" ? "h-20" : "h-16"}`}>
          {preview || kind === "video" ? (
            <ProtectedMedia
              url={preview}
              alt={`Prévia de ${instagramPostTitle(item)}`}
              kind={kind}
            />
          ) : (
            <div className="grid h-full place-items-center bg-[#F3E8DC] text-[#7A5646]">
              <ImageOff className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
        </div>
        <h3 className="mt-2 line-clamp-2 text-[13px] font-bold leading-[1.3] text-[#4A1A04]">
          {instagramPostTitle(item)}
        </h3>
        {item.format === "story" && item.media.length > 1 && (
          <p className="mt-1 truncate text-[10px] font-extrabold text-[#7D184A]">
            {item.media.map((_, index) => index + 1).join(" → ")}
          </p>
        )}
        {item.storyMentions.length > 0 && (
          <p className="mt-1 flex items-center gap-1 truncate text-[10px] font-semibold text-[#D90F6F]">
            <AtSign className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.storyMentions.map((username) => `@${username}`).join(", ")}</span>
          </p>
        )}
        {item.location && (
          <p className="mt-1 flex items-center gap-1 truncate text-[10px] font-semibold text-[#217A8F]">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.location.name}</span>
          </p>
        )}
        {item.status === "published" ? (
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-[#B8DFC4] bg-[#E9F7EE] px-2 py-1.5 text-[12px] font-extrabold text-[#176B38]">
            <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{instagramStatusLabels[item.status]}</span>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#7A5646]">
            <span className="h-2 w-2 rounded-full" style={{ background: statusDot[item.status] }} />
            {item.status === "scheduled" && <CalendarClock className="h-3.5 w-3.5 text-[#D90F6F]" aria-hidden="true" />}
            {item.status === "paused" && <Pause className="h-3.5 w-3.5 text-[#6B7782]" aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate">{instagramStatusLabels[item.status]}</span>
          </div>
        )}
      </button>
      <ScheduleCardMenu item={item} actions={actions} className="absolute right-1.5 top-1.5" />
      {editable && (
        <label
          className="mt-2 block border-t border-[#F3E8DC] pt-2 text-[10px] font-bold text-[#7A5646]"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          Alterar data
          <input
            type="date"
            value={dateKey}
            min={dateKeyInBelem(new Date())}
            onChange={(event) => event.target.value && onReschedule(event.target.value)}
            className="mt-1 block h-7 w-full rounded-md border border-[#EADFD3] bg-white px-1.5 text-[11px] text-[#4A1A04] outline-none focus:border-[#F462A7]"
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
  const [hiddenFormats, setHiddenFormats] = useState<Set<InstagramPublicationFormat>>(new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overDate, setOverDate] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const visibleItems = useMemo(
    () => items.filter((item) => !hiddenFormats.has(item.format)),
    [hiddenFormats, items],
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

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDaysToKey(weekStart, index)),
    [weekStart],
  );
  const monthDays = useMemo(() => calendarMonthKeys(month), [month]);

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

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="instagram-calendar-title">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#EADFD3] px-4 py-4 md:px-7">
        <h1 id="instagram-calendar-title" className="text-[22px] font-extrabold tracking-tight text-[#4A1A04]">
          Calendário
        </h1>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => navigate(-1)} aria-label="Período anterior" className="grid h-8 w-8 place-items-center rounded-lg border border-[#EADFD3] bg-white hover:border-[#F462A7]">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={goToday} className="h-8 rounded-lg border border-[#EADFD3] bg-white px-2.5 text-[13px] font-bold hover:border-[#F462A7]">
            Hoje
          </button>
          <button type="button" onClick={() => navigate(1)} aria-label="Próximo período" className="grid h-8 w-8 place-items-center rounded-lg border border-[#EADFD3] bg-white hover:border-[#F462A7]">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="whitespace-nowrap px-2 text-[15px] font-extrabold text-[#4A1A04]">
            {mode === "week" ? weekLabel(weekStart) : monthLabel(month)}
          </div>
        </div>
        <div className="flex rounded-[9px] bg-[#F3E8DC] p-[3px] text-[13px]">
          {(["week", "month"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={`rounded-[7px] px-3 py-1.5 ${mode === value ? "bg-white font-extrabold shadow-sm" : "font-medium"}`}
            >
              {value === "week" ? "Semana" : "Mês"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {(Object.keys(formatTheme) as InstagramPublicationFormat[]).map((format) => {
            const theme = formatTheme[format];
            const enabled = !hiddenFormats.has(format);
            return (
              <button
                key={format}
                type="button"
                aria-pressed={enabled}
                onClick={() => setHiddenFormats((current) => {
                  const next = new Set(current);
                  if (next.has(format)) next.delete(format);
                  else next.add(format);
                  return next;
                })}
                className="flex items-center gap-1.5 rounded-full border border-[#EADFD3] px-2.5 py-1 text-[12px] font-bold transition"
                style={{ background: enabled ? "white" : "transparent", opacity: enabled ? 1 : 0.45 }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: theme.dot }} />
                {theme.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="grid h-8 w-8 place-items-center rounded-lg border border-[#EADFD3] bg-white disabled:opacity-50"
            aria-label="Atualizar calendário"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
        </div>
      </header>

      {mode === "week" ? (
        <div className="min-h-0 flex-1 overflow-x-auto">
          <div className="grid min-h-full min-w-[1050px] grid-cols-7">
            {weekDays.map((day) => {
              const dayItems = itemsByDay.get(day) ?? [];
              const date = parseDateKey(day);
              const isToday = day === today;
              const isPast = day < today;
              return (
                <div
                  key={day}
                  onDragOver={(event) => {
                    if (day < today) return;
                    event.preventDefault();
                    setOverDate(day);
                  }}
                  onDragLeave={() => setOverDate((current) => current === day ? null : current)}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (day < today) return;
                    void dropOn(day, event.dataTransfer.getData("text/plain"));
                  }}
                  className="flex min-w-0 flex-col border-r border-[#F3E8DC]"
                  style={{
                    background: overDate === day ? "#FDE3EF" : isToday ? "#fff" : isPast ? "#F7F1EA" : "transparent",
                  }}
                >
                  <div className="flex items-baseline gap-1.5 border-b border-[#F3E8DC] px-3 py-2.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-[#7A5646]">{weekdays[(date?.getUTCDay() ?? 1) === 0 ? 6 : (date?.getUTCDay() ?? 1) - 1]}</span>
                    <span className={`rounded-xl px-2 py-0.5 text-[17px] font-extrabold ${isToday ? "bg-[#F462A7]" : ""}`}>{date?.getUTCDate()}</span>
                    {dayItems.length > 0 && <span className="ml-auto text-[11px] text-[#7A5646]">{dayItems.length}</span>}
                    {!isPast && (
                      <button type="button" onClick={() => onCreate(day)} aria-label={`Planejar publicação em ${day}`} className={`${dayItems.length === 0 ? "ml-auto" : ""} grid h-6 w-6 place-items-center rounded-md text-[#D90F6F] hover:bg-[#FDE3EF]`}>
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-2">
                    {dayItems.map((item) => (
                      <CalendarPostCard
                        key={item.id}
                        item={item}
                        dragging={draggedId === item.id || pendingId === item.id}
                        onDragStart={() => setDraggedId(item.id)}
                        onDragEnd={() => {
                          setDraggedId(null);
                          setOverDate(null);
                        }}
                        onOpen={() => onOpen(item)}
                        onReschedule={(nextDay) => void reschedule(item, nextDay)}
                        actions={actions}
                      />
                    ))}
                    {dayItems.length === 0 && !isPast && (
                      <button type="button" onClick={() => onCreate(day)} className="rounded-[10px] border border-dashed border-[#D9C8B6] px-2 py-3 text-center text-[12px] leading-5 text-[#7A5646] hover:border-[#F462A7] hover:bg-white">
                        Dia livre
                        <br />
                        <span className="font-bold text-[#D90F6F]">Pronto para planejar</span>
                      </button>
                    )}
                    {dayItems.length > 0 && !isPast && (
                      <button type="button" onClick={() => onCreate(day)} className="mt-auto flex items-center justify-center gap-1 rounded-lg border border-dashed border-[#D9C8B6] bg-white/60 px-2 py-2 text-[11px] font-extrabold text-[#D90F6F] hover:border-[#F462A7]">
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Mais uma publicação
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-7 border-b border-[#EADFD3]">
              {weekdays.map((weekday) => (
                <div key={weekday} className="px-2.5 py-2 text-[11px] font-extrabold uppercase tracking-wide text-[#7A5646]">{weekday}</div>
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
                    onDragOver={(event) => {
                      if (day < today) return;
                      event.preventDefault();
                      setOverDate(day);
                    }}
                    onDragLeave={() => setOverDate((current) => current === day ? null : current)}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (day < today) return;
                      void dropOn(day, event.dataTransfer.getData("text/plain"));
                    }}
                    className="flex min-h-[116px] min-w-0 flex-col gap-1 border-b border-r border-[#F3E8DC] p-1.5"
                    style={{ opacity: inMonth ? 1 : 0.45, background: overDate === day ? "#FDE3EF" : day === today ? "#fff" : "transparent" }}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`self-start rounded-xl px-2 py-0.5 text-[12px] font-extrabold ${day === today ? "bg-[#F462A7]" : ""}`}>{date?.getUTCDate()}</span>
                      {day >= today && <button type="button" onClick={() => onCreate(day)} aria-label={`Planejar publicação em ${day}`} className="grid h-6 w-6 place-items-center rounded-md text-[#D90F6F] hover:bg-[#FDE3EF]"><Plus className="h-3.5 w-3.5" /></button>}
                    </div>
                    {dayItems.slice(0, 3).map((item) => (
                      <CalendarPostCard
                        key={item.id}
                        item={item}
                        compact
                        dragging={draggedId === item.id || pendingId === item.id}
                        onDragStart={() => setDraggedId(item.id)}
                        onDragEnd={() => {
                          setDraggedId(null);
                          setOverDate(null);
                        }}
                        onOpen={() => onOpen(item)}
                        onReschedule={(nextDay) => void reschedule(item, nextDay)}
                        actions={actions}
                      />
                    ))}
                    {dayItems.length > 3 && <span className="text-[11px] font-bold text-[#7A5646]">+{dayItems.length - 3}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-[#EADFD3] bg-white px-4 py-2 text-[12px] text-[#7A5646] md:px-7">
        Use o + para criar quantas publicações quiser no mesmo dia. Clique em uma arte para abrir os detalhes ou arraste uma publicação programada para outra data.
      </footer>
    </section>
  );
}
