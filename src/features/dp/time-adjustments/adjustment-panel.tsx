"use client";

import { useState, type ReactNode } from "react";

import { errorMessageOf } from "@/components/patterns/panel-form";
import { PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

import { AdjustmentDayOverview } from "./adjustment-day-view";
import { operationsHeadline, pendingOperations, type AdjustmentDayContext } from "./day-summary";
import { ADJUSTMENT_KIND_LABELS, ADJUSTMENT_STATUS_LABELS, type AdjustmentView } from "./types";

type Kind = AdjustmentView["kind"];
type Marking = { receiptId: string; markedAt: string; nsr: number; treatment?: "original" | "discarded" | "included" };
type Request = <T>(input: string, init: { method?: string; json?: unknown; fallbackError: string }) => Promise<T>;

const clock = (markedAt: string) => markedAt.slice(11, 16);
const brDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">{label}</p><div className="mt-0.5 text-[13px] font-semibold text-ds-ink">{children}</div></div>;
}

/** Antes, pedido e depois: a original fica guardada; desconsiderada aparece riscada e a incluída em verde. */
export function AdjustmentComparison({ originals, kind, targetReceiptId, newMarkedAt, scope = "official" }: {
  originals: Marking[]; kind: Kind; targetReceiptId: string | null; newMarkedAt: string | null; scope?: "official" | "pilot";
}) {
  const before = originals.filter((item) => item.treatment !== "included");
  const discarded = kind !== "include" && targetReceiptId ? before.find((item) => item.receiptId === targetReceiptId) ?? null : null;
  const after = [...before.filter((item) => item.receiptId !== discarded?.receiptId && item.treatment !== "discarded").map((item) => ({ time: clock(item.markedAt), state: "original" })),
    ...(newMarkedAt && kind !== "discard" ? [{ time: clock(newMarkedAt), state: "included" }] : [])].sort((left, right) => left.time.localeCompare(right.time));
  const chip = (time: string, state: string, key: string) => (
    <span key={key} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-ds-mono text-[13px] font-bold",
      state === "discarded" ? "border-ds-danger/30 bg-ds-danger-bg text-ds-danger line-through"
        : state === "included" ? "border-ds-ok/30 bg-ds-ok-bg text-ds-ok" : "border-ds-border bg-ds-surface text-ds-ink")}>
      {time}{state === "discarded" ? <span className="font-ds text-[10px] no-underline">desconsiderada</span> : null}
      {state === "included" ? <span className="font-ds text-[10px]">incluída</span> : null}
    </span>
  );
  const row = (label: string, items: ReactNode[]) => (
    <div className="space-y-1.5"><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">{label}</p>
      <div className="flex flex-wrap gap-1.5">{items.length ? items : <span className="text-xs text-ds-ink-muted">Nenhuma batida</span>}</div></div>
  );
  return (
    <div className="space-y-3">
      {row("Antes (registro original, fica guardado)", before.map((item) => chip(clock(item.markedAt), "original", item.receiptId)))}
      {row("Pedido", [
        ...(discarded ? [chip(clock(discarded.markedAt), "discarded", "d")] : []),
        ...(newMarkedAt && kind !== "discard" ? [chip(clock(newMarkedAt), "included", "i")] : []),
      ])}
      {row(scope === "pilot" ? "Resultado da simulação (sem efeito no ponto)" : "Depois, se aprovado (o que vale no fechamento)",
        after.map((item, index) => chip(item.time, item.state, `a${index}`)))}
    </div>
  );
}

