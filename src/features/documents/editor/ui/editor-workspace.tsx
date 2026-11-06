"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, Eye, FilePlus2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { cn } from "@/lib/utils";

import {
  createEditorTemplate,
  downloadFinalEditorPdf,
  finalizeEditorDocument,
  openEditorDocument,
  openEditorTemplate,
  previewEditorTemplate,
  previewResolvedEditorDocument,
  previewSampleEditorDocument,
  publishEditorTemplate,
  saveEditorDocument,
  saveEditorTemplate,
  toEditorFailure,
  type EditorDocumentView,
  type EditorFailure,
  type EditorTemplateView,
} from "./editor-client";
import { EditorLoadingState } from "./editor-loading-state";
import { EditorFieldsPanel } from "./editor-fields-panel";
import { EditorFillPanel, type FillPanelError } from "./editor-fill-panel";
import { createEditorExtensions } from "./editor-extensions";
import {
  AUTOSAVE_DELAY_MS,
  SAVE_STATE_LABEL,
  collectFieldKeys,
  buildPdfFileName,
  describeResolvedPreviewFailure,
  finalizeAttemptKey,
  getFinalizeBaseBlockReason,
  getFinalizeBlockReason,
  hasMeaningfulContent,
  isEditorLocked,
  sensitiveFieldKeys,
  shouldAutosave,
  type EditorJsonNode,
  type SaveState,
} from "./editor-logic";
import { EditorPreviewDialog } from "./editor-preview-dialog";
import { EditorSaveAsTemplatePanel } from "./editor-save-as-template-panel";
import styles from "./editor-surface.module.css";
import { EditorToolbar } from "./editor-toolbar";
import {
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_STATUS_LABEL,
  TEMPLATE_STATUS_VARIANT,
  buildTemplateSaveBody,
  createAttemptRegistry,
  describeDescriptionCounter,
  editableStatusFor,
  getPublishBlockReason,
  getTemplateMetaBlockReason,
  hasUnpublishedChanges,
  isTemplateMetaEditable,
  isVersionConflictCode,
  templateCreateAttemptKey,
  templatePublishAttemptKey,
  templateSaveFingerprint,
  versionAfterTemplateSave,
} from "./template-logic";

/**
 * O mesmo espaço de edição serve ao documento e ao modelo. A abstração existente (`EditorWorkspace`)
 * já continha todo o ciclo de rascunho, autosave, conflito de versão, prévia e bloqueio durante
 * operações; duplicá-lo criaria dois fluxos de salvamento divergentes. Por isso o fluxo é
 * parametrizado por `EditorTarget`/`OpenedEditor` e só as diferenças reais (chamadas da API, ações
 * do rodapé e faixa de situação) ramificam por `kind`.
 */
export type EditorTarget = { kind: "document"; id: string } | { kind: "template"; id: string };
type OpenedEditor =
  | { kind: "document"; document: EditorDocumentView; content: unknown; version: number }
  | { kind: "template"; template: EditorTemplateView; content: unknown; version: number };

type ActionScope = "save" | "preview" | "finalize" | "download" | "publish" | "saveTemplate";
type ActionError = { scope: ActionScope; text: string };
type PersistResult = "ok" | "conflict" | "error" | "invalid";

const MAX_TITLE = 200;

function StatePanel({ title, children, tone = "neutral" }: { title: string; children?: React.ReactNode; tone?: "neutral" | "danger" }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-ds-card border px-5 py-6",
        tone === "danger" ? "border-ds-confirm-border bg-ds-confirm-bg text-ds-confirm-ink" : "border-ds-border bg-ds-surface text-ds-ink",
      )}
    >
      <p className="text-sm font-extrabold">{title}</p>
      {children ? <div className="mt-1.5 text-[13px]">{children}</div> : null}
    </div>
  );
}

