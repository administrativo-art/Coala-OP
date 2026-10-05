"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileUp,
  FolderTree,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";

import { ProtectedMedia } from "@/features/instagram-scheduler/protected-media";

import type {
  InstagramEditorialPost,
  InstagramPostActionInput,
  InstagramPostCreateInput,
  InstagramPostUpdateInput,
} from "./contracts";

const statusLabels = {
  planned: "Planejado",
  produced: "Produzido",
  scheduled: "Programado",
  published: "Publicado",
} as const;

const formatLabels = {
  feed_image: "Feed",
  carousel: "Carrossel",
  reel: "Reel",
  story: "Story",
} as const;

type EditorialPostsViewProps = {
  posts: InstagramEditorialPost[];
  loading: boolean;
  createRequested?: number;
  onRefresh: () => void;
  onCreate: (input: Omit<InstagramPostCreateInput, "clientMutationId">) => Promise<boolean>;
  onUpdate: (id: string, changes: InstagramPostUpdateInput) => Promise<boolean>;
  onUpload: (id: string, files: File[]) => Promise<boolean>;
  onAction: (id: string, input: InstagramPostActionInput) => Promise<boolean>;
};

function approvalValid(post: InstagramEditorialPost, field: "contentApproval" | "publicationApproval") {
  const value = post[field];
  return value?.status === "approved" && value.artifactSha256 === post.contentHash;
}

function displayStatus(post: InstagramEditorialPost) {
  if (post.status === "produced" && !approvalValid(post, "contentApproval")) return "Aguardando aprovação";
  if (post.status === "produced" && !approvalValid(post, "publicationApproval")) return "Conteúdo aprovado";
  return statusLabels[post.status];
}

function localDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function ActionPanel({ post, onAction }: {
  post: InstagramEditorialPost;
  onAction: EditorialPostsViewProps["onAction"];
}) {
  const [action, setAction] = useState<InstagramPostActionInput["action"] | null>(null);
  const [scheduledAt, setScheduledAt] = useState(localDateTime(post.schedule?.at));
  const [statement, setStatement] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  const expected = useMemo(() => {
    if (!action) return "";
    if (action === "approve_content") return `APPROVE-CONTENT:${post.id}:${post.contentHash}`;
    if (action === "approve_publication") return `APPROVE-PUBLICATION:${post.id}:${post.contentHash}`;
    if (action === "publish") return `PUBLISH:${post.id}:${post.contentHash}`;
    if (action === "cancel") return `CANCEL:${post.id}`;
    if (!scheduledAt) return "";
    return `SCHEDULE:${post.id}:${post.contentHash}:${new Date(scheduledAt).toISOString()}`;
  }, [action, post.contentHash, post.id, scheduledAt]);

  async function submit() {
    if (!action || statement.trim().length < 8 || confirmation !== expected) return;
    setBusy(true);
    const authorization = { statement: statement.trim(), confirmation };
    const input: InstagramPostActionInput = action === "schedule"
      ? { action, scheduledAt: new Date(scheduledAt).toISOString(), timezone: "America/Belem", authorization }
      : { action, authorization };
    const completed = await onAction(post.id, input);
    setBusy(false);
    if (completed) {
      setAction(null);
      setStatement("");
      setConfirmation("");
    }
  }

  if (action) {
    return (
      <div className="rounded-xl border border-[#E4C8B8] bg-[#FFF9F4] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-[#4A1A04]">Confirmação explícita</h3>
            <p className="mt-1 text-xs text-[#7A5646]">A autorização vale somente para este post e esta versão.</p>
          </div>
          <button type="button" onClick={() => setAction(null)} aria-label="Fechar confirmação"><X className="h-4 w-4" /></button>
        </div>
        {action === "schedule" && (
          <label className="mt-3 block text-xs font-bold text-[#5E3A28]">
            Data e horário em Belém
            <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#D9C8B6] bg-white px-3 py-2 text-sm" />
          </label>
        )}
        <label className="mt-3 block text-xs font-bold text-[#5E3A28]">
          Motivo da autorização
          <input value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="Ex.: campanha conferida e aprovada"
            className="mt-1 w-full rounded-lg border border-[#D9C8B6] bg-white px-3 py-2 text-sm" />
        </label>
        <label className="mt-3 block text-xs font-bold text-[#5E3A28]">
          Digite exatamente
          <code className="mt-1 block overflow-x-auto rounded-lg bg-[#4A1A04] px-3 py-2 text-[11px] text-white">{expected || "Escolha a data"}</code>
          <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
            className="mt-2 w-full rounded-lg border border-[#D9C8B6] bg-white px-3 py-2 font-mono text-xs" />
        </label>
        <button type="button" disabled={busy || !expected || statement.trim().length < 8 || confirmation !== expected}
          onClick={() => void submit()}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#4A1A04] px-3 py-2 text-xs font-extrabold text-white disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Executar ação autorizada
        </button>
      </div>
    );
  }

  const certified = post.publicationReadiness.status === "certified";
  const contentApproved = approvalValid(post, "contentApproval");
  const publicationApproved = approvalValid(post, "publicationApproval");
  return (
    <div className="flex flex-wrap gap-2">
      {post.status === "produced" && !contentApproved && (
        <button type="button" disabled={!certified} onClick={() => setAction("approve_content")} className="rounded-lg bg-[#F462A7] px-3 py-2 text-xs font-extrabold disabled:opacity-40">Aprovar conteúdo</button>
      )}
      {post.status === "produced" && contentApproved && !publicationApproved && (
        <button type="button" onClick={() => setAction("approve_publication")} className="rounded-lg bg-[#F462A7] px-3 py-2 text-xs font-extrabold">Aprovar publicação</button>
      )}
      {post.status === "produced" && publicationApproved && (
        <>
          <button type="button" disabled={!certified} onClick={() => setAction("schedule")} className="rounded-lg bg-[#4A1A04] px-3 py-2 text-xs font-extrabold text-white disabled:opacity-40">Agendar</button>
          <button type="button" disabled={!certified || post.publicationMode === "manual"} onClick={() => setAction("publish")} className="rounded-lg border border-[#4A1A04] px-3 py-2 text-xs font-extrabold disabled:opacity-40">Publicar agora</button>
        </>
      )}
      {post.status === "scheduled" && (
        <button type="button" onClick={() => setAction("cancel")} className="rounded-lg border border-[#B33A2E] px-3 py-2 text-xs font-extrabold text-[#A52E24]">Cancelar agendamento</button>
      )}
    </div>
  );
}

