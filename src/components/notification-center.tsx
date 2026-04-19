"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

export interface LegacyTask {
  id: string;
  type: string;
  title: string;
  description: string;
  link: string;
  icon: React.FC<{ className?: string }>;
}

type TabKey = "all" | "crit" | "task" | "info";

interface NotificationCenterProps {
  tasks: LegacyTask[];
  criticalCount?: number;
}

export function NotificationCenter({ tasks, criticalCount = 0 }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const unreadTasks = tasks.filter((t) => !readIds.has(t.id));
  const totalUnread = unreadTasks.length + criticalCount;

  function markRead(id: string) {
    setReadIds((prev) => new Set([...prev, id]));
  }

  function markAllRead() {
    setReadIds(new Set(tasks.map((t) => t.id)));
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "all", label: "Todos", count: totalUnread },
    { key: "crit", label: "Críticos", count: criticalCount },
    { key: "task", label: "Tarefas", count: unreadTasks.length },
    { key: "info", label: "Info", count: 0 },
  ];

  const visibleTasks = activeTab === "all" || activeTab === "task" ? tasks : [];

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border transition-colors ${
          open
            ? "border-rose-200 bg-rose-50 text-rose-500 dark:border-rose-800 dark:bg-rose-950/40"
            : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        aria-label="Notificações"
      >
        <Bell className="h-4 w-4" />
        {totalUnread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-background bg-destructive px-[3px] text-[8px] font-bold text-white">
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-50 mt-2 flex w-[340px] flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
          style={{ maxHeight: 480 }}
        >
          {/* Header */}
          <div className="flex-shrink-0 px-4 pb-0 pt-3.5">
            <div className="mb-3 flex items-center">
              <span className="flex-1 text-sm font-bold">Notificações</span>
              <button
                type="button"
                onClick={markAllRead}
                className="rounded-md px-1.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors"
              >
                Marcar tudo como lido
              </button>
            </div>
            {/* Tabs */}
            <div className="flex border-b border-border">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    activeTab === tab.key
                      ? "border-rose-500 text-rose-500"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                  {tab.count > 0 ? (
                    <span className="rounded-full bg-destructive px-1.5 py-px text-[9px] font-bold text-white">
                      {tab.count}
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-1.5 py-px text-[9px] font-bold text-muted-foreground">
                      0
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {visibleTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Bell className="mb-2 h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">Nenhuma notificação.</p>
              </div>
            ) : (
              visibleTasks.map((task) => {
                const isUnread = !readIds.has(task.id);
                const Icon = task.icon;
                return (
                  <div
                    key={task.id}
                    onClick={() => markRead(task.id)}
                    className={`group relative flex cursor-pointer items-start gap-2.5 border-b border-border/60 px-4 py-3 transition-colors last:border-b-0 ${
                      isUnread
                        ? "bg-rose-50/40 hover:bg-rose-50/70 dark:bg-rose-950/10 dark:hover:bg-rose-950/20"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    {/* Unread dot */}
                    <div className="mt-1.5 h-[7px] w-[7px] flex-shrink-0 rounded-full" style={{ background: isUnread ? "#3b82f6" : "transparent" }} />

                    {/* Icon */}
                    <div className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] bg-blue-50 dark:bg-blue-950/30">
                      <Icon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>

                    {/* Body */}
                    <div className="min-w-0 flex-1">
                      <p className="mb-0.5 text-xs font-semibold leading-tight">{task.title}</p>
                      <p className="mb-1 text-[11px] leading-snug text-muted-foreground line-clamp-2">{task.description}</p>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="rounded-full px-1.5 py-px text-[9px] font-semibold"
                          style={{ background: "#eff6ff", color: "#1d4ed8" }}
                        >
                          {task.type}
                        </span>
                      </div>
                    </div>

                    {/* Action */}
                    <Link
                      href={task.link}
                      onClick={(e) => e.stopPropagation()}
                      className="hidden flex-shrink-0 self-center rounded-md bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary group-hover:flex hover:bg-primary/20 transition-colors"
                    >
                      Abrir →
                    </Link>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-border px-4 py-2.5 text-center">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Ver central completa de notificações →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