/** Carrega o documento (1 GET por abertura/recarga) e entrega a sessão de edição. */
export default function EditorWorkspace({ target }: { target: EditorTarget }) {
  const { permissions, isDefaultAdmin, loading: authLoading } = useAuth();
  const request = useAuthenticatedApi();
  const canGenerate = hasFormalizationPermission(permissions, "documents.generate", isDefaultAdmin);
  const canReview = hasFormalizationPermission(permissions, "documents.review", isDefaultAdmin);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error"; failure: EditorFailure } | { kind: "ready"; opened: OpenedEditor }
  >({ kind: "loading" });

  const reload = () => {
    setState({ kind: "loading" });
    setReloadKey((key) => key + 1);
  };

  useEffect(() => {
    if (authLoading || !canGenerate) return;
    let cancelled = false;
    const open: Promise<OpenedEditor> =
      target.kind === "document"
        ? openEditorDocument(request, target.id).then((opened) => ({ kind: "document", ...opened }))
        : openEditorTemplate(request, target.id).then((opened) => ({ kind: "template", ...opened }));
    open
      .then((opened) => {
        if (!cancelled) setState({ kind: "ready", opened });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: "error", failure: toEditorFailure(error) });
      });
    return () => {
      cancelled = true;
    };
    // `request` muda com a sessão do Firebase; recarregar só quando o documento ou o pedido de recarga mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind, target.id, reloadKey, authLoading, canGenerate]);

  if (authLoading) return <EditorLoadingState />;
  if (!canGenerate) {
    return (
      <StatePanel title="Sem permissão para o editor de documentos" tone="danger">
        Você precisa da permissão de gerar documentos para abrir {target.kind === "template" ? "este modelo" : "este documento"}.
      </StatePanel>
    );
  }
  if (state.kind === "loading") return <EditorLoadingState />;
  if (state.kind === "error") {
    return (
      <StatePanel title={target.kind === "template" ? "Não foi possível abrir o modelo" : "Não foi possível abrir o documento"} tone="danger">
        <p>{state.failure.message}</p>
        {state.failure.status !== 404 && state.failure.status !== 403 ? (
          <Button type="button" variant="ds-secondary" size="xs" className="mt-3" onClick={reload}>
            Tentar abrir novamente
          </Button>
        ) : null}
      </StatePanel>
    );
  }
  return (
    <EditorSession
      key={`${target.kind}:${target.id}:${reloadKey}`}
      opened={state.opened}
      canReview={canReview}
      onReload={reload}
    />
  );
}

