"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ControlSearch } from "@/components/patterns/control-panel";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { PanelSwitchRow } from "@/components/patterns/panel-form";
import { SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { HeroChip, PulseHero } from "@/features/instagram-scheduler/hero-panel";
import { ProtectedMedia } from "@/features/instagram-scheduler/protected-media";
import { PostPhonePreview, PostPhoneThumb } from "./post-phone-preview";
import {
  OBJECTIVE_LABELS,
  fullyApproved,
  POST_STEPS,
  STEP_LABELS,
  approvalBlocked,
  approvalChecklist,
  fromBelemInput,
  initialStep,
  planningChangedAfterApproval,
  planningComplete,
  planningWarnings,
  stepDone,
  stepUnlocked,
  toBelemInput,
  type PostStep,
} from "./planning-model";
import { instagramPostObjectives } from "./contracts";

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
  /** Abre a tela de Relatórios, onde o desempenho do post publicado é medido. */
  onOpenReports: () => void;
};

const selectClass = cn(fieldInputClass, "appearance-auto");
const textareaClass = cn(fieldInputClass, "h-auto py-2.5");

function statusVariant(post: InstagramEditorialPost): StatusPillVariant {
  if (post.status === "published") return "ok";
  if (post.status === "scheduled") return "info";
  if (post.status === "produced") return approvalValid(post, "contentApproval") && approvalValid(post, "publicationApproval") ? "ok" : "warn";
  return "neutral";
}

function approvalValid(post: InstagramEditorialPost, field: "contentApproval" | "publicationApproval") {
  const value = post[field];
  return value?.status === "approved" && value.artifactSha256 === post.contentHash;
}

function displayStatus(post: InstagramEditorialPost) {
  if (post.status === "produced" && !approvalValid(post, "contentApproval")) return "Aguardando aprovação";
  if (post.status === "produced" && !approvalValid(post, "publicationApproval")) return "Conteúdo aprovado";
  return statusLabels[post.status];
}

const STAGES = ["Planejado", "Produzido", "Aprovado", "Agendado", "Publicado"] as const;

/** Etapa atual do post na linha do tempo: aprovado só quando conteúdo e publicação têm aprovação válida da versão atual. */
function stageIndex(post: InstagramEditorialPost) {
  if (post.status === "published") return 4;
  if (post.status === "scheduled") return 3;
  if (post.status === "produced") return approvalValid(post, "contentApproval") && approvalValid(post, "publicationApproval") ? 2 : 1;
  return 0;
}

