"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, FileText, FolderOpen } from "lucide-react";

import { ListShell, ListSkeleton } from "@/components/cadastros/cadastros-ui";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { LiftRow } from "@/components/patterns/lift-row";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { saveFile } from "@/features/dp/rep-p/marking-ui";
import { useAuth } from "@/hooks/use-auth";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { groupOwnDocumentsByFolder } from "@/features/hr/documents/own-document-folders";
import type { EmployeeDossierFolder } from "@/lib/hr/employee-document-folder-templates";

type OwnDocument = {
  id: string;
  displayName: string;
  documentType: string | null;
  documentTypeCode: string | null;
  category: string | null;
  destinationTrail: string[];
  mimeType: string | null;
  publishedAt: string | null;
};
const dateBR = (value: string | null) => value ? value.slice(0, 10).split("-").reverse().join("/") : "";

/**
 * Macro 02, a própria pasta: só os documentos publicados para a pessoa (espelho e contracheque assinados, recibos,
 * termos). O servidor filtra pelo titular e pela publicação; nada de outra pessoa nem de uso interno do DP aparece.
 */
export function OwnDocumentsPage() {
  const { firebaseUser } = useAuth();
  const [documents, setDocuments] = useState<OwnDocument[] | null>(null);
  const [templateFolders, setTemplateFolders] = useState<EmployeeDossierFolder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const getIdToken = useCallback(() => firebaseUser?.getIdToken() ?? Promise.resolve(null), [firebaseUser]);
  const folders = useMemo(() => groupOwnDocumentsByFolder(documents ?? [], templateFolders), [documents, templateFolders]);

  useEffect(() => {
    if (!firebaseUser) return;
    authenticatedApiRequest<{ documents: OwnDocument[]; folderProfile?: { folders?: EmployeeDossierFolder[] } | null }>("/api/collaborator/documents", { getIdToken, fallbackError: "Não foi possível carregar seus documentos." })
      .then((response) => {
        setDocuments(response.documents);
        setTemplateFolders(Array.isArray(response.folderProfile?.folders) ? response.folderProfile.folders : []);
      })
      .catch((cause) => setError(errorMessageOf(cause, "Não foi possível carregar seus documentos.")));
  }, [firebaseUser, getIdToken]);

  async function open(document: OwnDocument) {
    setBusyId(document.id);
    setError(null);
    try {
      const blob = await authenticatedApiRequest<Blob>("/api/collaborator/documents/access", { method: "POST", json: { id: document.id, action: "download" }, responseType: "blob",
        getIdToken, fallbackError: "Não foi possível abrir o documento." });
      saveFile(new File([blob], `${document.displayName}.${document.mimeType === "application/pdf" ? "pdf" : "arquivo"}`, { type: document.mimeType ?? "application/pdf" }));
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível abrir o documento."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PageContainer variant="compact" className="space-y-5 py-6">
      <div><p className="mb-1 text-xs font-black uppercase tracking-wide text-ds-accent-ink">02 · Documentos do colaborador</p>
        <PageHeader title="Meus documentos" description="Documentos que o Departamento Pessoal liberou para você: espelho de ponto e contracheque assinados, recibos e termos." /></div>
      {error ? <p role="alert" className="text-sm font-semibold text-ds-danger">{error}</p> : null}
      {!documents && !error ? <ListSkeleton rows={4} /> : null}
      {documents && !documents.length && !folders.length ? <p className="rounded-ds-card border border-dashed border-ds-border-input px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhum documento liberado ainda. Quando o DP liberar um documento para você, ele aparece aqui.</p> : null}
      {folders.length ? <div className="space-y-4">
        {folders.map((folder) => (
          <section key={folder.key} className="overflow-hidden rounded-ds-card border border-ds-border bg-white">
            <header className="flex items-center gap-2 border-b border-ds-divider bg-ds-warm px-4 py-3 text-sm font-black text-ds-ink">
              <FolderOpen className="h-4 w-4 shrink-0 text-ds-accent-ink" />
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {folder.path.map((segment, index) => <span key={`${segment}:${index}`} className="contents">
                  {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ds-ink-muted" /> : null}
                  <span>{segment}</span>
                </span>)}
              </span>
            </header>
            <ListShell minWidth={0}>
              {folder.documents.length ? folder.documents.map((document) => (
                <LiftRow key={document.id} table className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <FileText className="h-4 w-4 shrink-0 text-ds-ink-muted" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-ds-ink">{document.displayName}</span>
                      <span className="block text-xs text-ds-ink-muted">{document.documentType ?? "Documento"}{document.publishedAt ? ` · liberado em ${dateBR(document.publishedAt)}` : ""}</span>
                    </span>
                  </span>
                  <Button variant="ds-secondary" size="sm" loading={busyId === document.id} loadingLabel="Abrindo…" onClick={() => void open(document)}>Baixar</Button>
                </LiftRow>
              )) : <p className="px-4 py-5 text-sm text-ds-ink-muted">Pasta criada — nenhum documento liberado ainda.</p>}
            </ListShell>
          </section>
        ))}
      </div> : null}
    </PageContainer>
  );
}
