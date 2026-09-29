"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Film,
  ImageIcon,
  Loader2,
  MapPin,
  RefreshCw,
} from "lucide-react";

import {
  instagramFormatLabels,
  instagramStatusLabels,
  type InstagramPublicationStatus,
  type InstagramScheduleListItem,
} from "@/features/instagram-scheduler/contracts";
import { useAuth } from "@/hooks/use-auth";

type ScheduleResponse = { items?: InstagramScheduleListItem[]; error?: { message?: string } };

const statusClass: Record<InstagramPublicationStatus, string> = {
  uploading: "border-violet-200 bg-violet-50 text-violet-700",
  scheduled: "border-sky-200 bg-sky-50 text-sky-700",
  processing: "border-amber-200 bg-amber-50 text-amber-700",
  published: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  manual_review: "border-orange-200 bg-orange-50 text-orange-700",
  cancelled: "border-slate-200 bg-slate-100 text-slate-600",
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Belem",
  dateStyle: "medium",
  timeStyle: "short",
});

function formattedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Horário indisponível" : dateFormatter.format(date);
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ImagePreview({
  url,
  token,
  alt,
}: {
  url: string;
  token: string | null;
  alt: string;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;

    void fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Prévia indisponível.");
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => undefined);

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, url]);

  if (!source) {
    return (
      <div className="flex aspect-[4/5] items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl bg-slate-100 shadow-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={source}
          alt={alt}
          className="aspect-[4/5] w-full object-contain"
          onLoad={(event) => {
            setDimensions({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            });
          }}
        />
      </div>
      {dimensions && (
        <p className="mt-2 text-center text-xs font-semibold text-slate-500">
          {dimensions.width} × {dimensions.height} px · proporção {(dimensions.width / dimensions.height).toFixed(3)}
        </p>
      )}
    </div>
  );
}

export default function InstagramProgramacaoPage() {
  const router = useRouter();
  const { firebaseUser, isAuthenticated, loading: authLoading, logout } = useAuth();
  const [items, setItems] = useState<InstagramScheduleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewToken, setPreviewToken] = useState<string | null>(null);

  const loadSchedule = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      setPreviewToken(token);
      const response = await fetch("/api/integrations/instagram/schedule", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as ScheduleResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Não foi possível carregar a programação.");
      }
      setItems(payload?.items ?? []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível carregar a programação.",
      );
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login?next=%2Finstagram-programacao");
      return;
    }
    if (!authLoading && firebaseUser) void loadSchedule();
  }, [authLoading, firebaseUser, isAuthenticated, loadSchedule, router]);

  const totals = useMemo(
    () => ({
      scheduled: items.filter((item) => item.status === "scheduled").length,
      published: items.filter((item) => item.status === "published").length,
      attention: items.filter((item) => ["failed", "manual_review"].includes(item.status)).length,
    }),
    [items],
  );

  if (authLoading || (!isAuthenticated && loading)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f6f2] text-slate-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando acesso…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f6f2] text-slate-950">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <header className="flex flex-col gap-5 border-b border-slate-200 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#c4187a]">
              <span className="h-2.5 w-2.5 rounded-full bg-[#e91e8c]" />
              Coala One · acesso exclusivo
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Programação do Instagram
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Publicações programadas pelo Coala para <strong>@coalashakes</strong>. Agendamentos
              feitos diretamente no Instagram ou no Business Suite permanecem nas agendas desses serviços.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadSchedule()}
              disabled={loading}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold shadow-sm transition hover:border-slate-400 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="h-11 rounded-xl px-4 text-sm font-semibold text-slate-500 transition hover:bg-white hover:text-slate-800"
            >
              Sair
            </button>
          </div>
        </header>

        <section className="grid gap-3 py-6 sm:grid-cols-3">
          <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
            <CalendarClock className="mb-4 h-5 w-5 text-sky-600" />
            <div className="text-3xl font-extrabold">{totals.scheduled}</div>
            <div className="text-sm text-slate-500">programadas</div>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
            <CheckCircle2 className="mb-4 h-5 w-5 text-emerald-600" />
            <div className="text-3xl font-extrabold">{totals.published}</div>
            <div className="text-sm text-slate-500">publicadas</div>
          </div>
          <div className="rounded-2xl border border-orange-100 bg-white p-5 shadow-sm">
            <AlertCircle className="mb-4 h-5 w-5 text-orange-600" />
            <div className="text-3xl font-extrabold">{totals.attention}</div>
            <div className="text-sm text-slate-500">precisam de atenção</div>
          </div>
        </section>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        <section className="space-y-4" aria-live="polite">
          {loading && items.length === 0 ? (
            <div className="flex min-h-52 items-center justify-center rounded-3xl border border-slate-200 bg-white text-sm text-slate-500 shadow-sm">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando programação…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm">
              <CalendarClock className="mx-auto mb-4 h-9 w-9 text-slate-300" />
              <h2 className="text-lg font-bold">Nenhuma publicação programada pelo Coala</h2>
              <p className="mt-2 text-sm text-slate-500">O primeiro teste aparecerá aqui assim que for criado.</p>
            </div>
          ) : (
            items.map((item) => (
              <article key={item.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
                  {item.media[0]?.previewUrl ? (
                    <ImagePreview
                      url={item.media[0].previewUrl}
                      token={previewToken}
                      alt={`Prévia de ${instagramFormatLabels[item.format].toLowerCase()} programado`}
                    />
                  ) : (
                    <div className="flex aspect-[4/5] items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                      {item.media.some((media) => media.kind === "video") ? (
                        <Film className="h-8 w-8" />
                      ) : (
                        <ImageIcon className="h-8 w-8" />
                      )}
                    </div>
                  )}
                  <div>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pink-50 text-[#c4187a]">
                      {item.media.some((media) => media.kind === "video") ? (
                        <Film className="h-5 w-5" />
                      ) : (
                        <ImageIcon className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-extrabold">{instagramFormatLabels[item.format]}</h2>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass[item.status]}`}>
                          {instagramStatusLabels[item.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-slate-700">{formattedDate(item.scheduledAt)}</p>
                      {item.location && (
                        <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600">
                          <MapPin className="h-4 w-4 text-[#c4187a]" /> {item.location.name}
                        </p>
                      )}
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                        {item.caption || (item.format === "story" ? "Story sem legenda" : "Sem legenda")}
                      </p>
                    </div>
                  </div>
                  {item.permalink && (
                    <a
                      href={item.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-bold text-[#c4187a] hover:underline"
                    >
                      Ver no Instagram <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  {item.media.map((media, index) => (
                    <span key={`${media.fileName}-${index}`} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-600">
                      {media.fileName} · {fileSize(media.sizeBytes)}
                    </span>
                  ))}
                </div>

                {item.safeError && (
                  <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                    {item.safeError}
                    {item.errorEventId ? ` · referência ${item.errorEventId}` : ""}
                  </div>
                )}
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
