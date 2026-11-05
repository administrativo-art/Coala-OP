"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { LiftRow } from "@/components/patterns/lift-row";
import { Segmented } from "@/components/patterns/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

import {
  archiveEditorTemplate,
  listEditorTemplates,
  publishEditorTemplate,
  toEditorFailure,
  createDocumentFromTemplate,
  type EditorTemplateStatus,
  type EditorTemplateView,
} from "./editor-client";
import {
  DEFAULT_TEMPLATE_FILTER,
  TEMPLATE_LIST_PAGE_SIZE,
  TEMPLATE_STATUS_FILTERS,
  TEMPLATE_STATUS_LABEL,
  TEMPLATE_STATUS_VARIANT,
  appendTemplatePage,
  applyTemplateUpdate,
  createAttemptRegistry,
  getArchiveBlockReason,
  getPublishListBlockReason,
  getUseTemplateBlockReason,
  hasUnpublishedChanges,
  shouldReloadTemplateList,
  templateArchiveAttemptKey,
  templatePublishAttemptKey,
  templateUseAttemptKey,
} from "./template-logic";

type RowAction = "use" | "publish" | "archive";
type ListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: EditorTemplateView[]; nextCursor: string | null };

const EMPTY_TEXT: Record<EditorTemplateStatus, string> = {
  published: "Nenhum modelo publicado. Crie um modelo e peça a quem revisa documentos para publicá-lo.",
  draft: "Nenhum modelo em rascunho.",
  archived: "Nenhum modelo arquivado.",
};

function Panel({ title, tone = "neutral", children }: { title: string; tone?: "neutral" | "danger"; children?: React.ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={
        tone === "danger"
          ? "rounded-ds-card border border-ds-confirm-border bg-ds-confirm-bg px-5 py-6 text-ds-confirm-ink"
          : "rounded-ds-card border border-ds-border bg-ds-surface px-5 py-6 text-ds-ink"
      }
    >
      <p className="text-sm font-extrabold">{title}</p>
      {children ? <div className="mt-1.5 text-[13px]">{children}</div> : null}
    </div>
  );
}

/**
 * Lista de modelos do editor. Cada leitura é uma página de no máximo 25 modelos por cursor (sem
 * polling nem listener): carregar = 1 chamada ao abrir/trocar filtro, +1 por "Carregar mais".
 */