function AdjustmentOperationsComparison({ originals, adjustment }: { originals: Marking[]; adjustment: AdjustmentView }) {
  const operations = adjustment.operations?.length ? adjustment.operations : [{ kind: adjustment.kind, target: adjustment.target, inclusion: adjustment.inclusion }];
  const before = originals.filter((item) => item.treatment !== "included");
  const discarded = new Set(operations.flatMap((item) => item.target && item.kind !== "include" ? [item.target.receiptId] : []));
  const included = operations.flatMap((item) => item.inclusion && item.kind !== "discard" ? [item.inclusion.markedAt] : []);
  const after = [...before.filter((item) => !discarded.has(item.receiptId) && item.treatment !== "discarded").map((item) => clock(item.markedAt)), ...included.map(clock)].sort();
  const chips = (items: Array<{ time: string; state?: "discarded" | "included" }>) => <div className="flex flex-wrap gap-1.5">{items.map((item, index) => (
    <span key={`${item.time}-${index}`} className={cn("rounded-full border px-2 py-0.5 font-ds-mono text-[13px] font-bold",
      item.state === "discarded" ? "border-ds-danger/30 bg-ds-danger-bg text-ds-danger line-through" : item.state === "included" ? "border-ds-ok/30 bg-ds-ok-bg text-ds-ok" : "border-ds-border bg-ds-surface text-ds-ink")}>{item.time}</span>
  ))}</div>;
  return <div className="space-y-3">
    <Field label="Antes">{chips(before.map((item) => ({ time: clock(item.markedAt) })))}</Field>
    <Field label="Pedido">{chips(operations.flatMap((item) => [...(item.target ? [{ time: clock(item.target.markedAt), state: "discarded" as const }] : []), ...(item.inclusion ? [{ time: clock(item.inclusion.markedAt), state: "included" as const }] : [])]))}</Field>
    <Field label={adjustment.scope === "pilot" ? "Resultado simulado (sem efeito)" : "Depois, se aprovado"}>{chips(after.map((time) => ({ time })))}</Field>
  </div>;
}

/** Contexto do pedido para quem analisa: quanto tempo depois do dia foi feito e o histórico recente da pessoa. */
export function requestContextText(adjustment: AdjustmentView, day: AdjustmentDayContext) {
  const requestedAt = adjustment.acts[0]?.at;
  const parts: string[] = [];
  if (requestedAt) {
    const utc = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
    const late = Math.round((utc(new Date(requestedAt).toLocaleDateString("en-CA")) - utc(adjustment.workDate)) / 86_400_000);
    parts.push(late <= 0 ? "Pedido feito no mesmo dia." : `Pedido feito ${late === 1 ? "1 dia" : `${late} dias`} depois.`);
  }
  const others = day.history.otherRequestsSameDay;
  parts.push(others === 0 ? `Nenhum outro pedido para ${adjustment.workDate.split("-").reverse().slice(0, 2).join("/")}.` : `${others} ${others === 1 ? "outro pedido" : "outros pedidos"} para este dia.`);
  const approved = day.history.approvedInPrevious30Days;
  parts.push(`Nos 30 dias anteriores: ${approved === 0 ? "nenhum ajuste aprovado" : `${approved} ${approved === 1 ? "ajuste aprovado" : "ajustes aprovados"}`}.`);
  return parts.join(" ");
}

/**
 * Relatório do pedido: com o dia carregado, mostra o dia inteiro (linha do dia, resultado, batidas); sem ele, o
 * antigo × novo só da batida do pedido. Depois vêm a justificativa e a trilha de autoria com códigos encadeados.
 */
