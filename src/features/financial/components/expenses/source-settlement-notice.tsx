"use client";

import Link from "next/link";
import { formatCurrency } from "../../lib/utils";
import type { SourceSettlement } from "../../lib/source-settlement";

export function SourceSettlementNotice({ source, cancelled = false }: {
  source: SourceSettlement & { closureId?: string }; cancelled?: boolean;
}) {
  const cash = source.kind === "cash_withdrawal";
  const pending = source.kind === "acquirer_fee" && source.phase && source.phase !== "settled";
  const [year, month, day] = (source.settledOn ?? source.expectedOn ?? "").split("-");
  const href = cash
    ? `/dashboard/financial/cash-closures/${encodeURIComponent(source.unitId)}/${year}/${Number(month)}/${Number(day)}`
    : "/dashboard/financial/stone-receipts";
  return <section className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/40 p-3 text-sm">
    <p className="font-semibold">{cancelled ? "Vínculo estornado na origem" : cash ? "Quitada por sangria em espécie" : pending ? source.estimated ? "Taxa estimada · a descontar do recebível" : "Taxa apurada · a descontar do recebível" : "Taxa retida pela adquirente"}</p>
    <p>{formatCurrency(source.amountCents / 100)} · competência {source.competenceMonth} · {pending ? "crédito previsto" : "origem"} {source.settledOn ?? source.expectedOn ?? "a confirmar"}.</p>
    <p className="text-muted-foreground">{cash ? "Esta saída já está descontada do dinheiro esperado do PDV." : pending ? "O crédito ainda não foi confirmado. A taxa será retida no recebível; não é um boleto ou transferência a pagar." : "O efeito da taxa já está no recebimento líquido."} Não há um segundo pagamento bancário nem confirmação de crédito pelo extrato.</p>
    <Link className="underline" href={href}>Ver origem e corrigir classificação</Link>
  </section>;
}
