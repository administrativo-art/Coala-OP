"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { SidePanel } from "@/components/patterns/side-panel";

import { SAVE_AS_TEMPLATE_NOTICE, getSaveAsTemplateBlockReason } from "./template-logic";

const MAX_NAME = 200;
const MAX_DESCRIPTION = 1000;

/**
 * "Salvar como modelo": copia o texto salvo do documento para um modelo do sistema (sem titular).
 * Pede nome e exige a ciência do aviso de privacidade antes de confirmar. O documento não é alterado.
 */
export function EditorSaveAsTemplatePanel({
  open,
  onOpenChange,
  status,
  hasContent,
  conflict,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: string;
  hasContent: boolean;
  conflict: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (input: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const ids = useId();
  const noticeId = `${ids}-notice`;
  const reasonId = `${ids}-reason`;
  const block = getSaveAsTemplateBlockReason({ status, hasContent, conflict, name, acknowledged });

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        // A ciência vale para uma abertura: ao fechar, volta a ser exigida.
        if (!next) setAcknowledged(false);
        onOpenChange(next);
      }}
      kicker="Documento"
      title="Salvar como modelo"
      subtitle="Cria um modelo reutilizável com o texto salvo deste documento. O documento não é alterado."
      compact
    >
      <p className="text-xs text-ds-ink-muted">
        O modelo vale para todas as unidades da empresa, não tem titular e começa como rascunho: só a versão publicada por quem
        revisa documentos pode ser usada.
      </p>

      <Field label="Nome do modelo" htmlFor={`${ids}-name`}>
        <input
          id={`${ids}-name`}
          type="text"
          value={name}
          maxLength={MAX_NAME}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          aria-describedby={block && name.trim().length === 0 ? reasonId : undefined}
          className={fieldInputClass}
        />
      </Field>

      <Field label="Descrição" requirement="opcional" htmlFor={`${ids}-description`}>
        <textarea
          id={`${ids}-description`}
          value={description}
          maxLength={MAX_DESCRIPTION}
          rows={3}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
          className={`${fieldInputClass} h-auto py-2`}
        />
      </Field>

      <div role="note" id={noticeId} className="rounded-ds-btn border border-ds-alert-border bg-ds-alert-bg px-4 py-3 text-[13px] font-semibold text-ds-alert-ink">
        {SAVE_AS_TEMPLATE_NOTICE}
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id={`${ids}-ack`}
          checked={acknowledged}
          disabled={busy}
          onCheckedChange={(checked) => setAcknowledged(checked === true)}
          aria-describedby={noticeId}
          className="mt-0.5"
        />
        <label htmlFor={`${ids}-ack`} className="text-[13px] font-semibold text-ds-ink">
          Li o aviso e revisei o texto: ele não contém nomes, CPFs ou outros dados de pessoas.
        </label>
      </div>

      {block ? (
        <p id={reasonId} className="text-xs text-ds-ink-muted">
          {block}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-ds-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary-page"
          size="md"
          loading={busy}
          loadingLabel="Criando modelo…"
          disabled={block !== null || busy}
          aria-describedby={block ? reasonId : undefined}
          onClick={() => onConfirm({ name: name.trim(), description: description.trim() })}
        >
          Criar modelo
        </Button>
        <Button type="button" variant="ds-secondary" size="md" disabled={busy} onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
      </div>
    </SidePanel>
  );
}
