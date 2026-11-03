"use client";

import { useEffect, useRef, useState } from "react";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchPersonInventory, fetchPersonInventorySource } from "@/features/privacy/client";
import type { Source } from "@/features/privacy/person-inventory";
import { readSubjectRef, type SubjectRef } from "@/features/privacy/person-subject";
import type { PersonInventoryCatalog, PersonInventoryPage, PersonInventorySource } from "@/features/privacy/types";
import { useAuth } from "@/hooks/use-auth";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { sortByTitle, type TitleSortDirection } from "@/lib/sort-by-title";
import { PersonReferenceFields, personNamespaceLabels } from "./person-reference-fields";

const sourceLabels: Record<string, string> = {
  accounts: "Contas do sistema", employees: "Cadastros RH", candidates: "Candidaturas",
  "generated-document-parties": "Documentos gerados — participantes", "signature-parties": "Assinaturas — participantes",
  "generated-documents": "Documentos gerados", "generated-document-actors": "Documentos gerados — autores",
  "employee-documents": "Documentos de colaboradores", "employee-document-uploaders": "Documentos de colaboradores — responsáveis pelo envio",
  "signature-requests": "Solicitações de assinatura", "signature-signers": "Assinaturas — signatários", "signature-actors": "Assinaturas — autores",
  "onboarding-persons": "Pessoas em admissão", onboarding: "Integrações admissionais", "onboarding-candidates": "Integrações admissionais — candidaturas", "onboarding-users": "Integrações admissionais — contas",
  vacations: "Férias", terminations: "Desligamentos", "collaborator-requests": "Solicitações de colaboradores", "absence-requests": "Solicitações de ausência",
  "uniform-assignments": "Entregas de uniformes", "asset-custody": "Patrimônio — guarda recebida (histórico)", "asset-former-custody": "Patrimônio — guarda anterior (histórico)", "asset-current-custody": "Patrimônio — guarda atual", "asset-legacy-responsible": "Patrimônio — referência legada", "inventory-cursor-subjects": "Continuações privadas — titulares", "inventory-cursor-actors": "Continuações privadas — operadores", "privacy-requests": "Pedidos de titulares", "privacy-request-actors": "Pedidos de titulares — autores",
  "image-voice-consents": "Consentimentos de imagem e voz", "schedule-index": "Escalas — índice por pessoa",
  "rep-p-receipts": "Ponto — comprovantes", "rep-p-pilot-markings": "Ponto — marcações piloto", "rep-p-offline-cycles": "Ponto — ciclos offline",
  "rep-p-location-evidence": "Ponto — evidências de localização", "rep-p-journey-location": "Ponto — localização da jornada", "rep-p-adjustments": "Ponto — ajustes",
  "rep-p-pilot-adjustments": "Ponto — ajustes piloto", "rep-p-automatic-absences": "Ponto — ausências automáticas", "rep-p-treatments": "Ponto — tratamentos",
  "rep-p-classification-requests": "Ponto — solicitações de classificação", "rep-p-classifications": "Ponto — classificações",
  "financial-vacation-expenses": "Financeiro — despesas de férias", "financial-vacation-payments": "Financeiro — pagamentos de férias", "financial-salary-payments": "Financeiro — pagamentos de salários", "financial-termination-payments": "Financeiro — pagamentos de desligamento",
  "audit-actors": "Auditoria — ações da pessoa", "audit-targets": "Auditoria — alvos legados", integrations: "Atualizações de cadastro RH",
};
const roleLabels: Record<Source["role"], string> = { subject: "Titular", owner: "Responsável pela guarda", actor: "Autor da ação", signer: "Signatário", participant: "Participante" };
const databaseLabels = { main: "Sistema", hr: "RH", financial: "Financeiro", "rep-p": "Ponto" };
const statusLabels: Record<PersonInventoryPage["status"], string> = { restricted: "Sem permissão", unlinked: "Sem vínculo confirmado", unavailable: "Consulta indisponível", partial: "Cobertura parcial", complete: "Consulta concluída", failed: "Falha na consulta" };
const conflictLabels: Record<string, string> = {
  candidate_missing: "Candidatura não encontrada", user_missing: "Conta do sistema não encontrada", employee_missing: "Cadastro RH não encontrado",
  candidate_user_collision: "Candidatura associada a mais de uma conta", candidate_not_reciprocal: "Vínculo com candidatura não confirmado nos dois sentidos",
  employee_uid_collision: "Mais de um cadastro RH aponta para a conta", employee_claim_collision: "Mais de uma conta aponta para o cadastro RH",
  employee_uid_conflict: "Identificadores de conta divergentes no RH", employee_not_reciprocal: "Vínculo com cadastro RH não confirmado nos dois sentidos", user_not_reciprocal: "Vínculo com conta não confirmado nos dois sentidos",
};
type SourceState = { page?: PersonInventoryPage; error?: string; loading?: boolean };
function sourceTitle(source: PersonInventorySource) {
  // Restricted catalog entries intentionally expose only the opaque source ID.
  return source.coverage === "restricted" ? `Origem restrita (${source.id})` : sourceLabels[source.id] ?? source.collection;
}
function message(error: unknown) {
  if (error instanceof AuthenticatedApiError && error.status === 403) return "Sem permissão para este cadastro ou escopo. A consulta não foi realizada.";
  return error instanceof Error ? error.message : "Falha na consulta. Tente novamente.";
}