function PostEditor({ post, onUpdate, onUpload, onAction }: {
  post: InstagramEditorialPost;
  onUpdate: EditorialPostsViewProps["onUpdate"];
  onUpload: EditorialPostsViewProps["onUpload"];
  onAction: EditorialPostsViewProps["onAction"];
}) {
  const [direction, setDirection] = useState(post.direction);
  const [caption, setCaption] = useState(post.caption);
  const [manualInstructions, setManualInstructions] = useState(post.manualInstructions);
  const [publicationMode, setPublicationMode] = useState(post.publicationMode);
  const [busy, setBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const editable = post.status === "planned" || post.status === "produced";

  useEffect(() => {
    setDirection(post.direction);
    setCaption(post.caption);
    setManualInstructions(post.manualInstructions);
    setPublicationMode(post.publicationMode);
  }, [post]);

  async function save(status?: "planned" | "produced") {
    setBusy(true);
    await onUpdate(post.id, { direction, caption, manualInstructions, publicationMode, ...(status ? { status } : {}) });
    setBusy(false);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    await onUpload(post.id, Array.from(files));
    setBusy(false);
    if (uploadRef.current) uploadRef.current.value = "";
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#D90F6F]">{formatLabels[post.format]} · {displayStatus(post)}</p>
          <h2 className="mt-1 text-2xl font-black text-[#4A1A04]">{post.title}</h2>
          <div className="mt-2 flex items-center gap-2 text-xs text-[#7A5646]"><FolderTree className="h-4 w-4" /><span className="break-all">{post.folderPath}</span></div>
        </div>
        <button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg border border-[#D9C8B6] bg-white px-3 py-2 text-xs font-extrabold disabled:opacity-40">Salvar alterações</button>
      </div>

      <div className={`rounded-xl border p-4 ${post.publicationReadiness.status === "certified" ? "border-[#A9D4B5] bg-[#EFF9F1]" : "border-[#E8B9B3] bg-[#FFF0ED]"}`}>
        <div className="flex items-center gap-2 text-sm font-black">
          {post.publicationReadiness.status === "certified" ? <CheckCircle2 className="h-5 w-5 text-[#247A3D]" /> : <CircleAlert className="h-5 w-5 text-[#A52E24]" />}
          {post.publicationReadiness.status === "certified" ? "Mídia certificada para o formato" : "Mídia ainda incompatível"}
        </div>
        {post.publicationReadiness.issues.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[#7A3028]">
            {post.publicationReadiness.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {post.media.map((item) => (
          <div key={item.id} className="overflow-hidden rounded-xl border border-[#EADFD3] bg-white">
            <div className="aspect-[4/5]"><ProtectedMedia url={item.previewUrl} alt={item.fileName} kind={item.kind} previewVideo /></div>
            <div className="truncate px-2 py-1.5 text-[11px] font-semibold text-[#5E3A28]">{item.fileName}</div>
          </div>
        ))}
        {editable && post.media.length < 10 && (
          <label className="flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#D9C8B6] bg-white text-center text-xs font-bold text-[#7A5646]">
            <FileUp className="h-6 w-6" /> Enviar arte
            <input ref={uploadRef} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" className="sr-only" onChange={(event) => void upload(event.target.files)} />
          </label>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="text-xs font-bold text-[#5E3A28]">Direcionamento
          <textarea disabled={!editable} value={direction} onChange={(event) => setDirection(event.target.value)} rows={7} className="mt-1 w-full rounded-xl border border-[#D9C8B6] bg-white px-3 py-2 text-sm disabled:bg-[#F4ECE2]" />
        </label>
        <label className="text-xs font-bold text-[#5E3A28]">Legenda
          <textarea disabled={!editable} value={caption} onChange={(event) => setCaption(event.target.value)} rows={7} className="mt-1 w-full rounded-xl border border-[#D9C8B6] bg-white px-3 py-2 text-sm disabled:bg-[#F4ECE2]" />
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="text-xs font-bold text-[#5E3A28]">Publicação
          <select disabled={!editable} value={publicationMode} onChange={(event) => setPublicationMode(event.target.value as "automatic" | "manual")} className="mt-1 w-full rounded-lg border border-[#D9C8B6] bg-white px-3 py-2 text-sm">
            <option value="automatic">Automática pelo sistema</option>
            <option value="manual">Manual com lembrete</option>
          </select>
        </label>
        {publicationMode === "manual" && (
          <label className="text-xs font-bold text-[#5E3A28]">Instruções do lembrete
            <input disabled={!editable} value={manualInstructions} onChange={(event) => setManualInstructions(event.target.value)} className="mt-1 w-full rounded-lg border border-[#D9C8B6] bg-white px-3 py-2 text-sm" />
          </label>
        )}
      </div>

      {post.schedule?.at && (
        <div className="flex items-center gap-2 rounded-xl border border-[#C7D8EC] bg-[#F0F6FC] p-3 text-sm font-bold text-[#254B73]">
          <CalendarClock className="h-5 w-5" /> {post.schedule.mode === "manual" ? "Lembrete" : "Publicação"} em {new Date(post.schedule.at).toLocaleString("pt-BR", { timeZone: "America/Belem" })}
        </div>
      )}
      {post.manualReminder?.status === "due" && (
        <div role="alert" className="rounded-xl border border-[#F0C56E] bg-[#FFF7D9] p-4 text-sm text-[#6D4B00]">
          <div className="flex items-center gap-2 font-black"><CircleAlert className="h-5 w-5" />Hora de publicar este Story manualmente.</div>
          <p className="mt-1 text-xs">{post.manualReminder.instructions || "Abra o Instagram, aplique as figurinhas interativas e publique."}</p>
        </div>
      )}
      {post.publicationResult?.permalink && (
        <a href={post.publicationResult.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-extrabold text-[#D90F6F]">Ver publicação oficial <ExternalLink className="h-4 w-4" /></a>
      )}

      {editable && post.status === "planned" && (
        <button type="button" disabled={busy || post.publicationReadiness.status !== "certified"} onClick={() => void save("produced")}
          className="inline-flex items-center gap-2 rounded-lg bg-[#4A1A04] px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-40">
          <Send className="h-4 w-4" /> Marcar como Produzido
        </button>
      )}
      <ActionPanel post={post} onAction={onAction} />
    </div>
  );
}

function CreatePostDialog({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: EditorialPostsViewProps["onCreate"];
}) {
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<InstagramPostCreateInput["format"]>("feed_image");
  const [placement, setPlacement] = useState<"editorial" | "campaign">("editorial");
  const [campaignPath, setCampaignPath] = useState("03 - Campanhas/02 - Ativo/");
  const [direction, setDirection] = useState("");
  const [caption, setCaption] = useState("");
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const completed = await onCreate({
      title,
      format,
      status: "planned",
      placement: placement === "campaign" ? { kind: "campaign", campaignPath } : { kind: "editorial" },
      direction,
      caption,
      shareToFeed: true,
      storyMentions: [],
      publicationMode: manual ? "manual" : "automatic",
      manualInstructions: manual ? "Publicar manualmente no Instagram e conferir as figurinhas interativas." : "",
    });
    setBusy(false);
    if (completed) onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[#4A1A04]/40 p-4" role="dialog" aria-modal="true" aria-label="Criar post">
      <form onSubmit={(event) => void submit(event)} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-[#FAF5EF] p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-extrabold uppercase text-[#D90F6F]">Sistema primeiro</p><h2 className="text-2xl font-black">Novo post Planejado</h2></div><button type="button" onClick={onClose}><X className="h-5 w-5" /></button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-bold">Título<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-[#D9C8B6] bg-white px-3 py-2 text-sm" /></label>
          <label className="text-xs font-bold">Formato<select value={format} onChange={(event) => setFormat(event.target.value as InstagramPostCreateInput["format"])} className="mt-1 w-full rounded-lg border border-[#D9C8B6] bg-white px-3 py-2 text-sm"><option value="feed_image">Feed</option><option value="carousel">Carrossel</option><option value="reel">Reel</option><option value="story">Story</option></select></label>
          <label className="text-xs font-bold">Onde fica<select value={placement} onChange={(event) => setPlacement(event.target.value as "editorial" | "campaign")} className="mt-1 w-full rounded-lg border border-[#D9C8B6] bg-white px-3 py-2 text-sm"><option value="editorial">Editorial</option><option value="campaign">Campanha</option></select></label>
          {placement === "campaign" && <label className="text-xs font-bold">Caminho da campanha<input required value={campaignPath} onChange={(event) => setCampaignPath(event.target.value)} className="mt-1 w-full rounded-lg border border-[#D9C8B6] bg-white px-3 py-2 text-sm" /></label>}
        </div>
        <label className="mt-4 block text-xs font-bold">Direcionamento<textarea value={direction} onChange={(event) => setDirection(event.target.value)} rows={5} className="mt-1 w-full rounded-lg border border-[#D9C8B6] bg-white px-3 py-2 text-sm" /></label>
        <label className="mt-4 block text-xs font-bold">Legenda<textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={5} className="mt-1 w-full rounded-lg border border-[#D9C8B6] bg-white px-3 py-2 text-sm" /></label>
        <label className="mt-4 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={manual} onChange={(event) => setManual(event.target.checked)} /> Story depende de figurinha e será manual</label>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-[#D9C8B6] px-4 py-2 text-sm font-bold">Cancelar</button><button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#F462A7] px-4 py-2 text-sm font-extrabold disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Criar no sistema</button></div>
      </form>
    </div>
  );
}

export function EditorialPostsView(props: EditorialPostsViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | InstagramEditorialPost["status"]>("all");
  const [creating, setCreating] = useState(false);
  const visible = status === "all" ? props.posts : props.posts.filter((post) => post.status === status);
  const selected = props.posts.find((post) => post.id === selectedId) ?? visible[0] ?? null;

  useEffect(() => {
    if (selectedId && !props.posts.some((post) => post.id === selectedId)) setSelectedId(null);
  }, [props.posts, selectedId]);

  useEffect(() => {
    if (props.createRequested) setCreating(true);
  }, [props.createRequested]);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 md:px-7 md:py-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[#D90F6F]">Fonte oficial</p><h1 className="mt-1 text-3xl font-black">Posts editoriais</h1><p className="mt-1 text-sm text-[#7A5646]">Planejamento, produção, aprovação, agendamento e resultado no mesmo registro.</p></div>
        <div className="flex gap-2"><button type="button" onClick={props.onRefresh} className="inline-flex items-center gap-2 rounded-lg border border-[#D9C8B6] bg-white px-3 py-2 text-xs font-extrabold"><RefreshCw className="h-4 w-4" />Atualizar</button><button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#F462A7] px-3 py-2 text-xs font-extrabold"><Plus className="h-4 w-4" />Novo post</button></div>
      </header>
      <div className="mt-5 flex flex-wrap gap-2">{(["all", "planned", "produced", "scheduled", "published"] as const).map((item) => <button key={item} onClick={() => setStatus(item)} className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${status === item ? "bg-[#4A1A04] text-white" : "bg-white text-[#5E3A28]"}`}>{item === "all" ? "Todos" : statusLabels[item]} ({item === "all" ? props.posts.length : props.posts.filter((post) => post.status === item).length})</button>)}</div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="max-h-[calc(100vh-220px)] space-y-2 overflow-y-auto pr-1">
          {props.loading && <div className="flex items-center gap-2 rounded-xl bg-white p-4 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Carregando posts…</div>}
          {!props.loading && visible.length === 0 && <div className="rounded-xl border border-dashed border-[#D9C8B6] bg-white p-6 text-center text-sm text-[#7A5646]">Nenhum post neste estado.</div>}
          {visible.map((post) => <button key={post.id} type="button" onClick={() => setSelectedId(post.id)} className={`w-full rounded-xl border p-3 text-left ${selected?.id === post.id ? "border-[#F462A7] bg-[#FFF1F7]" : "border-[#EADFD3] bg-white"}`}><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-black">{post.title}</span><span className="shrink-0 rounded-full bg-[#F4ECE2] px-2 py-1 text-[10px] font-extrabold">{formatLabels[post.format]}</span></div><div className="mt-1 text-xs font-bold text-[#D90F6F]">{displayStatus(post)}</div><div className="mt-2 truncate text-[10px] text-[#7A5646]">{post.folderPath}</div></button>)}
        </div>
        <section className="min-w-0 rounded-2xl border border-[#EADFD3] bg-white p-4 md:p-6">{selected ? <PostEditor key={selected.id} post={selected} onUpdate={props.onUpdate} onUpload={props.onUpload} onAction={props.onAction} /> : <div className="grid min-h-80 place-items-center text-sm text-[#7A5646]">Crie o primeiro post no sistema.</div>}</section>
      </div>
      {creating && <CreatePostDialog onClose={() => setCreating(false)} onCreate={props.onCreate} />}
    </div>
  );
}
