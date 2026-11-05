"use client";

import { useMemo, useState } from "react";
import { Eye, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { SidePanel } from "@/components/patterns/side-panel";
import { cn } from "@/lib/utils";

import { filterSubjectOptions, type SubjectOption } from "./editor-logic";

export type FillPanelError = { scope: "preview" | "finalize"; text: string };

/**
 * Etapa "Preencher e finalizar". Painel lateral (padrão de "age sobre o item"): o titular é escolhido
 * aqui, nunca na criação, e vive só no estado da tela. O Radix prende o foco e o devolve ao botão que abriu.
 */
export function EditorFillPanel({
  open,
  onOpenChange,
  users,
  usersLoading,
  employeeId,
  onEmployeeChange,
  fieldCount,
  sensitiveCount,
  previewBusy,
  finalizing,
  previewChecked,
  blockReason,
  error,
  confirming,
  onPreview,
  onAskFinalize,
  onCancelFinalize,
  onFinalize,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: readonly (SubjectOption & { email?: string })[];
  usersLoading: boolean;
  employeeId: string;
  onEmployeeChange: (id: string) => void;
  fieldCount: number;
  sensitiveCount: number;
  previewBusy: boolean;
  finalizing: boolean;
  /** A prévia com dados reais deste titular e desta versão já foi gerada sem campos faltando. */
  previewChecked: boolean;
  blockReason: string | null;
  error: FillPanelError | null;
  confirming: boolean;
  onPreview: () => void;
  onAskFinalize: () => void;
  onCancelFinalize: () => void;
  onFinalize: () => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => filterSubjectOptions(users, query), [users, query]);
  const busy = previewBusy || finalizing;
  const selected = users.find((user) => user.id === employeeId);
  // Mantém o titular escolhido visível mesmo que a busca o esconda.
  const visibleOptions = selected && !options.some((user) => user.id === selected.id) ? [selected, ...options] : options;

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) setQuery("");
        onOpenChange(next);
      }}
      kicker="Documento"
      title="Preencher e finalizar"
      subtitle="Escolha o titular: o sistema preenche os campos com o cadastro dele, você confere a prévia e finaliza."
      compact
    >
      <p className="text-xs text-ds-ink-muted">
        {fieldCount === 1 ? "1 campo do sistema será preenchido." : `${fieldCount} campos do sistema serão preenchidos.`}
        {sensitiveCount > 0 ? " Há dados sensíveis: a prévia e a finalização exigem a permissão específica (verificada no servidor)." : ""}
      </p>

      <Field label="Buscar colaborador" htmlFor="editor-subject-search">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" />
          <input
            id="editor-subject-search"
            type="search"
            value={query}
            disabled={busy || usersLoading}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome do colaborador"
            className={cn(fieldInputClass, "pl-9")}
          />
        </div>
      </Field>

      <Field
        label="Titular do documento"
        htmlFor="editor-subject"
        hint={
          usersLoading
            ? "Carregando colaboradores…"
            : users.length === 0
              ? "Nenhum colaborador ativo disponível para você."
              : options.length === 0
                ? "Nenhum colaborador encontrado para esta busca."
                : `${options.length} ${options.length === 1 ? "colaborador" : "colaboradores"} na lista.`
        }
      >
        <select
          id="editor-subject"
          value={employeeId}
          disabled={busy || usersLoading || users.length === 0}
          onChange={(event) => onEmployeeChange(event.target.value)}
          aria-describedby={blockReason ? "editor-fill-reason" : undefined}
          className={cn(fieldInputClass, "appearance-none")}
        >
          <option value="">Selecione…</option>
          {visibleOptions.map((user) => (
            <option key={user.id} value={user.id}>
              {user.username}
            </option>
          ))}
        </select>
      </Field>

      {blockReason ? (
        <p id="editor-fill-reason" className="text-xs text-ds-ink-muted">
          {blockReason}
        </p>
      ) : previewChecked ? (
        <p role="status" className="text-xs font-semibold text-ds-ok">
          A prévia com os dados deste titular foi gerada e não apontou campos sem valor.
        </p>
      ) : null}

      {error ? (
        <p role="alert" data-scope={error.scope} className="text-xs font-semibold text-ds-danger">
          {error.text}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ds-secondary"
          size="md"
          loading={previewBusy}
          loadingLabel="Gerando prévia…"
          disabled={!employeeId || finalizing || confirming}
          onClick={onPreview}
        >
          <Eye aria-hidden className="mr-2 h-4 w-4" />
          Ver prévia com dados do titular
        </Button>
        <Button
          type="button"
          variant="primary-page"
          size="md"
          disabled={blockReason !== null || confirming || busy}
          aria-describedby={blockReason ? "editor-fill-reason" : undefined}
          onClick={onAskFinalize}
        >
          Finalizar documento
        </Button>
      </div>

      {confirming ? (
        <InlineConfirm
          message="Finalizar este documento para o titular escolhido? Ele deixa de ser editável e o PDF final é gerado e guardado."
          confirmLabel="Finalizar documento"
          loadingLabel="Finalizando…"
          loading={finalizing}
          onConfirm={onFinalize}
          onCancel={onCancelFinalize}
        />
      ) : null}
    </SidePanel>
  );
}
