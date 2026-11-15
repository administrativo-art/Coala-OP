"use client";

import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PanelSection } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { stoneAccountTypeName, stoneFeeTypeName } from "@/lib/integrations/stone/stone-codes";
import { belemTime, matchBasisLabel, parcelFeeRate, pdvChannelLabel, pdvStatusLabel, type AuditCheck, type SaleAudit } from "./stone-account";
import { centsLabel, checkView, dayLabel, fullDateLabel, parcelStatusView, rateLabel, stoneLocalDateTimeLabel } from "./stone-account-format";

function Field({ label, field, children, wide }: { label: string; field?: string; children: ReactNode; wide?: boolean }) {
  return <div className={wide ? "sm:col-span-2" : undefined}>
    <dt className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">
      {label}{field ? <span className="ml-1 tabular-nums text-[10.5px] font-medium normal-case tracking-normal">{field}</span> : null}
    </dt>
    <dd className="mt-0.5 wrap-anywhere text-[13px] font-semibold text-ds-ink">{children ?? <span className="text-ds-ink-faint">não informado</span>}</dd>
  </div>;
}
const Mono = ({ children }: { children: ReactNode }) => <span className="tabular-nums">{children}</span>;

function CheckIcon({ check }: { check: AuditCheck }) {
  const view = checkView[check.result];
  return <span aria-label={view.label} className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-extrabold ${view.className}`}>{view.symbol}</span>;
}

function PdvSection({ audit }: { audit: SaleAudit }) {
  const coupon = audit.pdv.coupons[0];
  const aside = audit.pdv.review === "recorded" ? audit.pdv.matchBasis ? `par por ${matchBasisLabel(audit.pdv.matchBasis)}` : "Coala PDV" : "dia não conferido";
  return <PanelSection title="PDV · cupom" aside={aside}>
    {audit.pdv.review === "not_recorded"
      ? <p className="text-sm text-ds-ink-muted">A Conciliação de vendas deste dia ainda não foi registrada. Sem ela, o cupom do PDV não é comparado.</p>
      : !coupon ? <p className="text-sm font-semibold text-ds-danger">Nenhum cupom do PDV encontrado para esta venda no dia.</p>
        : <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field label="Cupom"><Mono>{coupon.couponId}</Mono></Field>
          <Field label="Data e hora"><Mono>{fullDateLabel(audit.saleDate)} {belemTime(coupon.soldAt)}</Mono></Field>
          <Field label="Meio">{pdvChannelLabel(coupon.channel)}</Field>
          <Field label="Valor"><Mono>{centsLabel(audit.pdv.coupons.reduce((sum, row) => sum + row.grossCents, 0))}</Mono></Field>
          <Field label="Status">{pdvStatusLabel(coupon.status)}</Field>
          <Field label="NSU">{coupon.nsu ? <Mono>{coupon.nsu}</Mono> : null}</Field>
          <Field label="Autorização">{coupon.authorizationCode ? <Mono>{coupon.authorizationCode}</Mono> : null}</Field>
          <Field label="Terminal">{coupon.terminalId}</Field>
          <Field label="Pedido">{coupon.merchantOrderId}</Field>
          {audit.pdv.coupons.length > 1 ? <Field label="Pagamentos no par" wide>{audit.pdv.coupons.length} registros do PDV</Field> : null}
        </dl>}
  </PanelSection>;
}

function StoneSaleSection({ audit }: { audit: SaleAudit }) {
  const stone = audit.stone;
  if (audit.source === "pix") {
    return <PanelSection title="Stone · venda" aside="Pix">
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field label="ID Pix" field="e2eId" wide><Mono>{stone.e2eId}</Mono></Field>
        <Field label="ID do evento" field="eventId"><Mono>{stone.eventId}</Mono></Field>
        <Field label="Data e hora"><Mono>{fullDateLabel(audit.saleDate)} {stone.saleTime}</Mono></Field>
        <Field label="Bruto" field="gross"><Mono>{centsLabel(stone.capturedCents)}</Mono></Field>
        <Field label="Arquivo Pix">{stone.originFile ? <Mono>{stone.originFile.id}</Mono> : null}</Field>
      </dl>
    </PanelSection>;
  }
  const events = Object.entries(stone.events).map(([key, value]) => `${key} ${value}`).join(" · ");
  return <PanelSection title="Stone · venda" aside="arquivo de conciliação">
    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      <Field label="Transação" field="AcquirerTransactionKey" wide><Mono>{stone.transactionId}</Mono></Field>
      <Field label="Captura (local)" field="CaptureLocalDateTime"><Mono>{stoneLocalDateTimeLabel(stone.captureLocalDateTime)}</Mono></Field>
      <Field label="Autorização (UTC)" field="AuthorizationDateTime"><Mono>{stoneLocalDateTimeLabel(stone.authorizationDateTimeUtc)}</Mono></Field>
      <Field label="Bandeira" field="BrandId">{stone.brand}{stone.brandCode ? <span className="text-ds-ink-faint"> · {stone.brandCode}</span> : null}</Field>
      <Field label="Tipo de conta" field="AccountType">{stone.accountTypeCode ? `${stoneAccountTypeName(stone.accountTypeCode)} · ${stone.accountTypeCode}` : null}</Field>
      <Field label="Parcelas" field="NumberOfInstallments"><Mono>{stone.installmentCount}</Mono></Field>
      <Field label="Tipo de taxa" field="FeeType">{stoneFeeTypeName(stone.feeTypeCode)}</Field>
      <Field label="Capturado" field="CapturedAmount"><Mono>{centsLabel(stone.capturedCents)}</Mono></Field>
      <Field label="Cancelado" field="CanceledAmount"><Mono>{centsLabel(stone.canceledCents)}</Mono></Field>
      <Field label="Eventos" field="Events" wide>{events || "—"}</Field>
      <Field label="Arquivo de origem" field="FileId" wide>{stone.originFile ? <><Mono>{stone.originFile.id}</Mono><span className="text-ds-ink-faint"> · ref. {dayLabel(stone.originFile.referenceDate)}</span></> : null}</Field>
    </dl>
  </PanelSection>;
}

const ROWS: Array<{ label: string; field: string | null; value: (row: SaleAudit["installments"][number]) => ReactNode }> = [
  { label: "Situação", field: null, value: row => <StatusPill variant={parcelStatusView[row.status].variant}>{parcelStatusView[row.status].label}</StatusPill> },
  { label: "Bruto", field: "GrossAmount", value: row => centsLabel(row.grossCents) },
  { label: "Taxa", field: "MdrAmount", value: row => <>{centsLabel(row.feeCents)}{parcelFeeRate(row) !== null ? <span className="text-ds-ink-faint"> ({rateLabel(parcelFeeRate(row))})</span> : null}{row.feeSource === "exact" ? <span className="mt-1 block text-xs text-ds-ink-faint">Calculada do líquido exato da Stone</span> : null}{row.feeSource === "derived" ? <span className="mt-1 block"><StatusPill variant="warn" title="A Stone não mandou o MDR; taxa proposta = bruto − líquido">Verificar taxa</StatusPill></span> : null}</> },
  { label: "Antecipação", field: "AdvanceRateAmount", value: row => row.anticipationCents ? centsLabel(row.anticipationCents) : "—" },
  { label: "Líquido", field: "NetAmount", value: row => <strong>{centsLabel(row.netCents)}</strong> },
  { label: "Previsto", field: "PrevisionPaymentDate", value: row => fullDateLabel(row.expectedDate) },
  { label: "Pago", field: "PaymentDate", value: row => fullDateLabel(row.paidDate) },
  { label: "Data original", field: "AdvancedReceivableOriginalPaymentDate", value: row => fullDateLabel(row.originalDate) },
  { label: "ID do pagamento", field: "PaymentId", value: row => row.paymentId ?? "—" },
  { label: "Suspenso por chargeback", field: "SuspendedByChargeback", value: row => row.suspendedByChargeback ? <span className="text-ds-danger">sim</span> : "não" },
  { label: "Arquivo Stone", field: "FileId · ReferenceDate", value: row => row.file ? <>{row.file.id}<span className="block text-[11.5px] text-ds-ink-faint">ref. {dayLabel(row.file.referenceDate)}</span></> : row.status === "missing_file" ? <span className="text-ds-warn">não recebido</span> : "—" },
];

function InstallmentsSection({ audit }: { audit: SaleAudit }) {
  const paid = audit.installments.filter(row => row.paidDate).length;
  return <section data-ui="panel-section" className="rounded-ds-btn-lg border border-ds-border bg-ds-surface">
    <header className="flex items-baseline justify-between gap-3 border-b border-ds-divider px-4 py-2.5">
      <h3 className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Stone · {audit.installments.length > 1 ? "parcelas" : "pagamento na conta Stone"}</h3>
      <span className="text-[11.5px] text-ds-ink-faint">{paid} de {audit.installments.length} paga(s)</span>
    </header>
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead><tr className="bg-ds-muted">
          <th scope="col" className="px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">Campo</th>
          {audit.installments.map(row => <th key={row.number} scope="col" className="whitespace-nowrap px-3 py-2 text-right text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">{audit.installments.length > 1 ? `Parcela ${row.number}/${audit.stone.installmentCount}` : "Pagamento"}</th>)}
        </tr></thead>
        <tbody>{ROWS.map(item => <tr key={item.label} className="border-t border-ds-divider">
          <th scope="row" className="px-3 py-2 text-left font-normal text-ds-ink-muted">{item.label}{item.field ? <span className="block tabular-nums text-[10.5px] text-ds-ink-faint">{item.field}</span> : null}</th>
          {audit.installments.map(row => <td key={row.number} className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${item.field ? "tabular-nums" : ""}`}>{item.value(row)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

/** Auditoria da venda: dados de origem primeiro; os 12 cruzamentos só com o resultado. */
export function SaleAuditSummary({ audit, checks, onDetail }: { audit: SaleAudit; checks: AuditCheck[]; onDetail: () => void }) {
  const ok = checks.filter(check => check.result === "ok").length;
  return <>
    <div className="grid gap-4 lg:grid-cols-2"><PdvSection audit={audit} /><StoneSaleSection audit={audit} /></div>
    <InstallmentsSection audit={audit} />
    <PanelSection title={`Cruzamentos · ${ok} de ${checks.length} ok`} aside={<Button type="button" variant="ds-secondary" size="xs" onClick={onDetail}>Detalhar cruzamento<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" /></Button>}>
      <ul className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">{checks.map(check =>
        <li key={check.id} className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink"><CheckIcon check={check} /><span>{check.id}. {check.title}</span></li>)}
      </ul>
    </PanelSection>
    <p className="text-xs text-ds-ink-muted">O pagamento na conta Stone é comprovado pelo arquivo de conciliação da Stone. O extrato da própria conta Stone ainda não está no sistema.</p>
  </>;
}

/** Detalhe do cruzamento: o que foi comparado, lado a lado, e o motivo quando não confere. */
export function SaleAuditDetail({ checks, onBack }: { checks: AuditCheck[]; onBack: () => void }) {
  return <>
    <div><Button type="button" variant="ds-secondary" size="sm" onClick={onBack}><ArrowLeft aria-hidden="true" className="h-4 w-4" />Voltar aos dados da venda</Button></div>
    <section className="rounded-ds-btn-lg border border-ds-border bg-ds-surface">
      <header className="flex items-baseline justify-between gap-3 border-b border-ds-divider px-4 py-2.5">
        <h3 className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">O que foi comparado</h3>
        <span className="text-[11.5px] text-ds-ink-faint">{checks.filter(check => check.result === "ok").length} de {checks.length} ok</span>
      </header>
      <ol className="divide-y divide-ds-divider">{checks.map(check =>
        <li key={check.id} className={`grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 px-4 py-3.5 ${check.result === "bad" ? "bg-ds-confirm-bg" : check.result === "warn" ? "bg-ds-alert-bg" : ""}`}>
          <CheckIcon check={check} />
          <div>
            <p className="text-sm font-extrabold text-ds-ink">{check.id}. {check.title}</p>
            <p className="text-xs text-ds-ink-muted">{check.compared}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {[["PDV / esperado", check.pdv], ["Stone", check.stone]].map(([label, value]) =>
                <div key={label} className="rounded-ds-sm border border-ds-divider bg-ds-input px-2.5 py-1.5">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">{label}</p>
                  <p className="wrap-anywhere tabular-nums text-[12.5px] font-semibold text-ds-ink">{value}</p>
                </div>)}
            </div>
            {check.note ? <p className={`mt-1.5 text-xs font-semibold ${check.result === "bad" ? "text-ds-danger" : check.result === "warn" ? "text-ds-alert-ink" : "text-ds-info"}`}>{check.note}</p> : null}
          </div>
        </li>)}
      </ol>
    </section>
  </>;
}
