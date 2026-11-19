"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { PanelErrorNote, PanelSelectField } from "@/components/patterns/panel-form";
import { SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  OCCURRENCE_CHANNELS, OCCURRENCE_OUTCOMES, OCCURRENCE_REASONS,
  type FeeOccurrenceChannel, type FeeOccurrenceOutcome, type FeeOccurrenceReason,
} from "./fee-occurrence";

/** Hoje no fuso do negócio (America/Fortaleza, UTC−3), no formato do campo de data. */
export const todayBusinessDay = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const optionsOf = (labels: Record<string, string>) => Object.entries(labels).map(([id, name]) => ({ id, name }));

type FrameProps = {
  kicker: string; title: string; summary: ReactNode; submitLabel: string; onClose: () => void;
  onSubmit: () => Promise<string | null>; children: ReactNode; aside?: ReactNode;
};

/** Moldura comum dos painéis: resumo do item, campos, erro junto do formulário e uma ação principal (docs/design/painel-lateral.md). */
function SheetFrame({ kicker, title, summary, submitLabel, onClose, onSubmit, children, aside }: FrameProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); setError(null);
    try { const problem = await onSubmit(); if (problem) setError(problem); }
    catch (caught) { setError(caught instanceof Error && caught.message ? caught.message : "Não foi possível gravar."); }
    finally { setSubmitting(false); }
  };
  return <SidePanel open onOpenChange={open => { if (!open && !submitting) onClose(); }} kicker={kicker} title={title} compact>
    <form onSubmit={submit} className="flex flex-1 flex-col gap-3.5">
      <div className="rounded-ds-btn-lg border border-ds-border bg-ds-surface px-4 py-3 text-[13px] leading-relaxed">{summary}</div>
      {children}
      <PanelErrorNote message={error} />
      {aside}
      <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
        <Button type="button" variant="ds-secondary" size="md" disabled={submitting} onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="primary-modal" size="md" loading={submitting} loadingLabel="Gravando…">{submitLabel}</Button>
      </div>
    </form>
  </SidePanel>;
}