export function PersonInventoryPanel({ open, onOpenChange, initialRef }: {
  open: boolean; onOpenChange: (open: boolean) => void; initialRef: SubjectRef | null;
}) {
  const { firebaseUser } = useAuth();
  const [namespace, setNamespace] = useState("main.users");
  const [id, setId] = useState("");
  const [catalog, setCatalog] = useState<PersonInventoryCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [sources, setSources] = useState<Record<string, SourceState>>({});
  const [direction, setDirection] = useState<TitleSortDirection>("asc");
  const generation = useRef(0);
  const controllers = useRef(new Set<AbortController>());

  function invalidate() {
    generation.current += 1;
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    setCatalog(null); setCatalogError(null); setSelected(null); setSources({}); setLoading(false);
  }

  async function consult(ref: SubjectRef) {
    if (!firebaseUser) return;
    invalidate();
    const key = generation.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    setLoading(true);
    try {
      const result = await fetchPersonInventory(firebaseUser, ref, controller.signal);
      if (key === generation.current) setCatalog(result);
    } catch (error) {
      if (key === generation.current && !controller.signal.aborted) setCatalogError(message(error));
    } finally {
      controllers.current.delete(controller);
      if (key === generation.current) setLoading(false);
    }
  }

  useEffect(() => {
    // A new opening/identity owns a fresh generation; closed panels cannot receive old results.
    generation.current += 1;
    const activeControllers = controllers.current;
    activeControllers.forEach((controller) => controller.abort()); activeControllers.clear();
    setCatalog(null); setCatalogError(null); setSelected(null); setSources({}); setLoading(false);
    setNamespace(initialRef?.namespace ?? "main.users"); setId(initialRef?.id ?? ""); setDirection("asc");
    if (open && initialRef) void consult(initialRef);
    return () => { generation.current += 1; activeControllers.forEach((controller) => controller.abort()); activeControllers.clear(); };
    // The opening is keyed by immutable identity, not the parent object's allocation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialRef?.namespace, initialRef?.id, firebaseUser]);

  async function loadSource(sourceId: string, cursor?: string) {
    if (!firebaseUser || !catalog || sources[sourceId]?.loading) return;
    const key = generation.current;
    const controller = new AbortController(); controllers.current.add(controller);
    setSources((current) => ({ ...current, [sourceId]: { ...current[sourceId], loading: true, error: undefined } }));
    try {
      const page = await fetchPersonInventorySource(firebaseUser, catalog.ref, sourceId, controller.signal, cursor);
      if (key !== generation.current) return;
      setSources((current) => ({ ...current, [sourceId]: page.status === "failed"
        ? { ...current[sourceId], loading: false, error: page.reason ?? "Falha na consulta. Tente novamente." }
        : { loading: false, page: { ...page, items: cursor ? [...(current[sourceId]?.page?.items ?? []), ...page.items].filter((item, index, all) => all.findIndex((entry) => entry.recordPath === item.recordPath && entry.database === item.database) === index) : page.items } } }));
    } catch (error) {
      if (key === generation.current && !controller.signal.aborted) setSources((current) => ({ ...current, [sourceId]: { ...current[sourceId], loading: false, error: message(error) } }));
    } finally { controllers.current.delete(controller); }
  }

  function submitLookup() {
    const ref = readSubjectRef({ namespace, id: id.trim() });
    if (!ref) { setCatalogError("Informe a origem e um identificador válido, sem barras (até 180 caracteres)."); return; }
    void consult(ref);
  }
  const source = catalog?.sources.find((entry) => entry.id === selected);
  const state = selected ? sources[selected] : undefined;
  const page = state?.page;

  return <SidePanel open={open} onOpenChange={(value) => { if (!value) invalidate(); onOpenChange(value); }} kicker="Privacidade · consulta por pessoa" title="Consultar dados" subtitle="Referências autorizadas por cadastro e origem.">
    <p className="text-xs leading-5 text-ds-ink-muted">Consulta de referências no escopo permitido de workspace e unidade. Titular, responsável pela guarda, autor e signatário são papéis diferentes. O inventário não comprova cobertura de todo o histórico. Alterar o identificador aqui não altera o vínculo de um pedido.</p>
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); submitLookup(); }}>
      <PersonReferenceFields prefix="inventory" namespace={namespace} id={id} onChange={(nextNamespace, nextId) => { invalidate(); setNamespace(nextNamespace); setId(nextId); }} />
      <Button type="submit" variant="primary-modal" size="md" loading={loading} loadingLabel="Consultando…">Consultar cadastro</Button>
    </form>
    {loading ? <p role="status" className="text-sm">Carregando catálogo de origens…</p> : null}
    {catalogError ? <div role="alert" className="space-y-2 text-sm text-ds-confirm-ink"><p>{catalogError}</p><Button type="button" variant="ds-secondary" size="sm" onClick={submitLookup}>Tentar consulta novamente</Button></div> : null}
    {catalog ? <>
      <section aria-label="Escopo e vínculos" className="space-y-2 rounded-ds-card border border-ds-border p-4 text-xs leading-5">
        <p className="font-bold">Referências confirmadas nesta consulta</p>
        <ul className="space-y-1">{catalog.equivalents.map((ref) => <li key={`${ref.namespace}:${ref.id}`} className="break-all">{personNamespaceLabels[ref.namespace]} · {ref.id}</li>)}</ul>
        <p>Não há correspondência por nome, CPF ou e-mail. Fontes restritas, não consultadas ou com lacunas não comprovam ausência de dados.</p>
        {catalog.conflicts.length ? <div role="note" className="text-ds-warn"><p className="font-bold">Conflitos de vínculo: cobertura parcial</p><ul>{catalog.conflicts.map((conflict) => <li key={conflict}>{conflictLabels[conflict] ?? "Vínculo não confirmado; requer revisão do cadastro."}</li>)}</ul></div> : null}
      </section>
      <section aria-label="Origens de dados" className="space-y-3">
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold">Escolha uma origem</h3><Button variant="ds-link" size="xs" onClick={() => setDirection((current) => current === "asc" ? "desc" : "asc")} aria-label={`Ordenar origens: ${direction === "asc" ? "A–Z" : "Z–A"}`}>{direction === "asc" ? "A–Z ↓" : "Z–A ↑"}</Button></div>
        <p className="text-xs text-ds-ink-muted">As origens são consultadas somente ao selecionar. Cada página contém até 25 referências.</p>
        <Field label="Origem dos dados" htmlFor="inventory-source">
          <Select value={selected ?? ""} onValueChange={(sourceId) => { setSelected(sourceId); if (!sources[sourceId]) void loadSource(sourceId); }}>
            <SelectTrigger id="inventory-source" className={fieldInputClass}><SelectValue placeholder="Selecione uma origem para consultar" /></SelectTrigger>
            <SelectContent>{sortByTitle(catalog.sources, sourceTitle, direction).map((entry) => <SelectItem key={entry.id} value={entry.id} disabled={entry.coverage === "restricted"}>{sourceTitle(entry)} · {entry.coverage === "restricted" ? "Sem permissão" : sources[entry.id]?.page ? statusLabels[sources[entry.id].page!.status] : sources[entry.id]?.error ? "Falha na consulta" : "Não consultada"}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <p className="text-xs text-ds-ink-muted">{catalog.sources.filter((entry) => entry.coverage === "restricted").length} origens sem permissão; não foram consultadas. Acesso de Privacidade não concede acesso a todas as origens.</p>
      </section>
      {source && source.coverage !== "restricted" ? <section aria-label="Resultado da origem" className="space-y-3 rounded-ds-card border border-ds-border p-4">
        <h3 className="text-sm font-bold">{sourceTitle(source)}</h3>
        <p className="text-xs text-ds-ink-muted">{databaseLabels[source.database]} · {roleLabels[source.role]}</p>
        {state?.loading ? <p role="status" className="text-sm">Consultando origem…</p> : null}
        {state?.error ? <div role="alert" className="space-y-2 text-sm text-ds-confirm-ink"><p>{state.error}</p><p>A consulta não foi concluída; as referências já carregadas permanecem abaixo.</p><Button variant="ds-secondary" size="sm" onClick={() => void loadSource(source.id, page?.nextCursor ?? undefined)}>Tentar origem novamente</Button></div> : null}
        {page ? <>
          <StatusPill variant={page.status === "complete" ? "ok" : page.status === "restricted" ? "neutral" : "warn"}>{page.nextCursor ? "Há mais referências" : statusLabels[page.status]}</StatusPill>
          {page.reason ? <p className="text-xs leading-5 text-ds-warn">{page.reason}</p> : null}
          {page.status === "restricted" ? <p className="text-sm">Sem permissão. Esta origem não foi consultada.</p> : page.status === "unlinked" ? <p className="text-sm">O vínculo com o cadastro exigido por esta origem não foi confirmado. Não é possível concluir ausência de registros.</p> : page.status === "unavailable" ? <p className="text-sm">Esta origem ainda não permite consulta segura por ID. Cobertura pendente.</p> : null}
          {(page.status === "complete" || page.status === "partial") && page.items.length === 0 && !state?.error ? <p className="text-sm">{page.nextCursor ? "Nenhuma referência permitida nesta página. Continue para consultar as próximas referências." : <>Nenhuma referência encontrada nesta consulta autorizada.{page.status === "partial" ? " O histórico permanece parcialmente coberto." : " Isso não comprova ausência em outras origens."}</>}</p> : null}
          <ol className="space-y-3">{page.items.map((item) => <li key={`${item.database}:${item.recordPath}`} className="space-y-2 border-t border-ds-divider pt-3 text-xs">
            <p className="break-all font-bold">Registro {item.id}</p><p>{databaseLabels[item.database]} · {roleLabels[item.role]}{item.version !== null ? ` · versão ${item.version}` : ""}</p>
            <details><summary className="cursor-pointer font-semibold text-ds-accent-ink">Referências para auditoria</summary><div className="mt-2 space-y-2 break-all"><p>{item.recordPath}</p>{Object.entries(item.links).map(([field, value]) => <p key={field}>{field}: {value}</p>)}{item.storageReferences.map((reference) => <p key={reference.field}>Arquivo ({reference.field}): {reference.path ?? "referência existente; caminho não exibido"}</p>)}{item.storageReferences.length === 0 ? <p>Este registro não retornou referência de arquivo. Não foi realizado censo do Storage.</p> : null}</div></details>
          </li>)}</ol>
          {page.nextCursor && !state?.error ? <Button variant="ds-secondary" size="md" loading={state?.loading} onClick={() => void loadSource(source.id, page.nextCursor!)}>Carregar mais referências</Button> : null}
          {page.items.length > 0 ? <p className="text-xs text-ds-ink-muted">{page.items.length} referências carregadas, na ordem de identificador da origem.{page.nextCursor ? " Há páginas restantes." : ""}</p> : null}
        </> : null}
      </section> : null}
    </> : null}
  </SidePanel>;
}