function EditorSession({
  opened,
  canReview,
  onReload,
}: {
  opened: OpenedEditor;
  canReview: boolean;
  onReload: () => void;
}) {
  const router = useRouter();
  const request = useAuthenticatedApi();
  const { activeUsers, loading: usersLoading } = useAuth();
  const kind = opened.kind;
  const isTemplate = kind === "template";
  const sourceId = opened.kind === "template" ? opened.template.id : opened.document.id;
  const [templateView, setTemplateView] = useState<EditorTemplateView | null>(opened.kind === "template" ? opened.template : null);
  const [status, setStatus] = useState(opened.kind === "template" ? opened.template.status : opened.document.status);
  const [title, setTitle] = useState(opened.kind === "template" ? opened.template.name : opened.document.title);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [description, setDescription] = useState(opened.kind === "template" ? opened.template.description : "");
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState<{ currentVersion: number | null } | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [contentError, setContentError] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [pdfReady, setPdfReady] = useState(opened.kind === "document" && opened.document.pdfAvailable);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedNotice, setPublishedNotice] = useState<string | null>(null);
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  // O titular vive só nesta tela: nada é gravado no documento antes de finalizar.
  const [fillOpen, setFillOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [resolvedCheck, setResolvedCheck] = useState<{ employeeId: string; missing: boolean } | null>(null);
  const [previewResolved, setPreviewResolved] = useState(false);
  const [contentSummary, setContentSummary] = useState(() => summarize(opened.content as EditorJsonNode));

  // Documento: só rascunho edita. Modelo: edita enquanto não estiver arquivado (publicado também edita, em nova versão).
  const editableStatus = editableStatusFor(kind, status);
  const isDraft = editableStatus === "draft";
  const operationBusy = finalizing || publishing || creatingTemplate;
  const locked = isEditorLocked({ status: editableStatus, contentError, previewBusy, finalizing: operationBusy });
  const versionRef = useRef(opened.version);
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const inflightRef = useRef<Promise<PersistResult> | null>(null);
  const attemptRef = useRef<{ id: string; fingerprint: string } | null>(null);
  const finalizeAttemptRef = useRef<{ id: string; key: string } | null>(null);
  const attempts = useRef(createAttemptRegistry(() => crypto.randomUUID()));
  const previewUrlRef = useRef<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistRef = useRef<() => Promise<PersistResult>>(async () => "error");
  const guardRef = useRef({ status: editableStatus, conflict: false, saveState: "saved" as SaveState });
  const titleRef = useRef(title);
  const descriptionRef = useRef(description);
  const extensions = useMemo(() => createEditorExtensions(), []);
  const editorRef = useRef<Editor | null>(null);

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      const guard = guardRef.current;
      // Só salva sozinho com alteração pendente, rascunho e sem conflito.
      if (shouldAutosave({ status: guard.status, saveState: guard.saveState, conflict: guard.conflict, canEdit: true })) {
        void persistRef.current();
      }
    }, AUTOSAVE_DELAY_MS);
  }, []);

  const markDirty = useCallback((contentChanged = true) => {
    revisionRef.current += 1;
    setSaveState((current) => (current === "conflict" ? current : "dirty"));
    setActionError((current) => (current?.scope === "save" ? null : current));
    if (contentChanged) {
      // O texto mudou: a conferência anterior com dados do titular deixou de valer.
      setResolvedCheck(null);
      // Mantém o estado do botão Finalizar; só re-renderiza quando o resumo muda de fato.
      const json = editorRef.current?.getJSON() as EditorJsonNode | undefined;
      if (json) {
        const next = summarize(json);
        setContentSummary((prev) =>
          prev.hasContent === next.hasContent && prev.fieldKeys.join("|") === next.fieldKeys.join("|") ? prev : next,
        );
      }
    }
    scheduleAutosave();
  }, [scheduleAutosave]);

  const editor = useEditor({
    extensions,
    content: opened.content as Record<string, unknown>,
    editable: isDraft,
    immediatelyRender: false,
    enableContentCheck: true,
    onContentError: () => setContentError(true),
    onUpdate: () => markDirty(true),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": isTemplate ? "Conteúdo do modelo" : "Conteúdo do documento",
      },
    },
  });

  useEffect(() => {
    // `false`: trocar editável não deve disparar `update` (senão o documento abre como alterado).
    editor?.setEditable(!locked, false);
  }, [editor, locked]);

  const persist = useCallback((): Promise<PersistResult> => {
    if (inflightRef.current) return inflightRef.current;
    const current = editorRef.current;
    if (!current) return Promise.resolve("error");
    const trimmed = titleRef.current.trim();
    if (!trimmed) {
      setTitleError(isTemplate ? "Informe o nome do modelo." : "Informe o título do documento.");
      setSaveState("error");
      return Promise.resolve("invalid");
    }
    const metaBlock = isTemplate ? getTemplateMetaBlockReason({ name: titleRef.current, description: descriptionRef.current }) : null;
    if (metaBlock) {
      setDescriptionError(metaBlock);
      setSaveState("error");
      return Promise.resolve("invalid");
    }
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    const content = current.getJSON();
    const revision = revisionRef.current;
    const fingerprint = isTemplate
      ? templateSaveFingerprint({ content, name: trimmed, description: descriptionRef.current, version: versionRef.current })
      : JSON.stringify({ content, title: trimmed, version: versionRef.current });
    // Repetir a mesma tentativa reaproveita o identificador (a rota é idempotente por clientRequestId).
    const attempt = attemptRef.current?.fingerprint === fingerprint ? attemptRef.current : { id: crypto.randomUUID(), fingerprint };
    attemptRef.current = attempt;
    setSaveState("saving");
    setActionError(null);
    setTitleError(null);
    setDescriptionError(null);
    const run = (async (): Promise<PersistResult> => {
      try {
        if (kind === "template") {
          const { template } = await saveEditorTemplate(
            request,
            sourceId,
            buildTemplateSaveBody({
              expectedVersion: versionRef.current,
              clientRequestId: attempt.id,
              content,
              name: trimmed,
              description: descriptionRef.current,
            }),
          );
          // Salvar só nome/descrição com o mesmo conteúdo não avança a versão: vale a que o servidor devolveu.
          versionRef.current = versionAfterTemplateSave(versionRef.current, template).version;
          setTemplateView(template);
          setStatus(template.status);
          // Uma nova versão salva não é a publicada: o aviso de publicação anterior deixa de valer.
          setPublishedNotice(null);
        } else {
          const result = await saveEditorDocument(request, sourceId, {
            expectedContentVersion: versionRef.current,
            clientRequestId: attempt.id,
            content,
            title: trimmed,
          });
          versionRef.current = result.document.contentVersion;
        }
        attemptRef.current = null;
        savedRevisionRef.current = revision;
        setSaveState(revisionRef.current === revision ? "saved" : "dirty");
        if (revisionRef.current !== revision) scheduleAutosave();
        return "ok";
      } catch (error) {
        const failure = toEditorFailure(error);
        if (isVersionConflictCode(failure.code)) {
          setConflict({ currentVersion: failure.currentVersion });
          setSaveState("conflict");
          return "conflict";
        }
        if (failure.code === "EDITOR_DOCUMENT_NOT_DRAFT") setStatus("final");
        if (failure.code === "EDITOR_TEMPLATE_ARCHIVED") setStatus("archived");
        setSaveState("error");
        setActionError({ scope: "save", text: failure.message });
        return "error";
      } finally {
        inflightRef.current = null;
      }
    })();
    inflightRef.current = run;
    return run;
  }, [kind, isTemplate, sourceId, request, scheduleAutosave]);

  // Espelha o estado atual em refs lidas só por timers e manipuladores (nunca durante a renderização).
  useEffect(() => {
    guardRef.current = { status: editableStatus, conflict: conflict !== null, saveState };
    titleRef.current = title;
    descriptionRef.current = description;
    editorRef.current = editor;
    persistRef.current = persist;
  });

  useEffect(
    () => () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    },
    [],
  );

  // Alerta nativo do navegador ao sair com alterações não salvas (sem confirm()).
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (revisionRef.current !== savedRevisionRef.current) event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
  }, []);
  // Revoga o blob ainda aberto ao sair da página.
  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  /** Garante que o servidor tem a versão atual do texto (prévia e finalização usam o conteúdo salvo). */
  const ensureSaved = useCallback(async (): Promise<PersistResult> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (inflightRef.current) {
        const joined = await inflightRef.current;
        if (joined !== "ok") return joined;
      }
      if (revisionRef.current === savedRevisionRef.current) return "ok";
      const result = await persist();
      if (result !== "ok") return result;
    }
    return revisionRef.current === savedRevisionRef.current ? "ok" : "error";
  }, [persist]);

  async function handlePreview(subjectId?: string) {
    if (previewBusy) return;
    setActionError(null);
    setPreviewBusy(true);
    try {
      const saved = await ensureSaved();
      if (saved !== "ok") {
        if (saved === "error" || saved === "invalid") {
          setActionError({ scope: "preview", text: isTemplate ? "Salve o modelo antes de ver a prévia." : "Salve o documento antes de ver a prévia." });
        }
        return;
      }
      const blob = isTemplate
        ? await previewEditorTemplate(request, sourceId)
        : subjectId
          ? await previewResolvedEditorDocument(request, sourceId, { employeeId: subjectId })
          : await previewSampleEditorDocument(request, sourceId);
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      setPreviewResolved(Boolean(subjectId));
      if (subjectId) setResolvedCheck({ employeeId: subjectId, missing: false });
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return url;
      });
    } catch (error) {
      const failure = toEditorFailure(error);
      if (subjectId && failure.code === "EDITOR_MISSING_FIELDS") setResolvedCheck({ employeeId: subjectId, missing: true });
      setActionError({ scope: "preview", text: subjectId ? describeResolvedPreviewFailure(failure) : failure.message });
    } finally {
      setPreviewBusy(false);
    }
  }

  async function handleFinalize() {
    if (finalizing) return;
    setActionError(null);
    setFinalizing(true);
    try {
      const saved = await ensureSaved();
      if (saved !== "ok") {
        setConfirmFinalize(false);
        if (saved === "error" || saved === "invalid") {
          setActionError({ scope: "finalize", text: "Não foi possível salvar antes de finalizar. Corrija e tente novamente." });
        }
        return;
      }
      const version = versionRef.current;
      // Só documento com campos envia titular; a tentativa muda com a versão e com o titular.
      const subjectId = hasFields ? employeeId : null;
      const key = finalizeAttemptKey(version, subjectId);
      const attempt = finalizeAttemptRef.current?.key === key ? finalizeAttemptRef.current : { id: crypto.randomUUID(), key };
      finalizeAttemptRef.current = attempt;
      const result = await finalizeEditorDocument(request, sourceId, {
        clientRequestId: attempt.id,
        expectedContentVersion: version,
        ...(subjectId ? { subject: { employeeId: subjectId } } : {}),
      });
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      setPdfReady(result.document.pdfAvailable === true);
      setStatus("final");
      setConfirmFinalize(false);
      setFillOpen(false);
    } catch (error) {
      const failure = toEditorFailure(error);
      setConfirmFinalize(false);
      if (isVersionConflictCode(failure.code)) {
        setConflict({ currentVersion: failure.currentVersion });
        setSaveState("conflict");
        setFillOpen(false);
      } else if (failure.code === "EDITOR_MISSING_FIELDS") {
        if (hasFields && employeeId) setResolvedCheck({ employeeId, missing: true });
        setActionError({ scope: "finalize", text: describeResolvedPreviewFailure(failure) });
      } else {
        setActionError({ scope: "finalize", text: failure.message });
      }
    } finally {
      setFinalizing(false);
    }
  }

  async function handleDownload() {
    if (downloading) return;
    setActionError(null);
    setDownloading(true);
    let url: string | null = null;
    try {
      const blob = await downloadFinalEditorPdf(request, sourceId);
      url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = buildPdfFileName(titleRef.current);
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      setActionError({ scope: "download", text: toEditorFailure(error).message });
    } finally {
      if (url) {
        const toRevoke = url;
        // Dá tempo ao navegador de iniciar a gravação antes de liberar o blob.
        setTimeout(() => URL.revokeObjectURL(toRevoke), 1000);
      }
      setDownloading(false);
    }
  }

  async function handlePublish() {
    if (publishing || !isTemplate) return;
    setActionError(null);
    setPublishedNotice(null);
    setPublishing(true);
    try {
      const saved = await ensureSaved();
      if (saved !== "ok") {
        setConfirmPublish(false);
        if (saved === "error" || saved === "invalid") {
          setActionError({ scope: "publish", text: "Não foi possível salvar antes de publicar. Corrija e tente novamente." });
        }
        return;
      }
      const version = versionRef.current;
      const key = templatePublishAttemptKey(sourceId, version);
      const { template } = await publishEditorTemplate(request, sourceId, { clientRequestId: attempts.current.idFor(key), expectedVersion: version });
      attempts.current.clear(key);
      setTemplateView(template);
      setStatus(template.status);
      setConfirmPublish(false);
      setPublishedNotice(`Versão ${template.publishedVersion} publicada. Ela já pode ser usada para criar documentos.`);
    } catch (error) {
      const failure = toEditorFailure(error);
      setConfirmPublish(false);
      if (isVersionConflictCode(failure.code)) {
        setConflict({ currentVersion: failure.currentVersion });
        setSaveState("conflict");
      } else {
        if (failure.code === "EDITOR_TEMPLATE_ARCHIVED") setStatus("archived");
        setActionError({ scope: "publish", text: failure.message });
      }
    } finally {
      setPublishing(false);
    }
  }

  async function handleSaveAsTemplate(input: { name: string; description: string }) {
    if (creatingTemplate || isTemplate) return;
    setActionError(null);
    setCreatingTemplate(true);
    try {
      // O servidor copia a versão SALVA: grava antes o que está na tela.
      const saved = await ensureSaved();
      if (saved !== "ok") {
        if (saved === "error" || saved === "invalid") {
          setActionError({ scope: "saveTemplate", text: "Salve o documento antes de criar o modelo." });
        } else {
          setSaveAsTemplateOpen(false);
        }
        return;
      }
      const version = versionRef.current;
      const key = templateCreateAttemptKey(sourceId, version, input.name, input.description);
      const { template } = await createEditorTemplate(request, {
        clientRequestId: attempts.current.idFor(key),
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        fromDocument: { documentId: sourceId, version },
      });
      attempts.current.clear(key);
      router.push(`/dashboard/documents/editor/templates/${encodeURIComponent(template.id)}`);
    } catch (error) {
      setActionError({ scope: "saveTemplate", text: toEditorFailure(error).message });
    } finally {
      setCreatingTemplate(false);
    }
  }

  function keepMyVersion() {
    if (!conflict || conflict.currentVersion === null) return;
    // Decisão explícita do usuário: grava o texto local como nova versão sobre a que está no servidor
    // (as versões anteriores continuam imutáveis no histórico do documento).
    versionRef.current = conflict.currentVersion;
    attemptRef.current = null;
    setConflict(null);
    setSaveState("dirty");
    void persist();
  }

  function insertField(key: string) {
    editorRef.current?.chain().insertContent({ type: "documentField", attrs: { key } }).run();
    setFieldsOpen(false);
    // O Radix devolve o foco ao botão do painel ao fechar; o cursor volta ao texto logo depois.
    setTimeout(() => editorRef.current?.commands.focus(), 80);
  }

  const hasFields = contentSummary.fieldKeys.length > 0;
  const gateInput = {
    status,
    canReview,
    hasContent: contentSummary.hasContent,
    fieldKeys: contentSummary.fieldKeys,
    conflict: conflict !== null,
    subjectEmployeeId: employeeId || null,
    subjectHasMissingFields: resolvedCheck?.employeeId === employeeId && resolvedCheck.missing,
  };
  // Fora do painel, o botão principal só precisa de permissão/conteúdo; o titular é pedido na etapa seguinte.
  const finalizeBlock = hasFields ? getFinalizeBaseBlockReason(gateInput) : getFinalizeBlockReason(gateInput);
  const fillBlock = getFinalizeBlockReason(gateInput);
  const previewChecked = resolvedCheck?.employeeId === employeeId && !resolvedCheck.missing;
  const panelError: FillPanelError | null =
    actionError && (actionError.scope === "preview" || actionError.scope === "finalize") ? { scope: actionError.scope, text: actionError.text } : null;
  const sensitiveKeys = sensitiveFieldKeys(contentSummary.fieldKeys);
  const saveBusy = saveState === "saving";
  const readOnly = locked;
  const alreadyPublished =
    templateView !== null && templateView.status === "published" && templateView.publishedVersion === templateView.currentVersion && saveState === "saved";
  const publishBlock = getPublishBlockReason({
    status,
    canReview,
    hasContent: contentSummary.hasContent,
    conflict: conflict !== null,
    alreadyPublished,
  });
  const metaEditable = isTemplateMetaEditable({ status: editableStatus, locked: readOnly });
  const descriptionCounter = describeDescriptionCounter(description);
  const subjectNoun = isTemplate ? "modelo" : "documento";

  if (contentError) {
    return (
      <StatePanel title={`Este ${subjectNoun} não pode ser aberto no editor`} tone="danger">
        O conteúdo salvo tem uma estrutura que o editor não reconhece. Nada foi alterado.
      </StatePanel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <Field label={isTemplate ? "Nome do modelo" : "Título do documento"} htmlFor="editor-title" error={titleError}>
            <input
              id="editor-title"
              type="text"
              value={title}
              maxLength={MAX_TITLE}
              readOnly={readOnly}
              aria-invalid={titleError ? true : undefined}
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleError(null);
                markDirty(false);
              }}
              className={fieldInputClass}
            />
          </Field>
        </div>
        <div className="flex items-center gap-2 pb-1">
          {templateView ? (
            <>
              <StatusPill variant={TEMPLATE_STATUS_VARIANT[templateView.status]}>{TEMPLATE_STATUS_LABEL[templateView.status]}</StatusPill>
              <span data-testid="editor-template-versions" className="text-xs font-bold text-ds-ink-muted">
                Versão {templateView.currentVersion}
                {templateView.publishedVersion !== null ? ` · publicada: versão ${templateView.publishedVersion}` : " · nunca publicada"}
              </span>
              {templateView.status === "published" && hasUnpublishedChanges(templateView) ? (
                <StatusPill variant="warn">Alterações não publicadas</StatusPill>
              ) : null}
            </>
          ) : (
            <StatusPill variant={isDraft ? "info" : "ok"}>{isDraft ? "Rascunho" : "Finalizado"}</StatusPill>
          )}
          {isDraft ? (
            <span aria-live="polite" data-testid="editor-save-state" className="inline-flex items-center gap-1 text-xs font-bold text-ds-ink-muted">
              {saveBusy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
              {SAVE_STATE_LABEL[saveState]}
            </span>
          ) : null}
        </div>
      </div>

      {isTemplate ? (
        <Field
          label="Descrição do modelo"
          requirement="opcional"
          htmlFor="editor-template-description"
          error={descriptionError}
          hint={
            <>
              Explica quando usar o modelo; aparece na lista. Não coloque dados de pessoas.{" "}
              <span data-testid="editor-description-counter" className={descriptionCounter.over ? "font-bold text-ds-danger" : undefined}>
                {descriptionCounter.text}
              </span>
            </>
          }
        >
          <textarea
            id="editor-template-description"
            value={description}
            maxLength={TEMPLATE_DESCRIPTION_MAX}
            rows={2}
            readOnly={!metaEditable}
            aria-invalid={descriptionError ? true : undefined}
            onChange={(event) => {
              setDescription(event.target.value);
              setDescriptionError(null);
              markDirty(false);
            }}
            className={cn(fieldInputClass, "h-auto py-2")}
          />
        </Field>
      ) : null}

      {conflict ? (
        <div role="alert" className="space-y-2 rounded-ds-btn border border-ds-alert-border bg-ds-alert-bg px-4 py-3 text-ds-alert-ink">
          <p className="flex items-start gap-2 text-[13px] font-bold">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            Outra sessão alterou este {subjectNoun}. Seu texto continua aqui, sem perdas, e o salvamento automático está pausado.
          </p>
          {confirmReload ? (
            <InlineConfirm
              message="Recarregar a versão salva? As alterações feitas neste navegador e ainda não salvas serão descartadas."
              confirmLabel="Recarregar versão salva"
              cancelLabel="Manter meu texto"
              onConfirm={onReload}
              onCancel={() => setConfirmReload(false)}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {conflict.currentVersion !== null ? (
                <Button type="button" variant="ds-secondary" size="xs" onClick={keepMyVersion}>
                  Salvar minha versão sobre a atual
                </Button>
              ) : null}
              <Button type="button" variant="ds-secondary" size="xs" onClick={() => setConfirmReload(true)}>
                Recarregar versão salva
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {!isDraft && isTemplate ? (
        <div role="status" className="flex items-start gap-2 rounded-ds-btn border border-ds-border bg-ds-surface px-4 py-3 text-[13px] text-ds-ink">
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ds-ink-muted" />
          <p>Modelo arquivado: o texto não pode mais ser alterado, publicado nem usado. Documentos já criados a partir dele não mudam.</p>
        </div>
      ) : !isDraft ? (
        <div role="status" className="flex items-start gap-2 rounded-ds-btn border border-ds-border bg-ds-surface px-4 py-3 text-[13px] text-ds-ink">
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ds-ok" />
          <div className="space-y-2">
            <p>
              Documento finalizado: o texto não pode mais ser alterado.
              {pdfReady ? " O PDF final foi gerado e guardado." : " O PDF final não está disponível para download."}
            </p>
            {pdfReady ? (
              <Button
                type="button"
                variant="primary-page"
                size="md"
                loading={downloading}
                loadingLabel="Baixando PDF…"
                onClick={() => void handleDownload()}
              >
                <Download aria-hidden className="mr-2 h-4 w-4" />
                Baixar PDF final
              </Button>
            ) : null}
            {actionError?.scope === "download" ? (
              <p role="alert" data-scope="download" className="text-xs font-semibold text-ds-danger">
                {actionError.text}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            {editor ? <EditorToolbar editor={editor} disabled={readOnly} /> : <span />}
            <Button type="button" variant="ds-secondary" size="sm" disabled={readOnly} onClick={() => setFieldsOpen(true)}>
              <FilePlus2 aria-hidden className="mr-2 h-4 w-4" />
              Inserir campo do sistema
            </Button>
          </div>
        </>
      )}

      <div
        className={cn(
          "overflow-hidden rounded-ds-card border border-ds-border focus-within:border-ds-modal focus-within:ring-[3px] focus-within:ring-ds-modal-soft",
        )}
      >
        <div className={styles.surface} aria-readonly={readOnly ? "true" : undefined}>
          {editor ? <EditorContent editor={editor} /> : <EditorLoadingState />}
        </div>
      </div>

      {!isTemplate && sensitiveKeys.length > 0 ? (
        <p className="text-xs font-semibold text-ds-alert-ink" role="note">
          Este documento usa {sensitiveKeys.length === 1 ? "um campo sensível" : `${sensitiveKeys.length} campos sensíveis`}.
          A prévia com titular e a finalização exigem a permissão de dados sensíveis (verificada no servidor).
        </p>
      ) : null}

      {isDraft && isTemplate ? (
        <div className="space-y-2 border-t border-ds-divider pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ds-secondary"
              size="md"
              loading={saveBusy}
              loadingLabel="Salvando…"
              disabled={saveState === "saved" || conflict !== null || operationBusy}
              onClick={() => void persist()}
            >
              Salvar modelo
            </Button>
            <Button
              type="button"
              variant="ds-secondary"
              size="md"
              loading={previewBusy}
              loadingLabel="Gerando prévia…"
              disabled={conflict !== null || operationBusy}
              onClick={() => void handlePreview()}
            >
              <Eye aria-hidden className="mr-2 h-4 w-4" />
              Ver prévia de exemplo
            </Button>
            <Button
              type="button"
              variant="primary-page"
              size="md"
              disabled={publishBlock !== null || confirmPublish || operationBusy || previewBusy}
              aria-describedby={publishBlock ? "editor-publish-reason" : undefined}
              onClick={() => setConfirmPublish(true)}
            >
              Publicar modelo
            </Button>
          </div>
          {publishBlock && conflict === null ? (
            <p id="editor-publish-reason" className="max-w-3xl text-xs text-ds-ink-muted">
              {publishBlock}
            </p>
          ) : null}
          <p className="max-w-3xl text-xs text-ds-ink-muted">
            Só a versão publicada pode ser usada para criar documentos. Salvar depois de publicar cria uma nova versão, que não é
            usada até ser publicada. O modelo vale para todas as unidades e não deve ter nomes, CPFs ou outros dados de pessoas;
            a prévia usa valores de exemplo.
          </p>
          {publishedNotice ? (
            <p role="status" data-testid="editor-publish-notice" className="text-xs font-semibold text-ds-ok">
              {publishedNotice}
            </p>
          ) : null}
          {actionError ? (
            <p role="alert" data-scope={actionError.scope} className="text-xs font-semibold text-ds-danger">
              {actionError.text}
            </p>
          ) : null}
          {confirmPublish ? (
            <InlineConfirm
              message={`Publicar a versão ${templateView?.currentVersion ?? ""} deste modelo? Só a versão publicada pode ser usada; salvar depois cria uma nova versão que não é publicada.`}
              confirmLabel="Publicar modelo"
              loadingLabel="Publicando…"
              loading={publishing}
              onConfirm={() => void handlePublish()}
              onCancel={() => setConfirmPublish(false)}
            />
          ) : null}
        </div>
      ) : isDraft ? (
        <div className="space-y-2 border-t border-ds-divider pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ds-secondary"
              size="md"
              loading={saveBusy}
              loadingLabel="Salvando…"
              disabled={saveState === "saved" || conflict !== null || finalizing || creatingTemplate}
              onClick={() => void persist()}
            >
              Salvar documento
            </Button>
            <Button
              type="button"
              variant="ds-secondary"
              size="md"
              loading={previewBusy}
              loadingLabel="Gerando prévia…"
              disabled={conflict !== null || finalizing || creatingTemplate}
              onClick={() => void handlePreview()}
            >
              <Eye aria-hidden className="mr-2 h-4 w-4" />
              Ver prévia timbrada
            </Button>
            <Button
              type="button"
              variant="ds-secondary"
              size="md"
              disabled={conflict !== null || finalizing || creatingTemplate || previewBusy}
              onClick={() => setSaveAsTemplateOpen(true)}
            >
              Salvar como modelo
            </Button>
            <Button
              type="button"
              variant="primary-page"
              size="md"
              disabled={finalizeBlock !== null || confirmFinalize || finalizing || previewBusy || creatingTemplate}
              aria-describedby={finalizeBlock ? "editor-finalize-reason" : undefined}
              onClick={() => (hasFields ? setFillOpen(true) : setConfirmFinalize(true))}
            >
              {hasFields ? "Preencher e finalizar" : "Finalizar documento"}
            </Button>
          </div>
          {finalizeBlock && !(conflict !== null) ? (
            <p id="editor-finalize-reason" className="max-w-3xl text-xs text-ds-ink-muted">
              {finalizeBlock}
            </p>
          ) : null}
          {saveState === "saved" && conflict === null ? (
            <p className="text-xs text-ds-ink-muted">A prévia usa valores de exemplo e o texto já salvo; salvamos antes de gerá-la.</p>
          ) : null}
          {actionError && !fillOpen && !saveAsTemplateOpen ? (
            <p role="alert" data-scope={actionError.scope} className="text-xs font-semibold text-ds-danger">
              {actionError.text}
            </p>
          ) : null}
          {confirmFinalize && !hasFields ? (
            <InlineConfirm
              message="Finalizar este documento? Ele deixa de ser editável e o PDF final é gerado e guardado."
              confirmLabel="Finalizar documento"
              loadingLabel="Finalizando…"
              loading={finalizing}
              onConfirm={() => void handleFinalize()}
              onCancel={() => setConfirmFinalize(false)}
            />
          ) : null}
        </div>
      ) : null}

      <EditorFieldsPanel open={fieldsOpen && !readOnly} onOpenChange={setFieldsOpen} onInsert={insertField} />
      {isTemplate ? null : (
        <EditorSaveAsTemplatePanel
          open={saveAsTemplateOpen && isDraft}
          onOpenChange={(next) => {
            setSaveAsTemplateOpen(next);
            if (!next) setActionError((current) => (current?.scope === "saveTemplate" ? null : current));
          }}
          status={editableStatus}
          hasContent={contentSummary.hasContent}
          conflict={conflict !== null}
          busy={creatingTemplate}
          error={actionError?.scope === "saveTemplate" ? actionError.text : null}
          onConfirm={(input) => void handleSaveAsTemplate(input)}
        />
      )}
      <EditorFillPanel
        open={fillOpen && isDraft && hasFields && !isTemplate}
        onOpenChange={(next) => {
          setFillOpen(next);
          if (!next) {
            setConfirmFinalize(false);
            setActionError(null);
          }
        }}
        users={activeUsers}
        usersLoading={usersLoading}
        employeeId={employeeId}
        onEmployeeChange={(id) => {
          setEmployeeId(id);
          setActionError(null);
          setConfirmFinalize(false);
        }}
        fieldCount={contentSummary.fieldKeys.length}
        sensitiveCount={sensitiveKeys.length}
        previewBusy={previewBusy}
        finalizing={finalizing}
        previewChecked={previewChecked}
        blockReason={fillBlock}
        error={panelError}
        confirming={confirmFinalize}
        onPreview={() => void handlePreview(employeeId)}
        onAskFinalize={() => setConfirmFinalize(true)}
        onCancelFinalize={() => setConfirmFinalize(false)}
        onFinalize={() => void handleFinalize()}
      />
      <EditorPreviewDialog url={previewUrl} onClose={closePreview} resolved={previewResolved} />
    </div>
  );
}

function summarize(json: EditorJsonNode) {
  return { hasContent: hasMeaningfulContent(json), fieldKeys: collectFieldKeys(json) };
}
