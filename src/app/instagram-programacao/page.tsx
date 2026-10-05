"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Menu } from "lucide-react";

import { PublicBioSettings } from "@/components/settings/public-bio-settings";
import { CalendarView } from "@/features/instagram-scheduler/calendar-view";
import {
  CreateScheduleDialog,
  type CreateInstagramScheduleInput,
} from "@/features/instagram-scheduler/create-schedule-dialog";
import {
  instagramInsightsSections,
  type InstagramMediaFolder,
  type InstagramMediaLibraryItem,
  type InstagramAdsReport,
  type InstagramAudienceReport,
  type InstagramPublishedFeedItem,
  type InstagramPublishedFeedProfile,
  type InstagramInsightsContentPage,
  type InstagramInsightsPeriod,
  type InstagramInsightsReport,
  type InstagramInsightsSection,
  type InstagramScheduleListItem,
} from "@/features/instagram-scheduler/contracts";
import { FeedGridView } from "@/features/instagram-scheduler/feed-grid-view";
import { InsightsView } from "@/features/instagram-scheduler/insights-view";
import { MediaLibraryView } from "@/features/instagram-scheduler/media-library-view";
import { SchedulePostEditor } from "@/features/instagram-scheduler/schedule-post-editor";
import {
  InstagramWorkspaceSidebar,
  type InstagramWorkspaceView,
} from "@/features/instagram-scheduler/workspace-sidebar";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { dateKeyInBelem } from "@/features/instagram-scheduler/workspace-utils";

type ScheduleResponse = { items?: InstagramScheduleListItem[] };
type MediaResponse = { items?: InstagramMediaLibraryItem[]; nextCursor?: string | null };
type FoldersResponse = { folders?: InstagramMediaFolder[] };
type PublishedFeedResponse = {
  items?: InstagramPublishedFeedItem[];
  profile?: InstagramPublishedFeedProfile;
};

const validViews = new Set<InstagramWorkspaceView>(["calendar", "feed", "media", "bio", "reports"]);
const validInsightsSections = new Set<InstagramInsightsSection>(instagramInsightsSections);

