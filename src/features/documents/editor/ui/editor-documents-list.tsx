"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { LiftRow } from "@/components/patterns/lift-row";
import { Segmented } from "@/components/patterns/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

import { listEditorDocuments, toEditorFailure, type EditorDocumentListItem } from "./editor-client";
import {
  DEFAULT_DOCUMENT_FILTER,
  DOCUMENT_EMPTY_TEXT,
  DOCUMENT_LIST_FILTERS,
  DOCUMENT_LIST_PAGE_SIZE,
  appendDocumentPage,
  describeDocumentListFailure,
  documentOriginLabel,
  documentStatusLabel,
  documentStatusParam,
  documentStatusVariant,
  documentVersionLabel,
  type DocumentListFilter,
} from "./document-list-logic";
import { formatEditorDateTime } from "./template-logic";

type ListState =
  | { kind: "loading" }
  | { kind: "forbidden"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: EditorDocumentListItem[]; nextCursor: string | null };

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
 * Documentos do editor. Cada leitura é uma página de no máximo 25 itens por cursor, no workspace do
 * usuário (sem polling nem listener): 1 chamada ao abrir/trocar filtro, +1 por "Carregar mais".
 * A ordem é a do servidor (mais recentemente atualizados primeiro).
 */
export function EditorDocumentsList() {
  const request = useAuthenticatedApi();
  const { permissions, isDefaultAdmin, loading: authLoading } = useAuth();
  const canGenerate = hasFormalizationPermission(permissions, "documents.generate", isDefaultAdmin);
  const [filter, setFilter] = useState<DocumentListFilter>(DEFAULT_DOCUMENT_FILTER);
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const loadToken = useRef(0);
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  });

  const reload = useCallback(() => {
    setState({ kind: "loading" });
    setMoreError(null);
    setReloadKey((key) => key + 1);
  }, []);

  function changeFilter(next: DocumentListFilter) {
    if (next === filter) return;
    setState({ kind: "loading" });
    setMoreError(null);
    setFilter(next);
  }

  useEffect(() => {
    if (authLoading || !canGenerate) return;
    const token = ++loadToken.current;
    listEditorDocuments(requestRef.current, { status: documentStatusParam(filter), limit: DOCUMENT_LIST_PAGE_SIZE })
      .then((page) => {
        if (token === loadToken.current) setState({ kind: "ready", items: page.items, nextCursor: page.nextCursor });
      })
      .catch((error: unknown) => {
        if (token !== loadToken.current) return;
        const failure = describeDocumentListFailure(toEditorFailure(error));
        setState({ kind: failure.kind, message: failure.message });
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
      const page = await listEditorDocuments(request, {
        status: documentStatusParam(filter),
        limit: DOCUMENT_LIST_PAGE_SIZE,
        cursor: state.nextCursor,
      });
      if (token !== loadToken.current) return;
      setState((current) =>
        current.kind === "ready"
          ? { kind: "ready", items: appendDocumentPage(current.items, page.items), nextCursor: page.nextCursor }
          : current,
      );
    } catch (error) {
      if (token === loadToken.current) setMoreError(toEditorFailure(error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  if (authLoading) return <Skeleton className="h-40 w-full" />;
  if (!canGenerate || state.kind === "forbidden") {
    return (
      <Panel title="Sem permissão para os documentos do editor" tone="danger">
        Você precisa da permissão de gerar documentos para ver esta lista.
      </Panel>
    );
  }

  const items = state.kind === "ready" ? state.items : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          aria-label="Filtrar documentos por situação"
          value={filter}
          onChange={changeFilter}
          options={DOCUMENT_LIST_FILTERS.map((option) => ({ value: option.value, label: option.label }))}
        />
        <Button asChild type="button" variant="ds-secondary" size="md">
          <Link href="/dashboard/documents/editor">Criar documento ou modelo</Link>
        </Button>
      </div>

      {state.kind === "loading" ? (
        <div role="status" aria-label="Carregando os documentos" className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : state.kind === "error" ? (
        <Panel title="Não foi possível carregar os documentos" tone="danger">
          <p>{state.message}</p>
          <Button type="button" variant="ds-secondary" size="xs" className="mt-3" onClick={reload}>
            Tentar novamente
          </Button>
        </Panel>
      ) : items.length === 0 ? (
        <p role="status" className="rounded-ds-card border border-dashed border-ds-border-input px-5 py-8 text-center text-[13px] text-ds-ink-muted">
          {DOCUMENT_EMPTY_TEXT[filter]}
        </p>
      ) : (
        <div role="list" aria-label="Documentos do editor" className="rounded-ds-card border border-ds-border bg-ds-surface">
          {items.map((item) => (
            <DocumentRow key={item.id} item={item} />
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

function DocumentRow({ item }: { item: EditorDocumentListItem }) {
  return (
    <LiftRow interactive={false} role="listitem" className="space-y-2" data-testid="editor-document-row">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64 space-y-0.5">
          <p className="break-words text-[14.5px] font-extrabold text-ds-ink">{item.title}</p>
          <p className="text-xs text-ds-ink-muted">
            {documentVersionLabel(item)} · {documentOriginLabel(item.origin)} ·{" "}
            <span data-testid="editor-document-updated-at">Atualizado em {formatEditorDateTime(item.updatedAt)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill variant={documentStatusVariant(item.status)}>{documentStatusLabel(item.status)}</StatusPill>
          {item.isOwn ? <StatusPill variant="neutral">Meu</StatusPill> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild type="button" variant="ds-secondary" size="xs">
          <Link href={`/dashboard/documents/editor/${encodeURIComponent(item.id)}`} aria-label={`Abrir documento ${item.title}`}>
            Abrir
          </Link>
        </Button>
      </div>
    </LiftRow>
  );
}