export function AdjustmentReport({ adjustment, originals, names, day, dayLoading = false }: {
  adjustment: AdjustmentView; originals: Marking[]; names?: Map<string, string>; day?: AdjustmentDayContext | null; dayLoading?: boolean;
}) {
  const who = (uid: string, role: string) => role === "titular" ? `${adjustment.employeeName ?? "Titular"} (titular)` : `${names?.get(uid) ?? "Responsável"} (análise)`;
  const operations = adjustment.operations?.length ? adjustment.operations : [{ kind: adjustment.kind, target: adjustment.target, inclusion: adjustment.inclusion }];
  const trail = (
    <ol className="space-y-3 text-sm">
      {adjustment.acts.map((act) => (
        <li key={act.hash} className="flex gap-2.5">
          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", act.action === "approved" ? "bg-ds-ok" : act.action === "rejected" ? "bg-ds-danger" : "bg-ds-ink")} aria-hidden />
          <div>
            <p className="font-bold text-ds-ink">{act.action === "requested" ? "Solicitado" : act.action === "approved" ? "Aprovado" : act.action === "rejected" ? "Recusado" : "Cancelado"} por {who(act.actorUid, act.role)}</p>
            <p className="text-xs text-ds-ink-muted">{brDateTime(act.at)} · {act.clockSource === "hora_legal" ? "hora oficial" : "relógio do servidor"} · login autenticado</p>
            {act.reason && act.action !== "requested" ? <p className="text-xs text-ds-ink-2">Justificativa: {act.reason}</p> : null}
            <p className="font-ds-mono text-[11px] text-ds-ink-faint">verificação {act.hash.slice(0, 4)}…{act.hash.slice(-4)}{act.previousHash ? " · encadeada à anterior" : ""}</p>
          </div>
        </li>
      ))}
      {adjustment.status === "in_review" ? <li className="text-xs text-ds-ink-muted">Aguardando decisão do gestor ou do DP.</li> : null}
          </ol>
  );
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><StatusPill variant={adjustment.status === "approved" ? "ok" : adjustment.status === "in_review" ? "info" : "neutral"}>
          {adjustment.scope === "pilot" && adjustment.status === "approved" ? "Simulação aprovada · sem efeito no ponto" : ADJUSTMENT_STATUS_LABELS[adjustment.status]}</StatusPill>
          {adjustment.scope === "pilot" ? <StatusPill variant="warn">Simulação do ensaio</StatusPill> : null}
          {day ? <StatusPill variant="neutral">{operationsHeadline(pendingOperations(adjustment))}</StatusPill> : null}</div>
        <span className="font-ds-mono text-[11px] text-ds-ink-faint">{adjustment.id.slice(0, 10)}</span>
      </div>
      {day ? <AdjustmentDayOverview adjustment={adjustment} day={day} /> : dayLoading ? (
        <PanelSection title="O dia em uma linha"><p className="text-sm text-ds-ink-muted">Carregando o dia inteiro…</p></PanelSection>
      ) : (
        <PanelSection title="Antigo × novo">
          <AdjustmentOperationsComparison originals={originals} adjustment={adjustment} />
        </PanelSection>
      )}
      <PanelSection title="Dados do pedido">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Batidas originais">{operations.flatMap((item) => item.target ? [`${clock(item.target.markedAt)} · ${adjustment.scope === "pilot" ? "sequência" : "NSR"} ${adjustment.scope === "pilot" ? item.target.pilotSequence : item.target.nsr}`] : []).join("; ") || "— (inclusão)"}</Field>
          <Field label="Horários novos">{operations.flatMap((item) => item.inclusion ? [clock(item.inclusion.markedAt)] : []).join("; ") || "— (só desconsiderar)"}</Field>
          <Field label="Tratamento">{adjustment.kind === "include" ? "Inclusão" : adjustment.kind === "discard" ? "Desconsideração" : "Desconsideração + inclusão"}</Field>
          <Field label="Dia">{adjustment.workDate.split("-").reverse().join("/")}</Field>
          <div className="col-span-2"><Field label="Justificativa"><span className="whitespace-pre-wrap font-normal">{adjustment.reason}</span></Field></div>
          {day ? <p className="col-span-2 text-xs text-ds-ink-muted">{requestContextText(adjustment, day)}</p> : null}
        </div>
      </PanelSection>
      <PanelSection title="Trilha de autoria">
        {day ? (
          <details>
            <summary className="cursor-pointer text-sm font-bold text-ds-ink">Ver trilha e verificação</summary>
            <div className="mt-3">{trail}</div>
          </details>
        ) : trail}
      </PanelSection>
      <p className={cn("text-xs", adjustment.scope === "pilot" ? "font-semibold text-ds-warn" : "text-ds-ink-muted")}>
        {adjustment.scope === "pilot" ? "Simulação segregada: a decisão não cria tratamento e não altera ponto, banco, espelho, folha, AFD ou AEJ."
          : "A batida original continua guardada no registro oficial; o ajuste aparece no espelho e no documento de fechamento do mês."}
      </p>
    </>
  );
}