export default function InstagramProgramacaoPage() {
  const router = useRouter();
  const request = useAuthenticatedApi();
  const { firebaseUser, isAuthenticated, isDefaultAdmin, loading: authLoading, logout, permissions } = useAuth();
  const canManageBio = isDefaultAdmin || (permissions.settings.view && permissions.settings.managePublicBio);
  const [activeView, setActiveView] = useState<InstagramWorkspaceView>("calendar");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createDate, setCreateDate] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [schedules, setSchedules] = useState<InstagramScheduleListItem[]>([]);
  const [libraryItems, setLibraryItems] = useState<InstagramMediaLibraryItem[]>([]);
  const [libraryFolders, setLibraryFolders] = useState<InstagramMediaFolder[]>([]);
  const [libraryFolderId, setLibraryFolderId] = useState<string | null>(null);
  const [libraryCursor, setLibraryCursor] = useState<string | null>(null);
  const libraryRequestRef = useRef(0);
  const [publishedItems, setPublishedItems] = useState<InstagramPublishedFeedItem[]>([]);
  const [instagramProfile, setInstagramProfile] = useState<InstagramPublishedFeedProfile | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [publishedLoading, setPublishedLoading] = useState(false);
  const [publishedLoaded, setPublishedLoaded] = useState(false);
  const [publishedError, setPublishedError] = useState<string | null>(null);
  const [insights, setInsights] = useState<InstagramInsightsReport | null>(null);
  const [insightsPeriod, setInsightsPeriod] = useState<InstagramInsightsPeriod>(30);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsSection, setInsightsSection] = useState<InstagramInsightsSection>("overview");
  const [audienceReport, setAudienceReport] = useState<InstagramAudienceReport | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const [adsReport, setAdsReport] = useState<InstagramAdsReport | null>(null);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsError, setAdsError] = useState<string | null>(null);
  const [contentPage, setContentPage] = useState<InstagramInsightsContentPage | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const say = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? null : current), 2_800);
  }, []);

  const loadSchedule = useCallback(async () => {
    if (!firebaseUser) return;
    setScheduleLoading(true);
    setError(null);
    try {
      const response = await request<ScheduleResponse>("/api/integrations/instagram/schedule", {
        fallbackError: "Não foi possível carregar a programação.",
      });
      setSchedules(response.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a programação.");
    } finally {
      setScheduleLoading(false);
    }
  }, [firebaseUser, request]);

  const loadFolderItems = useCallback(async (folderId: string | null, cursor?: string | null) => {
    if (!firebaseUser) return;
    const token = ++libraryRequestRef.current;
    setLibraryLoading(true);
    try {
      const search = new URLSearchParams({ folderId: folderId ?? "root" });
      if (cursor) search.set("cursor", cursor);
      const response = await request<MediaResponse>(`/api/integrations/instagram/media?${search.toString()}`, {
        fallbackError: "Não foi possível carregar a biblioteca.",
      });
      if (token !== libraryRequestRef.current) return;
      setLibraryItems((current) => (cursor ? [...current, ...(response.items ?? [])] : response.items ?? []));
      setLibraryCursor(response.nextCursor ?? null);
    } catch (cause) {
      if (token === libraryRequestRef.current) {
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar a biblioteca.");
      }
    } finally {
      if (token === libraryRequestRef.current) setLibraryLoading(false);
    }
  }, [firebaseUser, request]);

  const loadFolders = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      const response = await request<FoldersResponse>("/api/integrations/instagram/media/folders", {
        fallbackError: "Não foi possível carregar as pastas.",
      });
      setLibraryFolders(response.folders ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar as pastas.");
    }
  }, [firebaseUser, request]);

  const loadLibrary = useCallback(async () => {
    setError(null);
    setLibraryLoaded(true);
    await Promise.all([loadFolders(), loadFolderItems(libraryFolderId)]);
  }, [libraryFolderId, loadFolderItems, loadFolders]);

  const loadPublishedFeed = useCallback(async () => {
    if (!firebaseUser) return;
    setPublishedLoading(true);
    setPublishedError(null);
    try {
      const response = await request<PublishedFeedResponse>("/api/integrations/instagram/feed", {
        fallbackError: "Não foi possível carregar a grade atual do Instagram.",
      });
      setPublishedItems(response.items ?? []);
      setInstagramProfile(response.profile ?? null);
      setPublishedLoaded(true);
    } catch (cause) {
      setPublishedError(cause instanceof Error ? cause.message : "Não foi possível carregar a grade atual do Instagram.");
    } finally {
      setPublishedLoading(false);
    }
  }, [firebaseUser, request]);

  const loadInsights = useCallback(async (period: InstagramInsightsPeriod) => {
    if (!firebaseUser) return;
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const response = await request<InstagramInsightsReport>(`/api/integrations/instagram/insights?period=${period}`, {
        fallbackError: "Não foi possível carregar os relatórios do Instagram.",
      });
      setInsights(response);
    } catch (cause) {
      setInsightsError(cause instanceof Error ? cause.message : "Não foi possível carregar os relatórios do Instagram.");
    } finally {
      setInsightsLoading(false);
    }
  }, [firebaseUser, request]);

  const loadAudience = useCallback(async () => {
    if (!firebaseUser) return;
    setAudienceLoading(true);
    setAudienceError(null);
    try {
      const response = await request<InstagramAudienceReport>("/api/integrations/instagram/insights?section=audience", {
        fallbackError: "Não foi possível carregar os dados agregados do público.",
      });
      setAudienceReport(response);
    } catch (cause) {
      setAudienceError(cause instanceof Error ? cause.message : "Não foi possível carregar os dados agregados do público.");
    } finally {
      setAudienceLoading(false);
    }
  }, [firebaseUser, request]);

  const loadAds = useCallback(async (period: InstagramInsightsPeriod) => {
    if (!firebaseUser) return;
    setAdsLoading(true);
    setAdsError(null);
    try {
      const response = await request<InstagramAdsReport>(`/api/integrations/instagram/insights?section=ads&period=${period}`, {
        fallbackError: "Não foi possível carregar os dados de anúncios.",
      });
      setAdsReport(response);
    } catch (cause) {
      setAdsError(cause instanceof Error ? cause.message : "Não foi possível carregar os dados de anúncios.");
    } finally {
      setAdsLoading(false);
    }
  }, [firebaseUser, request]);

  const loadContentPage = useCallback(async (period: InstagramInsightsPeriod, after: string | null = null) => {
    if (!firebaseUser) return;
    setContentLoading(true);
    setContentError(null);
    try {
      const query = new URLSearchParams({ section: "content", period: String(period) });
      if (after) query.set("after", after);
      const response = await request<InstagramInsightsContentPage>(`/api/integrations/instagram/insights?${query.toString()}`, {
        fallbackError: "Não foi possível carregar as publicações do Instagram.",
      });
      setContentPage((current) => (after && current?.period === period
        ? { ...response, items: [...current.items, ...response.items] }
        : response));
    } catch (cause) {
      setContentError(cause instanceof Error ? cause.message : "Não foi possível carregar as publicações do Instagram.");
    } finally {
      setContentLoading(false);
    }
  }, [firebaseUser, request]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const requested = search.get("view");
    if (requested && validViews.has(requested as InstagramWorkspaceView)) {
      setActiveView(requested as InstagramWorkspaceView);
    }
    const requestedSection = search.get("section");
    if (requestedSection && validInsightsSections.has(requestedSection as InstagramInsightsSection)) {
      setInsightsSection(requestedSection as InstagramInsightsSection);
    }
    setEditingId(search.get("post"));
  }, []);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login?next=%2Finstagram-programacao");
      return;
    }
    if (!authLoading && firebaseUser) void loadSchedule();
  }, [authLoading, firebaseUser, isAuthenticated, loadSchedule, router]);

  useEffect(() => {
    if (activeView === "media" && firebaseUser && !libraryLoaded && !libraryLoading) {
      void loadLibrary();
    }
  }, [activeView, firebaseUser, libraryLoaded, libraryLoading, loadLibrary]);

  useEffect(() => {
    if (activeView === "feed" && firebaseUser && !publishedLoaded && !publishedLoading) {
      void loadPublishedFeed();
    }
  }, [activeView, firebaseUser, loadPublishedFeed, publishedLoaded, publishedLoading]);

  useEffect(() => {
    if (activeView === "reports" && firebaseUser) {
      void loadInsights(insightsPeriod);
    }
  }, [activeView, firebaseUser, insightsPeriod, loadInsights]);

  useEffect(() => {
    if (!authLoading && activeView === "bio" && !canManageBio) selectView("calendar");
    // selectView atualiza apenas estado e URL; esperar o bootstrap de permissões evita piscar conteúdo restrito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, authLoading, canManageBio]);

  useEffect(() => {
    if (createDate && firebaseUser && !publishedLoaded && !publishedLoading) {
      void loadPublishedFeed();
    }
  }, [createDate, firebaseUser, loadPublishedFeed, publishedLoaded, publishedLoading]);

  function selectView(view: InstagramWorkspaceView, section?: InstagramInsightsSection) {
    setActiveView(view);
    const nextSection = view === "reports" ? section ?? "overview" : "overview";
    setInsightsSection(nextSection);
    setEditingId(null);
    setMobileOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    if (view === "reports" && nextSection !== "overview") url.searchParams.set("section", nextSection);
    else url.searchParams.delete("section");
    url.searchParams.delete("post");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function openEditor(item: InstagramScheduleListItem) {
    setEditingId(item.id);
    const url = new URL(window.location.href);
    url.searchParams.set("view", activeView);
    url.searchParams.set("post", item.id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function closeEditor() {
    setEditingId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("post");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  async function mutateSchedule(
    id: string,
    body:
      | { scheduledAt?: string; mediaOrder?: number[] }
      | { swapWithId: string }
      | { cancel: true }
      | { pause: true }
      | { hide: true }
      | { resume: true; scheduledAt?: string },
  ) {
    setError(null);
    await request(`/api/integrations/instagram/schedule/${encodeURIComponent(id)}`, {
      method: "PATCH",
      json: body,
      fallbackError: "Não foi possível alterar o agendamento.",
    });
    await loadSchedule();
  }

  async function reschedule(id: string, scheduledAt: string) {
    try {
      await mutateSchedule(id, { scheduledAt });
      say("Data e horário atualizados com segurança.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível alterar o agendamento.");
      return false;
    }
  }

  async function updateSchedule(
    id: string,
    changes: { scheduledAt?: string; mediaOrder?: number[] },
  ) {
    try {
      await mutateSchedule(id, changes);
      say(changes.mediaOrder
        ? "Ordem dos Stories e agendamento atualizados."
        : "Data e horário atualizados com segurança.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível alterar o agendamento.");
      return false;
    }
  }

  async function cancelSchedule(id: string) {
    try {
      await mutateSchedule(id, { cancel: true });
      say("Agendamento cancelado. A publicação não será enviada ao Instagram.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível cancelar o agendamento.");
      return false;
    }
  }

  async function pauseSchedule(id: string) {
    try {
      await mutateSchedule(id, { pause: true });
      say("Publicação pausada. Ela não será enviada até você programar de novo.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível pausar a publicação.");
      return false;
    }
  }

  async function resumeSchedule(id: string, scheduledAt?: string) {
    try {
      await mutateSchedule(id, scheduledAt ? { resume: true, scheduledAt } : { resume: true });
      say("Publicação programada novamente.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível programar a publicação.");
      return false;
    }
  }

  async function hideSchedule(id: string) {
    try {
      await mutateSchedule(id, { hide: true });
      if (editingId === id) closeEditor();
      say("Removida da grade. O registro foi mantido.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível remover da grade.");
      return false;
    }
  }

  async function deleteSchedule(id: string) {
    setError(null);
    try {
      await request(`/api/integrations/instagram/schedule/${encodeURIComponent(id)}`, {
        method: "DELETE",
        fallbackError: "Não foi possível excluir a publicação.",
      });
      if (editingId === id) closeEditor();
      await loadSchedule();
      say("Publicação excluída.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a publicação.");
      return false;
    }
  }

  async function swapSchedules(id: string, swapWithId: string) {
    try {
      await mutateSchedule(id, { swapWithId });
      say("As datas das publicações foram trocadas.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível trocar as datas.");
    }
  }

  async function libraryMutation(
    run: () => Promise<unknown>,
    options: { message: string; fallbackError: string; reloadFolders?: boolean; reloadItems?: boolean },
  ) {
    setError(null);
    try {
      await run();
      await Promise.all([
        options.reloadFolders === false ? Promise.resolve() : loadFolders(),
        options.reloadItems ? loadFolderItems(libraryFolderId) : Promise.resolve(),
      ]);
      say(options.message);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : options.fallbackError);
      return false;
    }
  }

  function openLibraryFolder(folderId: string | null) {
    setLibraryFolderId(folderId);
    setLibraryItems([]);
    setLibraryCursor(null);
    void loadFolderItems(folderId);
  }

  function createLibraryFolder(name: string, parentId: string | null) {
    return libraryMutation(
      () => request("/api/integrations/instagram/media/folders", {
        method: "POST",
        json: { name, parentId },
        fallbackError: "Não foi possível criar a pasta.",
      }),
      { message: "Pasta criada.", fallbackError: "Não foi possível criar a pasta." },
    );
  }

  function updateLibraryFolder(id: string, changes: { name?: string; parentId?: string | null }, message: string) {
    return libraryMutation(
      () => request(`/api/integrations/instagram/media/folders/${encodeURIComponent(id)}`, {
        method: "PATCH",
        json: changes,
        fallbackError: "Não foi possível alterar a pasta.",
      }),
      { message, fallbackError: "Não foi possível alterar a pasta." },
    );
  }

  async function deleteLibraryFolder(id: string) {
    const parentId = libraryFolders.find((folder) => folder.id === id)?.parentId ?? null;
    const deleted = await libraryMutation(
      () => request(`/api/integrations/instagram/media/folders/${encodeURIComponent(id)}`, {
        method: "DELETE",
        fallbackError: "Não foi possível excluir a pasta.",
      }),
      { message: "Pasta excluída. O conteúdo subiu para a pasta de cima.", fallbackError: "Não foi possível excluir a pasta." },
    );
    if (deleted && libraryFolderId === id) openLibraryFolder(parentId);
    return deleted;
  }

  function moveLibraryMedia(ids: string[], folderId: string | null) {
    return libraryMutation(
      () => request("/api/integrations/instagram/media/move", {
        method: "POST",
        json: { ids, folderId },
        fallbackError: "Não foi possível mover os arquivos.",
      }),
      {
        message: ids.length === 1 ? "Arquivo movido." : `${ids.length} arquivos movidos.`,
        fallbackError: "Não foi possível mover os arquivos.",
        reloadFolders: false,
        reloadItems: true,
      },
    );
  }

  async function uploadFiles(files: File[], folderId: string | null) {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    let completed = 0;
    try {
      for (const file of files) {
        const form = new FormData();
        form.set("file", file);
        if (folderId) form.set("folderId", folderId);
        await request("/api/integrations/instagram/media", {
          method: "POST",
          body: form,
          fallbackError: `Não foi possível enviar ${file.name}.`,
        });
        completed += 1;
      }
      await loadFolderItems(libraryFolderId);
      say(completed === 1 ? "Arquivo adicionado à biblioteca." : `${completed} arquivos adicionados à biblioteca.`);
    } catch (cause) {
      if (completed > 0) await loadFolderItems(libraryFolderId);
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir o upload.");
    } finally {
      setUploading(false);
    }
  }

  async function createSchedule(input: CreateInstagramScheduleInput) {
    setCreating(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("format", input.format);
      form.set("scheduledAt", input.scheduledAt);
      form.set("caption", input.caption);
      form.set("shareToFeed", String(input.shareToFeed));
      form.set("storyMentions", JSON.stringify(input.storyMentions));
      if (input.location) {
        form.set("locationId", input.location.id);
        form.set("locationName", input.location.name);
      }
      input.files.forEach((file) => form.append("media", file));
      await request("/api/integrations/instagram/schedule", {
        method: "POST",
        body: form,
        fallbackError: "Não foi possível criar o agendamento.",
      });
      await loadSchedule();
      setCreateDate(null);
      say(input.format === "story" && input.files.length > 1
        ? `Sequência com ${input.files.length} Stories agendada.`
        : "Publicação agendada.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o agendamento.");
      return false;
    } finally {
      setCreating(false);
    }
  }

  if (authLoading || (!isAuthenticated && scheduleLoading)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FAF5EF] text-[#7A5646]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
        Carregando acesso…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen bg-[#FAF5EF] font-sans text-[#4A1A04]">
      <InstagramWorkspaceSidebar
        activeView={activeView}
        activeInsightsSection={insightsSection}
        email={firebaseUser?.email}
        canManageBio={canManageBio}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onSelect={selectView}
        onCreate={() => setCreateDate(dateKeyInBelem(new Date()))}
        onFutureFeature={(label) => say(`${label} será implementado em uma próxima etapa.`)}
        onLogout={() => void logout()}
      />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-[#EADFD3] bg-[#F4ECE2] px-4 py-2.5 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-lg border border-[#EADFD3] bg-white"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="relative h-9 w-20 overflow-hidden" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/instagram/coala-logo.png" alt="" className="absolute left-[-14px] top-[-37px] h-auto w-[108px] max-w-none" />
          </div>
          <span className="text-[12px] font-bold text-[#7A5646]">Programação Instagram</span>
        </div>

        {error && (
          <div role="alert" className="flex items-center justify-between gap-4 border-b border-[#E8B9B3] bg-[#FBE4E1] px-4 py-2.5 text-[13px] font-semibold text-[#A52E24] md:px-7">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="shrink-0 underline">Fechar</button>
          </div>
        )}

        {editingId && schedules.find((item) => item.id === editingId) ? (
          <SchedulePostEditor
            item={schedules.find((item) => item.id === editingId)!}
            onClose={closeEditor}
            onUpdate={updateSchedule}
            onCancel={cancelSchedule}
          />
        ) : activeView === "calendar" ? (
          <CalendarView
            items={schedules}
            loading={scheduleLoading}
            onRefresh={() => void loadSchedule()}
            onCreate={setCreateDate}
            onOpen={openEditor}
            actions={{
              onReschedule: reschedule,
              onPause: pauseSchedule,
              onResume: resumeSchedule,
              onCancel: cancelSchedule,
              onHide: hideSchedule,
              onDelete: deleteSchedule,
            }}
          />
        ) : activeView === "feed" ? (
          <FeedGridView
            items={schedules}
            publishedItems={publishedItems}
            profile={instagramProfile}
            liveLoading={publishedLoading}
            liveError={publishedError}
            onRefreshLive={() => void loadPublishedFeed()}
            onSwap={swapSchedules}
            onOpen={openEditor}
          />
        ) : activeView === "media" ? (
          <MediaLibraryView
            folders={libraryFolders}
            currentFolderId={libraryFolderId}
            libraryItems={libraryItems}
            hasMore={libraryCursor !== null}
            schedules={schedules}
            loading={libraryLoading}
            uploading={uploading}
            onOpenFolder={openLibraryFolder}
            onLoadMore={() => void loadFolderItems(libraryFolderId, libraryCursor)}
            onUpload={uploadFiles}
            onCreateFolder={createLibraryFolder}
            onRenameFolder={(id, name) => updateLibraryFolder(id, { name }, "Pasta renomeada.")}
            onMoveFolder={(id, parentId) => updateLibraryFolder(id, { parentId }, "Pasta movida.")}
            onDeleteFolder={deleteLibraryFolder}
            onMoveMedia={moveLibraryMedia}
            onFutureFeature={(label) => say(`${label} será implementado em uma próxima etapa.`)}
          />
        ) : activeView === "bio" && canManageBio ? (
          <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-7 md:py-7">
            <header className="mb-6">
              <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[#D90F6F]">Relacionar</p>
              <h1 className="mt-1 text-2xl font-black text-[#4A1A04] md:text-3xl">Link na bio</h1>
              <p className="mt-1 text-sm text-[#7A5646]">Edite, visualize e publique a página oficial sem sair da programação do Instagram.</p>
            </header>
            <PublicBioSettings />
          </div>
        ) : activeView === "reports" ? (
          <InsightsView
            report={insights}
            period={insightsPeriod}
            section={insightsSection}
            loading={insightsLoading}
            error={insightsError}
            audience={audienceReport}
            audienceLoading={audienceLoading}
            audienceError={audienceError}
            ads={adsReport}
            adsLoading={adsLoading}
            adsError={adsError}
            contentPage={contentPage}
            contentLoading={contentLoading}
            contentError={contentError}
            onPeriodChange={setInsightsPeriod}
            onSectionChange={(section) => {
              setInsightsSection(section);
              const url = new URL(window.location.href);
              url.searchParams.set("view", "reports");
              if (section === "overview") url.searchParams.delete("section");
              else url.searchParams.set("section", section);
              window.history.replaceState(null, "", `${url.pathname}${url.search}`);
            }}
            onRefresh={() => void loadInsights(insightsPeriod)}
            onLoadAudience={() => void loadAudience()}
            onLoadAds={() => void loadAds(insightsPeriod)}
            onLoadContent={(after) => void loadContentPage(insightsPeriod, after)}
          />
        ) : null}
      </div>

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[90] max-w-[90vw] -translate-x-1/2 rounded-[10px] bg-[#4A1A04] px-4 py-2.5 text-[13px] font-bold text-white shadow-2xl">
          {toast}
        </div>
      )}

      {createDate && (
        <CreateScheduleDialog
          initialDate={createDate}
          busy={creating}
          schedules={schedules}
          publishedItems={publishedItems}
          publishedLoading={publishedLoading}
          publishedError={publishedError}
          onClose={() => !creating && setCreateDate(null)}
          onCreate={createSchedule}
        />
      )}
    </main>
  );
}