export function NewRateSheet({ summary, defaultDate, onClose, onSubmit }: { summary: ReactNode; defaultDate: string; onClose: () => void; onSubmit: (input: { effectiveFrom: string; note: string | null }) => Promise<string | null> }) {
  const [date, setDate] = useState(defaultDate);
  const [note, setNote] = useState("");
  return <SheetFrame kicker="Taxas · mudança de taxa" title="Confirmar nova taxa" summary={summary} submitLabel="Confirmar nova taxa" onClose={onClose}
    onSubmit={async () => date ? onSubmit({ effectiveFrom: date, note: note.trim() || null }) : "Informe a data de início da nova taxa."}>
    <Field label="Início da nova taxa" htmlFor="new-rate-date" hint="A taxa vale como referência do grupo a partir desta data."><Input id="new-rate-date" type="date" className={fieldInputClass} value={date} onChange={event => setDate(event.target.value)} required /></Field>
    <Field label="Observação" requirement="opcional" htmlFor="new-rate-note"><Textarea id="new-rate-note" rows={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Ex.: reajuste informado pela Stone" /></Field>
    <p className="text-xs text-ds-ink-muted">Se esta não for a taxa correta, feche e use Contestar: o item vira uma ocorrência acompanhada com a Stone.</p>
  </SheetFrame>;
}

export function ContestSheet({ summary, onClose, onSubmit }: { summary: ReactNode; onClose: () => void; onSubmit: (input: { reason: FeeOccurrenceReason; note: string | null; protocol: string | null }) => Promise<string | null> }) {
  const [reason, setReason] = useState<FeeOccurrenceReason | "">("");
  const [note, setNote] = useState("");
  const [protocol, setProtocol] = useState("");
  return <SheetFrame kicker="Taxas · contestar" title="Contestar com a Stone" summary={summary} submitLabel="Abrir ocorrência" onClose={onClose}
    onSubmit={async () => reason ? onSubmit({ reason, note: note.trim() || null, protocol: protocol.trim() || null }) : "Escolha o motivo da contestação."}>
    <PanelSelectField id="contest-reason" label="Motivo" value={reason} onChange={value => setReason(value as FeeOccurrenceReason)} options={optionsOf(OCCURRENCE_REASONS)} />
    <Field label="Observação para o contato com a Stone" requirement="opcional" htmlFor="contest-note"><Textarea id="contest-note" rows={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></Field>
    <Field label="Protocolo" requirement="opcional agora" htmlFor="contest-protocol" hint="Informe quando a Stone gerar. É obrigatório para finalizar a ocorrência."><Input id="contest-protocol" className={fieldInputClass} value={protocol} maxLength={40} onChange={event => setProtocol(event.target.value)} /></Field>
    <p className="text-xs text-ds-ink-muted">O item sai de “A decidir” e entra em Ocorrências como <b>Aberta</b>.</p>
  </SheetFrame>;
}

export function ContactSheet({ summary, defaultProtocol, onClose, onSubmit, onFinish }: { summary: ReactNode; defaultProtocol: string | null; onClose: () => void; onFinish: () => void;
  onSubmit: (input: { contactDate: string; channel: FeeOccurrenceChannel; protocol: string | null; note: string | null }) => Promise<string | null> }) {
  const [date, setDate] = useState(todayBusinessDay());
  const [channel, setChannel] = useState<FeeOccurrenceChannel>("phone");
  const [protocol, setProtocol] = useState(defaultProtocol ?? "");
  const [note, setNote] = useState("");
  return <SheetFrame kicker="Taxas · ocorrência" title="Registrar contato" summary={summary} submitLabel="Salvar contato" onClose={onClose}
    onSubmit={async () => onSubmit({ contactDate: date, channel, protocol: protocol.trim() && protocol.trim() !== defaultProtocol ? protocol.trim() : null, note: note.trim() || null })}
    aside={<Button type="button" variant="ds-link" size="xs" className="self-start px-0" onClick={onFinish}>Finalizar esta ocorrência</Button>}>
    <Field label="Data do contato" htmlFor="contact-date"><Input id="contact-date" type="date" className={fieldInputClass} value={date} onChange={event => setDate(event.target.value)} required /></Field>
    <PanelSelectField id="contact-channel" label="Canal" value={channel} onChange={value => setChannel(value as FeeOccurrenceChannel)} options={optionsOf(OCCURRENCE_CHANNELS)} />
    <Field label="Protocolo" htmlFor="contact-protocol" hint={defaultProtocol ? undefined : "Informe o protocolo quando a Stone gerar."}><Input id="contact-protocol" className={fieldInputClass} value={protocol} maxLength={40} onChange={event => setProtocol(event.target.value)} /></Field>
    <Field label="O que a Stone respondeu" requirement="opcional" htmlFor="contact-note"><Textarea id="contact-note" rows={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></Field>
  </SheetFrame>;
}

const parseReais = (text: string) => { const value = Number(text.replace(/\./g, "").replace(",", ".")); return Number.isFinite(value) ? Math.round(value * 100) : NaN; };

export function CloseSheet({ summary, defaultProtocol, defaultRefundCents, onClose, onSubmit }: { summary: ReactNode; defaultProtocol: string | null; defaultRefundCents: number; onClose: () => void;
  onSubmit: (input: { outcome: FeeOccurrenceOutcome; refundedCents: number | null; resolvedOn: string; protocol: string | null; note: string | null }) => Promise<string | null> }) {
  const [outcome, setOutcome] = useState<FeeOccurrenceOutcome>("refunded");
  const [refund, setRefund] = useState((Math.abs(defaultRefundCents) / 100).toFixed(2).replace(".", ","));
  const [protocol, setProtocol] = useState(defaultProtocol ?? "");
  const [date, setDate] = useState(todayBusinessDay());
  const [note, setNote] = useState("");
  return <SheetFrame kicker="Taxas · ocorrência" title="Finalizar ocorrência" summary={summary} submitLabel="Finalizar ocorrência" onClose={onClose}
    onSubmit={async () => {
      const cents = outcome === "refunded" ? parseReais(refund) : null;
      if (outcome === "refunded" && (cents === null || !Number.isFinite(cents) || cents <= 0)) return "Informe o valor devolvido.";
      if (!protocol.trim()) return "Informe o protocolo para finalizar.";
      return onSubmit({ outcome, refundedCents: cents, resolvedOn: date, protocol: protocol.trim() !== defaultProtocol ? protocol.trim() : null, note: note.trim() || null });
    }}>
    <div role="radiogroup" aria-label="Resultado" className="space-y-1.5">
      <p className="text-xs font-bold text-ds-ink-2">Resultado</p>
      {(Object.keys(OCCURRENCE_OUTCOMES) as FeeOccurrenceOutcome[]).map(value => <button key={value} type="button" role="radio" aria-checked={outcome === value} onClick={() => setOutcome(value)}
        className={`flex h-10 w-full items-center rounded-ds-md border px-3 text-left text-[13px] font-bold ${outcome === value ? "border-ds-accent bg-ds-accent-soft text-ds-accent-ink" : "border-ds-border-input bg-ds-surface text-ds-ink-2 hover:bg-ds-muted"}`}>{OCCURRENCE_OUTCOMES[value]}</button>)}
    </div>
    {outcome === "refunded" ? <Field label="Valor devolvido (R$)" htmlFor="close-refund"><Input id="close-refund" inputMode="decimal" className={fieldInputClass} value={refund} onChange={event => setRefund(event.target.value)} /></Field> : null}
    <Field label="Protocolo" requirement="obrigatório para finalizar" htmlFor="close-protocol"><Input id="close-protocol" className={fieldInputClass} value={protocol} maxLength={40} onChange={event => setProtocol(event.target.value)} /></Field>
    <Field label="Data da resposta" htmlFor="close-date"><Input id="close-date" type="date" className={fieldInputClass} value={date} onChange={event => setDate(event.target.value)} required /></Field>
    <Field label="Observação" requirement="opcional" htmlFor="close-note"><Textarea id="close-note" rows={2} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></Field>
    <p className="text-xs text-ds-ink-muted">Ao finalizar, a ocorrência fica em Finalizadas com o resultado registrado.</p>
  </SheetFrame>;
}