/** Pedido de ajuste pelo titular: escolher, justificar, conferir o resumo e enviar; depois mostra o relatório. */
export function AdjustmentRequestPanel({ open, workDate, originals, request, scope = "official", onClose, onSubmitted }: {
  open: boolean; workDate: string; originals: Marking[]; request: Request; scope?: "official" | "pilot"; onClose: () => void; onSubmitted: (adjustment: AdjustmentView) => void;
}) {
  const effective = originals.filter((item) => item.treatment !== "discarded" && item.treatment !== "included");
  const [step, setStep] = useState<"form" | "summary" | "done">("form");
  const [kind, setKind] = useState<Kind>(effective.length % 2 === 1 ? "include" : "correct");
  const [targetId, setTargetId] = useState<string | null>(effective.at(-1)?.receiptId ?? null);
  const [newTime, setNewTime] = useState("");
  const [reason, setReason] = useState("");
  const [attemptId] = useState(() => crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<AdjustmentView | null>(null);
  const needsTarget = kind !== "include";
  const needsTime = kind !== "discard";
  const valid = (!needsTarget || Boolean(targetId)) && (!needsTime || /^\d{2}:\d{2}$/.test(newTime)) && reason.trim().length >= 10;
  const draftNew = needsTime && newTime ? `${workDate}T${newTime}:00` : null;

  async function send() {
    setSending(true);
    setError(null);
    try {
      const result = await request<{ adjustment: AdjustmentView }>("/api/dp/time-recording/adjustments", { method: "POST",
        json: { attemptId, workDate, kind, ...(needsTarget ? { targetReceiptId: targetId } : {}), ...(needsTime ? { newTime } : {}), reason: reason.trim(), scope },
        fallbackError: "Não foi possível enviar o pedido de ajuste." });
      setSaved(result.adjustment);
      setStep("done");
      onSubmitted(result.adjustment);
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível enviar o pedido de ajuste."));
    } finally {
      setSending(false);
    }
  }

  return (
    <SidePanel open={open} onOpenChange={(next) => { if (!next && !sending) onClose(); }} kicker={workDate.split("-").reverse().join("/")}
      title={step === "done" ? (scope === "pilot" ? "Simulação enviada" : "Pedido de ajuste enviado") : (scope === "pilot" ? "Simular ajuste" : "Pedir ajuste de ponto")}
      subtitle={scope === "pilot" ? "O DP testa a análise; nenhuma decisão altera o ponto oficial." : "Quem decide é o seu gestor ou o DP. A batida original nunca é apagada."}>
      {step === "done" && saved ? <AdjustmentReport adjustment={saved} originals={originals} /> : (
        <>
          <ol className="flex items-center gap-2 text-xs font-bold" aria-label="Etapas do pedido">
            {([["form", "1 · O que corrigir"], ["summary", "2 · Resumo e envio"]] as const).map(([key, label], index) => (
              <li key={key} className="flex items-center gap-2">
                {index ? <span className="h-px w-6 bg-ds-border" aria-hidden /> : null}
                <span className={cn("rounded-full px-2.5 py-1", step === key ? "bg-ds-ink text-white" : "bg-ds-warm text-ds-ink-muted")}>{label}</span>
              </li>
            ))}
          </ol>
          {step === "form" ? (
            <>
              <PanelSection title="O que aconteceu?">
                <div className="space-y-2">
                  {(Object.keys(ADJUSTMENT_KIND_LABELS) as Kind[]).map((key) => (
                    <label key={key} className={cn("flex cursor-pointer gap-3 rounded-ds-md border px-3 py-2.5", kind === key ? "border-ds-ink bg-ds-warm" : "border-ds-border")}>
                      <input type="radio" name="adjust-kind" className="mt-1" checked={kind === key} disabled={key !== "include" && !effective.length} onChange={() => setKind(key)} />
                      <span><span className="block text-sm font-bold text-ds-ink">{ADJUSTMENT_KIND_LABELS[key].title}</span>
                        <span className="block text-xs text-ds-ink-muted">{ADJUSTMENT_KIND_LABELS[key].hint}</span></span>
                    </label>
                  ))}
                </div>
              </PanelSection>
              {needsTarget ? (
                <PanelSection title="Qual batida?">
                  <div className="flex flex-wrap gap-2">
                    {effective.map((marking, index) => (
                      <button key={marking.receiptId} type="button" onClick={() => setTargetId(marking.receiptId)}
                        className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ds-mono text-sm font-bold",
                          targetId === marking.receiptId ? "border-ds-ink bg-ds-ink text-white" : "border-ds-border text-ds-ink")}>
                        {index + 1}ª · {clock(marking.markedAt)}
                      </button>
                    ))}
                  </div>
                </PanelSection>
              ) : null}
              {needsTime ? (
                <PanelSection title={kind === "include" ? "Horário que faltou" : "Horário certo"}>
                  <input type="time" aria-label="Horário" value={newTime} onChange={(event) => setNewTime(event.target.value)}
                    className="h-11 w-full rounded-ds-btn border border-ds-border bg-ds-surface px-3 text-sm text-ds-ink" />
                  <p className="text-xs text-ds-ink-muted">Informe o horário real. O sistema não sugere nem preenche horário.</p>
                </PanelSection>
              ) : null}
              <PanelSection title="Justificativa" aside="obrigatória">
                <textarea rows={4} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)}
                  className="w-full rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2 text-sm text-ds-ink"
                  placeholder="Ex.: o celular descarregou na saída; saí às 16:20 com a gerente." />
                <p className="text-xs text-ds-ink-muted">{reason.trim().length} caracteres · mínimo 10. {scope === "pilot"
                  ? "O texto fica somente na simulação e não entra em arquivo oficial."
                  : "Os primeiros 150 vão para o arquivo oficial do fechamento; o texto completo fica no pedido."} Não descreva diagnóstico.</p>
              </PanelSection>
              <Button type="button" variant="primary-modal" disabled={!valid} onClick={() => setStep("summary")}>Concluir</Button>
            </>
          ) : (
            <>
              <PanelSection title="Antigo × novo">
                <AdjustmentComparison originals={originals} kind={kind} targetReceiptId={needsTarget ? targetId : null} newMarkedAt={draftNew} scope={scope} />
              </PanelSection>
              <PanelSection title="Resumo">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Pedido">{ADJUSTMENT_KIND_LABELS[kind].title}</Field>
                  <Field label="Dia">{workDate.split("-").reverse().join("/")}</Field>
                  <div className="col-span-2"><Field label="Justificativa"><span className="whitespace-pre-wrap font-normal">{reason.trim()}</span></Field></div>
                </div>
                <p className={cn("rounded-ds-md px-3 py-2 text-xs", scope === "pilot" ? "bg-ds-warn-bg text-ds-warn" : "bg-ds-info-bg text-ds-info")}>
                  {scope === "pilot" ? "SIMULAÇÃO: o pedido e a decisão ficam separados do PTRP e não produzem tratamento, banco, espelho, folha, AFD ou AEJ."
                    : "O pedido fica registrado em seu nome, com data e hora oficiais. A batida original não é apagada: se aprovado, ela fica marcada como desconsiderada e o horário novo entra como incluído, com a sua justificativa."}
                </p>
              </PanelSection>
              {error ? <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p> : null}
              <div className="flex gap-2">
                <Button type="button" variant="ds-secondary" disabled={sending} onClick={() => setStep("form")}>Voltar e editar</Button>
                <Button type="button" variant="primary-modal" className="flex-1" loading={sending} loadingLabel="Enviando…" onClick={() => void send()}>Enviar pedido de ajuste</Button>
              </div>
            </>
          )}
        </>
      )}
    </SidePanel>
  );
}