export function EditorTemplatesList() {
  const router = useRouter();
  const request = useAuthenticatedApi();
  const { permissions, isDefaultAdmin, loading: authLoading } = useAuth();
  const canGenerate = hasFormalizationPermission(permissions, "documents.generate", isDefaultAdmin);
  const canReview = hasFormalizationPermission(permissions, "documents.review", isDefaultAdmin);
  const [filter, setFilter] = useState<EditorTemplateStatus>(DEFAULT_TEMPLATE_FILTER);
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ templateId: string; text: string; tone: "ok" | "error" } | null>(null);
  const [pending, setPending] = useState<{ id: string; action: RowAction } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: "publish" | "archive" } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const attempts = useRef(createAttemptRegistry(() => crypto.randomUUID()));
  const loadToken = useRef(0);
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  });

  const reload = useCallback(() => {
    setState({ kind: "loading" });
    setMoreError(null);
    setConfirm(null);
    setReloadKey((key) => key + 1);
  }, []);

  function changeFilter(next: EditorTemplateStatus) {
    if (next === filter) return;
    setState({ kind: "loading" });
    setMoreError(null);
    setConfirm(null);
    setFilter(next);
  }

  useEffect(() => {
    if (authLoading || !canGenerate) return;
    const token = ++loadToken.current;
    listEditorTemplates(requestRef.current, { status: filter, limit: TEMPLATE_LIST_PAGE_SIZE })
      .then((page) => {
        if (token === loadToken.current) setState({ kind: "ready", items: page.items, nextCursor: page.nextCursor });
      })
      .catch((error: unknown) => {
        if (token === loadToken.current) setState({ kind: "error", message: toEditorFailure(error).message });
      });
    return () => {
      loadToken.current += 1;
    };
  }, [filter, reloadKey, authLoading, canGenerate]);

  async function loadMore() {
    if (state.kind !== "ready" || !state.nextCursor || loadingMore) return;
    const token = loadToken.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await listEditorTemplates(request, { status: filter, limit: TEMPLATE_LIST_PAGE_SIZE, cursor: state.nextCursor });
      if (token !== loadToken.current) return;
      setState((current) =>
        current.kind === "ready"
          ? { kind: "ready", items: appendTemplatePage(current.items, page.items), nextCursor: page.nextCursor }
          : current,
      );
    } catch (error) {
      if (token === loadToken.current) setMoreError(toEditorFailure(error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function run(template: EditorTemplateView, action: RowAction) {
    if (pending) return;
    setNotice(null);
    setPending({ id: template.id, action });
    const key =
      action === "use"
        ? templateUseAttemptKey(template.id, template.publishedVersion)
        : action === "publish"
          ? templatePublishAttemptKey(template.id, template.currentVersion)
          : templateArchiveAttemptKey(template.id, template.currentVersion);
    const clientRequestId = attempts.current.idFor(key);
    try {
      if (action === "use") {
        const { document } = await createDocumentFromTemplate(request, template.id, {
          clientRequestId,
          ...(template.publishedVersion !== null ? { expectedPublishedVersion: template.publishedVersion } : {}),
        });
        attempts.current.clear(key);
        router.push(`/dashboard/documents/editor/${encodeURIComponent(document.id)}`);
        return;
      }
      const call = action === "publish" ? publishEditorTemplate : archiveEditorTemplate;
      const { template: updated } = await call(request, template.id, { clientRequestId, expectedVersion: template.currentVersion });
      attempts.current.clear(key);
      setState((current) =>
        current.kind === "ready" ? { ...current, items: applyTemplateUpdate(current.items, updated, filter) } : current,
      );
      setConfirm(null);
      setNotice({
        templateId: updated.id,
        text: action === "publish" ? `Modelo "${updated.name}" publicado na versão ${updated.publishedVersion}.` : `Modelo "${updated.name}" arquivado.`,
        tone: "ok",
      });
      setPending(null);
    } catch (error) {
      const failure = toEditorFailure(error);
      setConfirm(null);
      setNotice({ templateId: template.id, text: failure.message, tone: "error" });
      setPending(null);
      if (shouldReloadTemplateList(failure)) reload();
    }
  }

  if (authLoading) return <Skeleton className="h-40 w-full" />;
  if (!canGenerate) {
    return (
      <Panel title="Sem permissão para os modelos do editor" tone="danger">
        Você precisa da permissão de gerar documentos para ver e usar os modelos.
      </Panel>
    );
  }

  const items = state.kind === "ready" ? state.items : [];
  // O aviso fica na linha; se a linha saiu da lista (ex.: arquivado no filtro "Publicados"), vai para o topo.
  const orphanNotice = notice && !items.some((item) => item.id === notice.templateId) ? notice : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          aria-label="Filtrar modelos por situação"
          value={filter}
          onChange={changeFilter}
          options={TEMPLATE_STATUS_FILTERS.map((option) => ({ value: option.value, label: option.label }))}
        />
        <Button asChild type="button" variant="ds-secondary" size="md">
          <Link href="/dashboard/documents/editor">Criar documento ou modelo</Link>
        </Button>
      </div>

      {orphanNotice ? (
        <p role={orphanNotice.tone === "error" ? "alert" : "status"} className={orphanNotice.tone === "error" ? "text-[13px] font-semibold text-ds-danger" : "text-[13px] font-semibold text-ds-ok"}>
          {orphanNotice.text}
        </p>
      ) : null}

      {state.kind === "loading" ? (
        <div role="status" aria-label="Carregando os modelos" className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : state.kind === "error" ? (
        <Panel title="Não foi possível carregar os modelos" tone="danger">
          <p>{state.message}</p>
          <Button type="button" variant="ds-secondary" size="xs" className="mt-3" onClick={reload}>
            Tentar novamente
          </Button>
        </Panel>
      ) : items.length === 0 ? (
        <p role="status" className="rounded-ds-card border border-dashed border-ds-border-input px-5 py-8 text-center text-[13px] text-ds-ink-muted">
          {EMPTY_TEXT[filter]}
        </p>
      ) : (
        <div role="list" aria-label="Modelos" className="rounded-ds-card border border-ds-border bg-ds-surface">
          {items.map((template) => (
            <TemplateRow
              key={template.id}
              template={template}
              canGenerate={canGenerate}
              canReview={canReview}
              pendingAction={pending?.id === template.id ? pending.action : null}
              anyPending={pending !== null}
              confirming={confirm?.id === template.id ? confirm.action : null}
              notice={notice?.templateId === template.id ? notice : null}
              onUse={() => void run(template, "use")}
              onAsk={(action) => setConfirm({ id: template.id, action })}
              onCancel={() => setConfirm(null)}
              onConfirm={(action) => void run(template, action)}
            />
          ))}
        </div>
      )}

      {state.kind === "ready" && state.nextCursor ? (
        <div className="space-y-2">
          <Button type="button" variant="ds-secondary" size="md" loading={loadingMore} loadingLabel="Carregando…" onClick={() => void loadMore()}>
            Carregar mais
          </Button>
          {moreError ? (
            <p role="alert" className="text-xs font-semibold text-ds-danger">
              {moreError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TemplateRow({
  template,
  canGenerate,
  canReview,
  pendingAction,
  anyPending,
  confirming,
  notice,
  onUse,
  onAsk,
  onCancel,
  onConfirm,
}: {
  template: EditorTemplateView;
  canGenerate: boolean;
  canReview: boolean;
  pendingAction: RowAction | null;
  anyPending: boolean;
  confirming: "publish" | "archive" | null;
  notice: { text: string; tone: "ok" | "error" } | null;
  onUse: () => void;
  onAsk: (action: "publish" | "archive") => void;
  onCancel: () => void;
  onConfirm: (action: "publish" | "archive") => void;
}) {
  const useBlock = getUseTemplateBlockReason(template, canGenerate);
  const publishBlock = getPublishListBlockReason(template, canReview);
  const archiveBlock = getArchiveBlockReason({ status: template.status, canReview });
  const reasonId = `template-reason-${template.id}`;
  const noticeId = `template-notice-${template.id}`;
  const busy = anyPending;
  // Um único texto de motivo por linha, ligado por aria-describedby aos botões desabilitados.
  const reasonText =
    template.status === "draft" && useBlock
      ? useBlock
      : !canReview && template.status !== "archived"
        ? "Publicar e arquivar exigem a permissão de revisão de documentos."
        : null;

  return (
    <LiftRow interactive={false} role="listitem" className="space-y-2" data-testid="editor-template-row">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64 space-y-0.5">
          <p className="break-words text-[14.5px] font-extrabold text-ds-ink">{template.name}</p>
          {template.description ? <p className="break-words text-xs text-ds-ink-muted">{template.description}</p> : null}
          <p className="text-xs text-ds-ink-muted">
            Versão {template.currentVersion}
            {template.publishedVersion !== null ? ` · publicada: versão ${template.publishedVersion}` : ""}
            {template.fieldKeys.length > 0
              ? ` · ${template.fieldKeys.length} ${template.fieldKeys.length === 1 ? "campo do sistema" : "campos do sistema"}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill variant={TEMPLATE_STATUS_VARIANT[template.status]}>{TEMPLATE_STATUS_LABEL[template.status]}</StatusPill>
          {template.status === "published" && hasUnpublishedChanges(template) ? <StatusPill variant="warn">Alterações não publicadas</StatusPill> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {template.status === "published" ? (
          <Button
            type="button"
            variant="ds-secondary"
            size="xs"
            loading={pendingAction === "use"}
            loadingLabel="Criando rascunho…"
            disabled={useBlock !== null || busy}
            aria-describedby={useBlock ? reasonId : notice ? noticeId : undefined}
            aria-label={`Usar modelo ${template.name}`}
            onClick={onUse}
          >
            Usar modelo
          </Button>
        ) : null}
        <Button asChild type="button" variant="ds-secondary" size="xs">
          <Link href={`/dashboard/documents/editor/templates/${encodeURIComponent(template.id)}`} aria-label={`Editar modelo ${template.name}`}>
            {template.status === "archived" ? "Abrir" : "Editar"}
          </Link>
        </Button>
        {template.status !== "archived" ? (
          <>
            <Button
              type="button"
              variant="ds-secondary"
              size="xs"
              disabled={publishBlock !== null || busy || confirming !== null}
              aria-describedby={publishBlock ? reasonId : undefined}
              aria-label={`Publicar modelo ${template.name}`}
              onClick={() => onAsk("publish")}
            >
              Publicar
            </Button>
            <Button
              type="button"
              variant="ds-secondary"
              size="xs"
              disabled={archiveBlock !== null || busy || confirming !== null}
              aria-describedby={archiveBlock ? reasonId : undefined}
              aria-label={`Arquivar modelo ${template.name}`}
              onClick={() => onAsk("archive")}
            >
              Arquivar
            </Button>
          </>
        ) : null}
      </div>

      {reasonText ? (
        <p id={reasonId} className="text-xs text-ds-ink-muted">
          {reasonText}
        </p>
      ) : null}

      {confirming === "publish" ? (
        <InlineConfirm
          message={`Publicar a versão ${template.currentVersion} de "${template.name}"? Só a versão publicada pode ser usada; salvar o modelo depois cria uma nova versão que não é publicada.`}
          confirmLabel="Publicar modelo"
          loadingLabel="Publicando…"
          loading={pendingAction === "publish"}
          onConfirm={() => onConfirm("publish")}
          onCancel={onCancel}
        />
      ) : null}
      {confirming === "archive" ? (
        <InlineConfirm
          message={`Arquivar "${template.name}"? Ele deixa de poder ser editado, publicado ou usado. Documentos já criados a partir dele não mudam.`}
          confirmLabel="Arquivar modelo"
          loadingLabel="Arquivando…"
          loading={pendingAction === "archive"}
          onConfirm={() => onConfirm("archive")}
          onCancel={onCancel}
        />
      ) : null}
      {notice ? (
        <p
          id={noticeId}
          role={notice.tone === "error" ? "alert" : "status"}
          className={notice.tone === "error" ? "text-xs font-semibold text-ds-danger" : "text-xs font-semibold text-ds-ok"}
        >
          {notice.text}
        </p>
      ) : null}
    </LiftRow>
  );
}
