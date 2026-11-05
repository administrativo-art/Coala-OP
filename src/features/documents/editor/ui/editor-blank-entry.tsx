"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

import { createBlankEditorDocument, createEditorTemplate, toEditorFailure } from "./editor-client";
import { BLANK_TEMPLATE_NAME } from "./template-logic";

export const BLANK_DOCUMENT_TITLE = "Documento sem título";

function EntryCard({ id, title, children, actions }: { id: string; title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col justify-between gap-4 rounded-ds-card border border-ds-border bg-ds-surface p-6">
      <div className="space-y-1">
        <h2 id={id} className="text-lg font-extrabold text-ds-ink">
          {title}
        </h2>
        <div className="max-w-2xl text-[13px] text-ds-ink-muted">{children}</div>
      </div>
      <div className="space-y-2">{actions}</div>
    </section>
  );
}

function ErrorText({ id, text }: { id: string; text: string | null }) {
  return text ? (
    <p id={id} role="alert" className="text-xs font-semibold text-ds-danger">
      {text}
    </p>
  ) : null;
}

/**
 * Entrada do editor com três caminhos: documento em branco (usar agora), usar um modelo publicado e
 * criar um modelo. O titular nunca é escolhido aqui. Os dois botões de criar são idempotentes: a mesma
 * tentativa reaproveita o identificador e a rota devolve o mesmo registro em vez de duplicar.
 */
export function EditorBlankEntry() {
  const router = useRouter();
  const request = useAuthenticatedApi();
  const { permissions, isDefaultAdmin, loading } = useAuth();
  const canGenerate = hasFormalizationPermission(permissions, "documents.generate", isDefaultAdmin);
  const [creating, setCreating] = useState<"document" | "template" | null>(null);
  const [errors, setErrors] = useState<{ document: string | null; template: string | null }>({ document: null, template: null });
  const requestIds = useRef<{ document: string | null; template: string | null }>({ document: null, template: null });

  async function create(kind: "document" | "template") {
    if (creating) return;
    setErrors({ document: null, template: null });
    setCreating(kind);
    requestIds.current[kind] ??= crypto.randomUUID();
    const clientRequestId = requestIds.current[kind]!;
    try {
      if (kind === "document") {
        const { document } = await createBlankEditorDocument(request, { clientRequestId, title: BLANK_DOCUMENT_TITLE });
        router.push(`/dashboard/documents/editor/${encodeURIComponent(document.id)}`);
      } else {
        const { template } = await createEditorTemplate(request, { clientRequestId, name: BLANK_TEMPLATE_NAME });
        router.push(`/dashboard/documents/editor/templates/${encodeURIComponent(template.id)}`);
      }
    } catch (failure) {
      setErrors((current) => ({ ...current, [kind]: toEditorFailure(failure).message }));
      setCreating(null);
    }
  }

  if (loading) {
    return (
      <p role="status" className="text-sm text-ds-ink-muted">
        Carregando permissões…
      </p>
    );
  }
  if (!canGenerate) {
    return (
      <p role="alert" className="rounded-ds-card border border-ds-confirm-border bg-ds-confirm-bg px-5 py-4 text-sm font-semibold text-ds-confirm-ink">
        Você não tem permissão para gerar documentos. Peça o acesso a quem administra o seu perfil.
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <EntryCard
        id="editor-blank-title"
        title="Documento em branco"
        actions={
          <>
            <Button
              type="button"
              variant="primary-page"
              size="md"
              loading={creating === "document"}
              loadingLabel="Criando documento…"
              disabled={creating !== null}
              aria-describedby={errors.document ? "editor-blank-error" : undefined}
              onClick={() => void create("document")}
            >
              Criar documento em branco
            </Button>
            <ErrorText id="editor-blank-error" text={errors.document} />
          </>
        }
      >
        Escreva um documento livre, com títulos, listas, tabelas e campos do sistema, e use agora. A prévia e o PDF saem com o
        timbre do Coala. Não vira modelo e fica como rascunho até ser finalizado.
      </EntryCard>

      <EntryCard
        id="editor-use-template-title"
        title="Usar um modelo"
        actions={
          <Button asChild type="button" variant="ds-secondary" size="md">
            <Link href="/dashboard/documents/editor/templates">Ver modelos publicados</Link>
          </Button>
        }
      >
        Escolha um modelo publicado da empresa. O sistema cria um rascunho com o texto do modelo; depois você preenche e
        finaliza como em qualquer documento.
      </EntryCard>

      <EntryCard
        id="editor-create-template-title"
        title="Modelo reutilizável"
        actions={
          <>
            <Button
              type="button"
              variant="ds-secondary"
              size="md"
              loading={creating === "template"}
              loadingLabel="Criando modelo…"
              disabled={creating !== null}
              aria-describedby={errors.template ? "editor-template-error" : undefined}
              onClick={() => void create("template")}
            >
              Criar modelo
            </Button>
            <ErrorText id="editor-template-error" text={errors.template} />
          </>
        }
      >
        Crie um texto para ser reutilizado por todas as unidades. O modelo não tem titular e não deve conter nomes, CPFs ou
        outros dados de pessoas; use os campos do sistema no lugar. Só a versão publicada pode ser usada.
      </EntryCard>
    </div>
  );
}