function StageTrack({ post }: { post: InstagramEditorialPost }) {
  const current = stageIndex(post);
  return (
    <div role="img" aria-label={`Etapa ${current + 1} de ${STAGES.length}: ${STAGES[current]}`} className="mt-2.5">
      <div className="flex items-center gap-1">
        {STAGES.map((stage, position) => (
          <span key={stage} className="flex flex-1 items-center gap-1 last:flex-none">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full border-2", position < current ? "border-ds-ok bg-ds-ok" : position === current ? "border-ds-accent-ink bg-white" : "border-ds-border-input bg-white")} />
            {position < STAGES.length - 1 && <span className={cn("h-0.5 flex-1 rounded", position < current ? "bg-ds-ok" : "bg-ds-border")} />}
          </span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-3 text-[9.5px] font-bold uppercase tracking-[0.06em]">
        <span className={current === 0 ? "text-ds-accent-ink" : "text-ds-ink-faint"}>{STAGES[0]}</span>
        <span className="text-center text-ds-accent-ink">{current >= 1 && current <= 3 ? STAGES[current] : ""}</span>
        <span className={cn("text-right", current === 4 ? "text-ds-accent-ink" : "text-ds-ink-faint")}>{STAGES[4]}</span>
      </div>
    </div>
  );
}

function scheduleLabel(post: InstagramEditorialPost) {
  if (post.publicationResult?.publishedAt) return `Publicado em ${new Date(post.publicationResult.publishedAt).toLocaleString("pt-BR", { timeZone: "America/Belem", dateStyle: "short", timeStyle: "short" })}`;
  if (post.schedule?.at) return `${post.schedule.mode === "manual" ? "Lembrete" : "Agendado"} para ${new Date(post.schedule.at).toLocaleString("pt-BR", { timeZone: "America/Belem", dateStyle: "short", timeStyle: "short" })}`;
  return "Sem data definida";
}

function localDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function ActionPanel({ post, onAction, only, blocked = false }: {
  post: InstagramEditorialPost;
  onAction: EditorialPostsViewProps["onAction"];
  /** Etapa que mostra os botões: aprovação, publicação (agendar e publicar) ou resultado (cancelar). */
  only: "approval" | "publication" | "result";
  /** Pendência obrigatória do checklist: bloqueia as aprovações. */
  blocked?: boolean;
}) {
  const [action, setAction] = useState<InstagramPostActionInput["action"] | null>(null);
  const [scheduledAt, setScheduledAt] = useState(localDateTime(post.schedule?.at ?? post.planning.plannedAt));
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
    const actionTitle: Record<InstagramPostActionInput["action"], string> = {
      approve_content: "Aprovar conteúdo",
      approve_publication: "Aprovar publicação",
      schedule: "Agendar",
      publish: "Publicar agora",
      cancel: "Cancelar agendamento",
    };
    return (
      <div className="space-y-4 rounded-ds-card-lg border border-ds-alert-border bg-ds-alert-bg p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-ds-alert-ink">Confirmação explícita · {actionTitle[action]}</h3>
            <p className="mt-1 text-xs text-ds-alert-ink">A autorização vale somente para este post e esta versão.</p>
          </div>
          <Button type="button" variant="ds-secondary" size="xs" onClick={() => setAction(null)} aria-label="Fechar confirmação">Fechar</Button>
        </div>
        {action === "schedule" && (
          <Field label="Data e horário" htmlFor="post-action-at">
            <input id="post-action-at" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className={fieldInputClass} />
          </Field>
        )}
        <Field label="Motivo da autorização" htmlFor="post-action-statement" hint="Mínimo de 8 caracteres.">
          <input id="post-action-statement" value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="Ex.: campanha conferida e aprovada" className={fieldInputClass} />
        </Field>
        <Field label="Digite exatamente" htmlFor="post-action-confirmation" error={confirmation && confirmation !== expected ? "O texto ainda não confere." : null}>
          <code className="mb-2 block overflow-x-auto rounded-ds-btn bg-ds-dark px-3 py-2 font-ds-mono text-[11px] text-white">{expected || "Escolha a data"}</code>
          <input id="post-action-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-invalid={Boolean(confirmation && confirmation !== expected)} className={cn(fieldInputClass, "font-ds-mono text-xs")} />
        </Field>
        <Button type="button" variant={action === "cancel" ? "danger" : "primary-modal"} size="md" loading={busy} loadingLabel="Executando…" disabled={!expected || statement.trim().length < 8 || confirmation !== expected} onClick={() => void submit()}>
          Executar ação autorizada
        </Button>
      </div>
    );
  }

  const certified = post.publicationReadiness.status === "certified";
  const contentApproved = approvalValid(post, "contentApproval");
  const publicationApproved = approvalValid(post, "publicationApproval");
  return (
    <div className="flex flex-wrap gap-2">
      {only === "approval" && post.status === "produced" && !contentApproved && (
        <Button type="button" variant="primary-modal" size="md" disabled={!certified || blocked} onClick={() => setAction("approve_content")}>Aprovar conteúdo</Button>
      )}
      {only === "approval" && post.status === "produced" && contentApproved && !publicationApproved && (
        <Button type="button" variant="primary-modal" size="md" disabled={blocked} onClick={() => setAction("approve_publication")}>Aprovar publicação</Button>
      )}
      {only === "publication" && post.status === "produced" && publicationApproved && (
        <>
          <Button type="button" variant="primary-modal" size="md" disabled={!certified} onClick={() => setAction("schedule")}>Agendar</Button>
          <Button type="button" variant="ds-secondary" size="md" disabled={!certified || post.publicationMode === "manual"} onClick={() => setAction("publish")}>Publicar agora</Button>
        </>
      )}
      {only === "result" && post.status === "scheduled" && (
        <Button type="button" variant="danger-link" size="md" onClick={() => setAction("cancel")}>Cancelar agendamento</Button>
      )}
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3 border-b border-ds-divider pb-1.5">
        <h3 className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">{title}</h3>
        {hint ? <span className="text-[11px] text-ds-ink-faint">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Stepper({ post, step, onStep }: { post: InstagramEditorialPost; step: PostStep; onStep: (step: PostStep) => void }) {
  const lockedReason: Record<PostStep, string> = {
    planning: "",
    approval: "Libera depois de concluir o planejamento.",
    publication: "Libera depois das aprovações de conteúdo e de publicação.",
    result: "Libera depois de agendar ou publicar.",
  };
  return (
    <nav aria-label="Etapas do post" className="grid grid-cols-4 gap-2">
      {POST_STEPS.map((item, index) => {
        const unlocked = stepUnlocked(post, item);
        const done = stepDone(post, item);
        const current = item === step;
        return (
          <button
            key={item}
            type="button"
            aria-current={current ? "step" : undefined}
            disabled={!unlocked}
            title={unlocked ? undefined : lockedReason[item]}
            onClick={() => onStep(item)}
            className={cn(
              "flex items-center gap-2 rounded-ds-btn-lg border px-3 py-2 text-left text-[12.5px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink",
              current ? "border-ds-accent-ink bg-ds-accent-row text-ds-ink" : unlocked ? "border-ds-border bg-white text-ds-ink-2 hover:bg-ds-muted" : "cursor-not-allowed border-ds-border bg-ds-muted text-ds-ink-faint",
            )}
          >
            <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full font-ds-mono text-[11px]", done ? "bg-ds-ok text-white" : current ? "bg-ds-accent-ink text-white" : "bg-ds-border text-ds-ink-muted")}>
              {done ? "✓" : unlocked ? index + 1 : "🔒"}
            </span>
            <span className="leading-tight">{STEP_LABELS[item]}</span>
          </button>
        );
      })}
    </nav>
  );
}

function PostDrawer({ post, others, onUpdate, onUpload, onAction, onOpenReports }: {
  post: InstagramEditorialPost;
  others: InstagramEditorialPost[];
  onUpdate: EditorialPostsViewProps["onUpdate"];
  onUpload: EditorialPostsViewProps["onUpload"];
  onAction: EditorialPostsViewProps["onAction"];
  onOpenReports: () => void;
}) {
  const fromPost = (source: InstagramEditorialPost) => ({
    direction: source.direction,
    caption: source.caption,
    manualInstructions: source.manualInstructions,
    publicationMode: source.publicationMode,
    designRationale: source.planning.designRationale,
    formatRationale: source.planning.formatRationale,
    objective: source.planning.objective,
    callToAction: source.planning.callToAction,
    plannedAt: toBelemInput(source.planning.plannedAt),
  });
  const [form, setForm] = useState(() => fromPost(post));
  const [step, setStep] = useState<PostStep>(() => initialStep(post));
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const advanceAfterProduced = useRef(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const editable = post.status === "planned" || post.status === "produced";
  const patch = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    setForm(fromPost(post));
  // Resincroniza só quando o servidor devolve outra versão do post.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.version, post.updatedAt]);

  useEffect(() => {
    if (advanceAfterProduced.current && post.status === "produced") {
      advanceAfterProduced.current = false;
      setStep("approval");
    }
  }, [post.status]);

  useEffect(() => {
    // Depois de agendar ou publicar, o painel segue para o Resultado.
    if (post.status === "scheduled" || post.status === "published") setStep((current) => (current === "publication" ? "result" : current));
  }, [post.status]);

  const plannedIso = fromBelemInput(form.plannedAt);
  const dirty = JSON.stringify(form) !== JSON.stringify(fromPost(post));
  const certified = post.publicationReadiness.status === "certified";
  const warnings = planningWarnings({ postId: post.id, format: post.format, plannedAt: plannedIso, others });
  const draft: InstagramEditorialPost = {
    ...post,
    caption: form.caption,
    direction: form.direction,
    publicationMode: form.publicationMode,
    planning: { ...post.planning, designRationale: form.designRationale, formatRationale: form.formatRationale, objective: form.objective, callToAction: form.callToAction, plannedAt: plannedIso },
  };
  const missing = [
    !certified ? "mídia certificada" : null,
    !form.direction.trim() ? "direcionamento" : null,
    post.format !== "story" && !form.caption.trim() ? "legenda" : null,
    !planningComplete(form) ? "os dois motivos (mínimo de 20 caracteres)" : null,
  ].filter((item): item is string => item !== null);
  const checklist = approvalChecklist(draft);

  async function save(status?: "planned" | "produced") {
    setBusy(true);
    setSaveError(null);
    const saved = await onUpdate(post.id, {
      direction: form.direction,
      caption: form.caption,
      manualInstructions: form.manualInstructions,
      publicationMode: form.publicationMode,
      planning: {
        designRationale: form.designRationale,
        formatRationale: form.formatRationale,
        objective: form.objective,
        callToAction: form.callToAction,
        plannedAt: plannedIso,
      },
      ...(status ? { status } : {}),
    });
    if (status === "produced" && saved) advanceAfterProduced.current = true;
    if (!saved) setSaveError("Não foi possível salvar. Confira a mensagem no topo da tela.");
    setBusy(false);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    await onUpload(post.id, Array.from(files));
    setBusy(false);
    if (uploadRef.current) uploadRef.current.value = "";
  }

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill variant={statusVariant(post)}>{displayStatus(post)}</StatusPill>
      <StatusPill variant={post.media.length === 0 ? "neutral" : certified ? "ok" : "danger"}>
        {post.media.length === 0 ? "Sem mídia" : certified ? "Mídia certificada" : "Mídia incompatível"}
      </StatusPill>
      {(post.schedule?.at || post.publicationResult?.publishedAt) && <StatusPill variant="info">{scheduleLabel(post)}</StatusPill>}
      <span className="ml-auto max-w-[45%] truncate font-ds-mono text-[10.5px] text-ds-ink-faint" title={post.folderPath}>▤ {post.folderPath}</span>
    </div>
  );

  const planningStep = (
    <div className="space-y-4">
      <Block title="O quê" hint="Conteúdo e mídia">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {post.media.map((item) => (
            <div key={item.id} className="w-[64px] shrink-0 overflow-hidden rounded-ds-btn border border-ds-border bg-white" title={item.fileName}>
              <div className="aspect-[4/5]"><ProtectedMedia url={item.previewUrl} alt={item.fileName} kind={item.kind} previewVideo /></div>
            </div>
          ))}
          {editable && post.media.length < 10 && (
            <label className="flex aspect-[4/5] w-[64px] shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-ds-btn border-2 border-dashed border-ds-border-input bg-white text-center text-[10px] font-bold text-ds-ink-muted transition-colors hover:border-ds-accent hover:text-ds-accent-ink focus-within:ring-2 focus-within:ring-ds-accent-ink">
              <span aria-hidden="true" className="text-base leading-none">+</span> Arte
              <input ref={uploadRef} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" className="sr-only" onChange={(event) => void upload(event.target.files)} />
            </label>
          )}
          {post.publicationReadiness.issues.length > 0 && (
            <ul role="alert" className="min-w-[220px] flex-1 list-disc space-y-0.5 rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg py-2 pl-6 pr-3 text-[11px] text-ds-confirm-ink">
              {post.publicationReadiness.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}
            </ul>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Legenda" htmlFor="post-caption">
            <textarea id="post-caption" disabled={!editable} value={form.caption} onChange={(event) => patch("caption", event.target.value)} rows={3} className={cn(textareaClass, "disabled:bg-ds-muted")} />
          </Field>
          <Field label="Direcionamento" htmlFor="post-direction">
            <textarea id="post-direction" disabled={!editable} value={form.direction} onChange={(event) => patch("direction", event.target.value)} rows={3} className={cn(textareaClass, "disabled:bg-ds-muted")} />
          </Field>
        </div>
      </Block>

      <Block title="Por quê" hint="Mínimo de 20 caracteres em cada um">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Motivo da arte e do design" htmlFor="post-design-why" error={editable && form.designRationale.trim() && form.designRationale.trim().length < 20 ? "Explique um pouco mais." : null}>
            <textarea id="post-design-why" disabled={!editable} value={form.designRationale} onChange={(event) => patch("designRationale", event.target.value)} rows={3} placeholder="Ex.: cores da campanha de outubro para reforçar o Dia das Crianças." className={cn(textareaClass, "disabled:bg-ds-muted")} />
          </Field>
          <Field label={`Motivo do formato (${formatLabels[post.format]})`} htmlFor="post-format-why" error={editable && form.formatRationale.trim() && form.formatRationale.trim().length < 20 ? "Explique um pouco mais." : null}>
            <textarea id="post-format-why" disabled={!editable} value={form.formatRationale} onChange={(event) => patch("formatRationale", event.target.value)} rows={3} placeholder="Ex.: Story, porque a oferta vale só hoje e precisa de urgência." className={cn(textareaClass, "disabled:bg-ds-muted")} />
          </Field>
        </div>
      </Block>

      <Block title="Quando" hint="Estratégia de publicação">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
          <Field label="Data e hora alvo" htmlFor="post-planned-at">
            <input id="post-planned-at" type="datetime-local" disabled={!editable} value={form.plannedAt} onChange={(event) => patch("plannedAt", event.target.value)} className={fieldInputClass} />
          </Field>
          <Field label="Objetivo" htmlFor="post-objective">
            <select id="post-objective" disabled={!editable} value={form.objective ?? ""} onChange={(event) => patch("objective", (event.target.value || null) as typeof form.objective)} className={selectClass}>
              <option value="">Não definido</option>
              {instagramPostObjectives.map((value) => <option key={value} value={value}>{OBJECTIVE_LABELS[value]}</option>)}
            </select>
          </Field>
          <Field label="Chamada para ação" htmlFor="post-cta">
            <input id="post-cta" disabled={!editable} value={form.callToAction} maxLength={200} onChange={(event) => patch("callToAction", event.target.value)} placeholder="Ex.: Peça no delivery" className={fieldInputClass} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Publicação" htmlFor="post-mode">
            <select id="post-mode" disabled={!editable} value={form.publicationMode} onChange={(event) => patch("publicationMode", event.target.value as "automatic" | "manual")} className={selectClass}>
              <option value="automatic">Automática pelo sistema</option>
              <option value="manual">Manual com lembrete</option>
            </select>
          </Field>
          {form.publicationMode === "manual" && (
            <Field label="Instruções do lembrete" htmlFor="post-instructions">
              <input id="post-instructions" disabled={!editable} value={form.manualInstructions} onChange={(event) => patch("manualInstructions", event.target.value)} className={fieldInputClass} />
            </Field>
          )}
        </div>
        {warnings.length > 0 && (
          <ul role="status" className="space-y-0.5 rounded-ds-btn border border-ds-alert-border bg-ds-alert-bg px-3 py-2 text-[11.5px] font-semibold text-ds-alert-ink">
            {warnings.map((warning) => <li key={warning.id}>⚠ {warning.message}</li>)}
          </ul>
        )}
      </Block>

      {post.status === "produced" && (
        <p className="rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2 text-[11.5px] text-ds-ink-muted">
          Alterar legenda, mídia, formato ou publicação invalida as aprovações desta versão. Alterar só os motivos e a estratégia apenas sinaliza a mudança na Aprovação.
        </p>
      )}
      {saveError && <p role="alert" className="text-xs font-semibold text-ds-danger">{saveError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <Button type="button" variant="ds-secondary" size="md" disabled={busy || !dirty} onClick={() => void save()}>Salvar</Button>
        )}
        {post.status === "planned" && (
          <Button type="button" variant="primary-modal" size="md" loading={busy} disabled={missing.length > 0} onClick={() => void save("produced")}>Concluir planejamento</Button>
        )}
        {post.status === "produced" && (
          <Button type="button" variant="primary-modal" size="md" disabled={busy || dirty} onClick={() => setStep("approval")}>Ir para a aprovação →</Button>
        )}
      </div>
      {post.status === "planned" && missing.length > 0 && (
        <p className="text-[11.5px] text-ds-ink-muted">Para concluir falta: {missing.join(", ")}.</p>
      )}
    </div>
  );

  const approvalStep = (
    <div className="space-y-4">
      <Block title="Checklist" hint="Os obrigatórios bloqueiam a aprovação">
        <ul className="space-y-1.5">
          {checklist.map((item) => (
            <li key={item.id} className="flex items-center gap-2.5 text-[13px]">
              <span aria-hidden="true" className={cn("grid h-5 w-5 place-items-center rounded-full text-[11px] font-extrabold text-white", item.ok ? "bg-ds-ok" : item.required ? "bg-ds-danger" : "bg-ds-warn")}>{item.ok ? "✓" : item.required ? "!" : "·"}</span>
              <span className={item.ok ? "text-ds-ink-2" : "font-bold"}>{item.label}</span>
              {!item.ok && <span className="text-[11px] text-ds-ink-faint">{item.required ? "obrigatório" : "recomendado"}</span>}
            </li>
          ))}
        </ul>
      </Block>
      {planningChangedAfterApproval(post) && (
        <p role="status" className="rounded-ds-btn border border-ds-alert-border bg-ds-alert-bg px-3 py-2 text-[12px] font-semibold text-ds-alert-ink">O planejamento (motivos ou estratégia) foi alterado depois da aprovação do conteúdo. Releia antes de aprovar a publicação.</p>
      )}
      <Block title="Resumo para quem aprova">
        <dl className="grid gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-2">
          <div><dt className="text-[11px] font-bold text-ds-ink-faint">Formato</dt><dd>{formatLabels[post.format]}</dd></div>
          <div><dt className="text-[11px] font-bold text-ds-ink-faint">Objetivo</dt><dd>{post.planning.objective ? OBJECTIVE_LABELS[post.planning.objective] : "Não definido"}</dd></div>
          <div><dt className="text-[11px] font-bold text-ds-ink-faint">Data e hora alvo</dt><dd>{post.planning.plannedAt ? new Date(post.planning.plannedAt).toLocaleString("pt-BR", { timeZone: "America/Belem", dateStyle: "short", timeStyle: "short" }) : "Não definida"}</dd></div>
          <div><dt className="text-[11px] font-bold text-ds-ink-faint">Chamada para ação</dt><dd>{post.planning.callToAction || "Nenhuma"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-[11px] font-bold text-ds-ink-faint">Motivo da arte e do design</dt><dd className="whitespace-pre-wrap">{post.planning.designRationale || "—"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-[11px] font-bold text-ds-ink-faint">Motivo do formato</dt><dd className="whitespace-pre-wrap">{post.planning.formatRationale || "—"}</dd></div>
        </dl>
      </Block>
      {fullyApproved(post) ? (
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill variant="ok">Conteúdo e publicação aprovados para esta versão</StatusPill>
          <Button type="button" variant="primary-modal" size="md" onClick={() => setStep("publication")}>Ir para a publicação →</Button>
        </div>
      ) : (
        <ActionPanel key={`${post.id}-${post.contentHash}-approval`} post={post} onAction={onAction} only="approval" blocked={approvalBlocked(checklist)} />
      )}
    </div>
  );

  const publicationStep = (
    <div className="space-y-4">
      <Block title="Antes de publicar">
        <dl className="grid gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-2">
          <div><dt className="text-[11px] font-bold text-ds-ink-faint">Modo</dt><dd>{post.publicationMode === "manual" ? "Manual com lembrete" : "Automática pelo sistema"}</dd></div>
          <div><dt className="text-[11px] font-bold text-ds-ink-faint">Data e hora alvo</dt><dd>{post.planning.plannedAt ? new Date(post.planning.plannedAt).toLocaleString("pt-BR", { timeZone: "America/Belem", dateStyle: "short", timeStyle: "short" }) : "Não definida (informe ao agendar)"}</dd></div>
          <div><dt className="text-[11px] font-bold text-ds-ink-faint">Mídia</dt><dd>{certified ? "Certificada para o formato" : "Incompatível"}</dd></div>
          <div><dt className="text-[11px] font-bold text-ds-ink-faint">Aprovações</dt><dd>{fullyApproved(post) ? "Válidas para esta versão" : "Pendentes"}</dd></div>
          {post.publicationMode === "manual" && <div className="sm:col-span-2"><dt className="text-[11px] font-bold text-ds-ink-faint">Instruções do lembrete</dt><dd>{post.manualInstructions || "—"}</dd></div>}
        </dl>
      </Block>
      {post.status === "produced" ? (
        <ActionPanel key={`${post.id}-${post.contentHash}-publication`} post={post} onAction={onAction} only="publication" />
      ) : (
        <StatusPill variant="info">{scheduleLabel(post)}</StatusPill>
      )}
    </div>
  );

  const resultStep = (
    <div className="space-y-4">
      <Block title="Situação">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill variant={statusVariant(post)}>{displayStatus(post)}</StatusPill>
          <span className="text-[13px] font-bold text-ds-ink-2">{scheduleLabel(post)}</span>
        </div>
        {post.manualReminder?.status === "due" && (
          <div role="alert" className="rounded-ds-btn border border-ds-alert-border bg-ds-alert-bg p-3 text-sm text-ds-alert-ink">
            <div className="font-extrabold">Hora de publicar este Story manualmente.</div>
            <p className="mt-0.5 text-xs">{post.manualReminder.instructions || "Abra o Instagram, aplique as figurinhas interativas e publique."}</p>
          </div>
        )}
        {post.publicationResult?.permalink && (
          <a href={post.publicationResult.permalink} target="_blank" rel="noreferrer" className="inline-block text-sm font-extrabold text-ds-accent-ink underline underline-offset-2">Ver publicação oficial ↗</a>
        )}
      </Block>
      <Block title="O que se esperava" hint="Para comparar com o resultado">
        <dl className="grid gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-2">
          <div><dt className="text-[11px] font-bold text-ds-ink-faint">Objetivo</dt><dd>{post.planning.objective ? OBJECTIVE_LABELS[post.planning.objective] : "Não definido"}</dd></div>
          <div><dt className="text-[11px] font-bold text-ds-ink-faint">Chamada para ação</dt><dd>{post.planning.callToAction || "Nenhuma"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-[11px] font-bold text-ds-ink-faint">Por que este formato</dt><dd className="whitespace-pre-wrap">{post.planning.formatRationale || "—"}</dd></div>
        </dl>
      </Block>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ds-secondary" size="md" onClick={onOpenReports}>Ver desempenho nos Relatórios</Button>
        <ActionPanel key={`${post.id}-${post.contentHash}-result`} post={post} onAction={onAction} only="result" />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Stepper post={post} step={step} onStep={setStep} />
      {header}
      {step === "planning" ? planningStep : step === "approval" ? approvalStep : step === "publication" ? publicationStep : resultStep}
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
    if (!title.trim()) return;
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
    <SidePanel
      open
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      kicker="Sistema primeiro"
      title="Novo post Planejado"
      subtitle="Nasce como Planejado; a mídia e as aprovações vêm depois."
      className="w-[520px]"
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-1 flex-col gap-5" noValidate>
        <Field label="Título" htmlFor="new-post-title" hint="Até 120 caracteres.">
          <input id="new-post-title" required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} className={fieldInputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Formato" htmlFor="new-post-format">
            <select id="new-post-format" value={format} onChange={(event) => setFormat(event.target.value as InstagramPostCreateInput["format"])} className={selectClass}>
              <option value="feed_image">Feed</option><option value="carousel">Carrossel</option><option value="reel">Reel</option><option value="story">Story</option>
            </select>
          </Field>
          <Field label="Onde fica" htmlFor="new-post-placement">
            <select id="new-post-placement" value={placement} onChange={(event) => setPlacement(event.target.value as "editorial" | "campaign")} className={selectClass}>
              <option value="editorial">Editorial</option><option value="campaign">Campanha</option>
            </select>
          </Field>
        </div>
        {placement === "campaign" && (
          <Field label="Caminho da campanha" htmlFor="new-post-campaign">
            <input id="new-post-campaign" required value={campaignPath} onChange={(event) => setCampaignPath(event.target.value)} className={cn(fieldInputClass, "font-ds-mono text-xs")} />
          </Field>
        )}
        <Field label="Direcionamento" htmlFor="new-post-direction" requirement="opcional">
          <textarea id="new-post-direction" value={direction} onChange={(event) => setDirection(event.target.value)} rows={5} className={textareaClass} />
        </Field>
        <Field label="Legenda" htmlFor="new-post-caption" requirement="opcional">
          <textarea id="new-post-caption" value={caption} onChange={(event) => setCaption(event.target.value)} rows={5} className={textareaClass} />
        </Field>
        <PanelSwitchRow id="new-post-manual" label="Story com figurinha" description="Depende de figurinha interativa e será publicado manualmente, com lembrete." checked={manual} onChange={setManual} />
        <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
          <Button type="button" variant="ds-secondary" size="md" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary-modal" size="md" loading={busy} disabled={!title.trim()}>Criar no sistema</Button>
        </div>
      </form>
    </SidePanel>
  );
}

type PostFilter = "all" | "awaiting" | InstagramEditorialPost["status"];

export function EditorialPostsView(props: EditorialPostsViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<PostFilter>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const awaiting = (post: InstagramEditorialPost) => post.status === "produced" && !(approvalValid(post, "contentApproval") && approvalValid(post, "publicationApproval"));
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return props.posts.filter((post) => {
      if (filter === "awaiting" ? !awaiting(post) : filter !== "all" && post.status !== filter) return false;
      return !term || `${post.title} ${post.folderPath}`.toLocaleLowerCase("pt-BR").includes(term);
    });
  }, [props.posts, filter, query]);
  const selected = props.posts.find((post) => post.id === selectedId) ?? null;
  const selectedPosition = selected ? visible.findIndex((post) => post.id === selected.id) : -1;
  const stepTo = (offset: -1 | 1) => {
    const target = visible[selectedPosition + offset];
    if (target) setSelectedId(target.id);
  };
  const count = (status: InstagramEditorialPost["status"]) => props.posts.filter((post) => post.status === status).length;
  const toggle = (next: PostFilter) => setFilter((current) => (current === next ? "all" : next));

  useEffect(() => {
    if (selectedId && !props.posts.some((post) => post.id === selectedId)) setSelectedId(null);
  }, [props.posts, selectedId]);

  useEffect(() => {
    if (props.createRequested) setCreating(true);
  }, [props.createRequested]);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-5 bg-ds-warm px-4 py-5 font-ds text-ds-ink md:px-7" aria-labelledby="instagram-posts-title">
      <PulseHero
        kicker="Fonte oficial"
        title="Posts e aprovações"
        titleId="instagram-posts-title"
        subtitle="Planejamento, produção, aprovação, agendamento e resultado no mesmo registro."
        actions={(
          <>
            <Button type="button" variant="on-dark-secondary" size="xl" onClick={props.onRefresh} disabled={props.loading}>{props.loading ? "Atualizando…" : "Atualizar"}</Button>
            <Button type="button" variant="primary-page" size="xl" onClick={() => setCreating(true)} className="whitespace-nowrap">+ Novo post</Button>
          </>
        )}
        compactActions={<Button type="button" variant="primary-page" size="md" onClick={() => setCreating(true)} className="whitespace-nowrap">+ Novo post</Button>}
        search={<ControlSearch value={query} onChange={setQuery} placeholder="Buscar por título ou pasta" />}
        chips={(
          <>
            <HeroChip value={count("planned")} label="Planejados" active={filter === "planned"} onClick={() => toggle("planned")} />
            <HeroChip value={props.posts.filter(awaiting).length} label="Aguardando aprovação" tone="warning" active={filter === "awaiting"} onClick={() => toggle("awaiting")} />
            <HeroChip value={count("scheduled")} label="Programados" tone="info" active={filter === "scheduled"} onClick={() => toggle("scheduled")} />
            <HeroChip value={count("published")} label="Publicados" active={filter === "published"} onClick={() => toggle("published")} />
          </>
        )}
      />

      <div className="grid min-h-0 gap-5">
        <div className="grid gap-3 2xl:grid-cols-2" role="list" aria-label="Posts">
          {props.loading && <div role="status" className="rounded-ds-btn-lg border border-ds-border bg-ds-surface p-4 text-sm text-ds-ink-muted">Carregando posts…</div>}
          {!props.loading && visible.length === 0 && <div className="rounded-ds-card-lg border border-dashed border-ds-border-input p-6 text-center text-sm text-ds-ink-muted">Nenhum post com esses filtros.</div>}
          {visible.map((post) => (
            <button
              key={post.id}
              type="button"
              role="listitem"
              aria-current={selected?.id === post.id ? "true" : undefined}
              onClick={() => setSelectedId(post.id)}
              className={cn(
                "relative flex w-full gap-3.5 rounded-ds-card border p-3.5 text-left transition-[transform,box-shadow,background] duration-150 hover:z-10 hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(21,21,28,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                selected?.id === post.id ? "z-[1] border-ds-accent-ink bg-ds-accent-row ring-1 ring-ds-accent-ink" : "border-ds-border bg-ds-surface"
              )}
            >
              <PostPhoneThumb post={post} width={92} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-[15px] font-extrabold leading-tight">{post.title}</span>
                  <span className="shrink-0 rounded-full bg-ds-muted px-2 py-0.5 text-[10px] font-extrabold text-ds-ink-2">{formatLabels[post.format]}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <StatusPill variant={statusVariant(post)}>{displayStatus(post)}</StatusPill>
                  <StatusPill variant={post.media.length === 0 ? "neutral" : post.publicationReadiness.status === "certified" ? "ok" : "danger"}>
                    {post.media.length === 0 ? "Sem mídia" : post.publicationReadiness.status === "certified" ? "Mídia certificada" : "Mídia incompatível"}
                  </StatusPill>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-snug text-ds-ink-muted">{post.caption || post.direction || "Sem legenda nem direcionamento."}</p>
                <StageTrack post={post} />
                <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-bold text-ds-ink-2">{scheduleLabel(post)}</span>
                  {post.media.length > 1 && <span className="text-ds-ink-faint">{post.media.length} mídias</span>}
                </div>
                <div className="mt-1 truncate font-ds-mono text-[10px] text-ds-ink-faint" title={post.folderPath}>{post.folderPath}</div>
              </div>
            </button>
          ))}
        </div>
        <SidePanel
          open={Boolean(selected)}
          onOpenChange={(open) => { if (!open) setSelectedId(null); }}
          kicker={selected ? `${formatLabels[selected.format]} · ${selectedPosition + 1} de ${visible.length}` : "Post"}
          title={selected?.title ?? ""}
          subtitle="Editor, aprovações e prévia no celular."
          compact
          className="w-[1040px]"
        >
          {selected ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <Button type="button" variant="ds-secondary" size="xs" disabled={selectedPosition <= 0} onClick={() => stepTo(-1)}>‹ Anterior</Button>
                <span className="text-[11px] font-bold text-ds-ink-faint">{selectedPosition + 1} / {visible.length}</span>
                <Button type="button" variant="ds-secondary" size="xs" disabled={selectedPosition < 0 || selectedPosition >= visible.length - 1} onClick={() => stepTo(1)}>Próximo ›</Button>
              </div>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
                <PostDrawer key={selected.id} post={selected} others={props.posts} onUpdate={props.onUpdate} onUpload={props.onUpload} onAction={props.onAction} onOpenReports={props.onOpenReports} />
                <aside aria-label="Prévia no celular" className="order-first lg:order-none lg:sticky lg:top-0 lg:self-start">
                  <p className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Prévia · {formatLabels[selected.format]}</p>
                  <PostPhonePreview key={selected.id} post={selected} scale={0.8} />
                </aside>
              </div>
            </>
          ) : null}
        </SidePanel>
      </div>
      {creating && <CreatePostDialog onClose={() => setCreating(false)} onCreate={props.onCreate} />}
    </section>
  );
}
