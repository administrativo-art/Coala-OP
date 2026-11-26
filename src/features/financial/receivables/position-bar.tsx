"use client";

import { useEffect, useMemo, useState } from "react";
import { SidePanel, PanelSection } from "@/components/patterns/side-panel";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import type { parseStoneWalletPosition } from "@/lib/integrations/stone/wallet-position-parser";
import { centsLabel } from "../receipts-reconciliation/stone-account-format";
import { natureLabel, rightsByNature, type NatureKey } from "./receivable-view";

export type RightsPosition = Pick<ReturnType<typeof parseStoneWalletPosition>,
  "referenceDate" | "status" | "rows" | "unknownNatureCount">;

// Cores categóricas validadas (dataviz validate_palette: PASS), na ordem fixa das naturezas.
const NATURE_COLOR: Record<NatureKey, string> = {
  regular: "#2a78d6", stone_anticipation: "#eb6834", warranty: "#1baf7a", ownership_assignment: "#eda100", unknown: "#5f646c",
};
const date = (value: string | null) => value ? value.split("-").reverse().join("/") : "—";

/**
 * Barra e cartões da posição da Stone por natureza (livre, já antecipado, em garantia, cedido).
 * A Stone informa só o total por arranjo, para a carteira toda; por isso não depende do mês escolhido.
 * Usada em A receber e em Recebido.
 */
export function StonePositionBar({ position, className }: { position: RightsPosition | null; className?: string }) {
  const [nature, setNature] = useState<NatureKey | null>(null);
  const natures = useMemo(() => position?.status === "reported" ? rightsByNature(position.rows) : [], [position]);
  const natureTotal = natures.reduce((sum, item) => sum + item.cents, 0);
  const selectedNature = natures.find(item => item.key === nature) ?? null;
  return <div className={`space-y-3 ${className ?? ""}`}>
    {position?.status === "reported" && natureTotal > 0 ? <>
      <div className="flex h-[22px] gap-0.5 overflow-hidden rounded-full bg-ds-surface" role="img" aria-label="Posição da Stone por natureza">
        {natures.filter(item => item.cents > 0).map(item => <i key={item.key} title={`${natureLabel[item.key]}: ${centsLabel(item.cents)}`} className="block h-full" style={{ width: `${(item.cents / natureTotal * 100).toFixed(2)}%`, background: NATURE_COLOR[item.key] }} />)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {natures.map(item => <button key={item.key} type="button" onClick={() => setNature(item.key)}
          className="rounded-ds-btn-lg border border-ds-border bg-ds-surface px-4 py-3 text-left transition-colors hover:bg-ds-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink">
          <span className="flex items-center gap-1.5 text-[13px] text-ds-ink-2"><i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: NATURE_COLOR[item.key] }} />{natureLabel[item.key]}</span>
          <span className="mt-1 block tabular-nums text-[19px] font-bold text-ds-ink">{centsLabel(item.cents)}</span>
          <span className="block text-xs text-ds-ink-muted">{Math.round(item.cents / natureTotal * 100)}% da posição · ver detalhe</span>
        </button>)}
      </div>
      <p className="text-xs text-ds-ink-muted">Posição informada pela Stone em {date(position.referenceDate)}, para a carteira toda. A Stone não separa essa posição por mês nem diz quais parcelas estão antecipadas, em garantia ou cedidas.</p>
    </> : <p className="text-xs text-ds-ink-muted">{position?.status === "not_provided" ? "A Stone não incluiu a posição por natureza no último arquivo. Isso não comprova saldo zero."
      : position?.status === "empty" ? "A posição por natureza veio vazia no último arquivo. Isso não comprova saldo zero."
        : "A posição por natureza (livre, antecipado, garantia, cedido) ainda não foi lida."}</p>}

    <SidePanel open={selectedNature !== null} onOpenChange={value => { if (!value) setNature(null); }} kicker="Posição da Stone por natureza"
      title={selectedNature ? `${natureLabel[selectedNature.key]} · ${centsLabel(selectedNature.cents)}` : ""}
      subtitle={position ? `Informado em ${date(position.referenceDate)} · carteira toda` : undefined}>
      {selectedNature ? <PanelSection title="Por bandeira e produto" aside={`${selectedNature.rows.length} linha(s)`}>
        {selectedNature.rows.length ? <ul className="divide-y divide-ds-divider">{selectedNature.rows.map(row => <li key={`${row.label}:${row.category}`} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
          <span><span className="font-semibold text-ds-ink">{row.label}</span><span className="block text-xs text-ds-ink-faint">{row.category}</span></span>
          <span className="tabular-nums font-bold">{centsLabel(row.cents)}</span></li>)}</ul>
          : <p className="text-sm text-ds-ink-muted">Nada informado nesta natureza.</p>}
        <p className="text-xs text-ds-ink-muted">A Stone informa o total por arranjo; não diz quais parcelas da tabela compõem este valor.</p>
      </PanelSection> : null}
    </SidePanel>
  </div>;
}

/** Posição da Stone para telas que não carregam a carteira: lê a posição e mostra a mesma barra de A receber. */
export function StonePositionOverview({ stoneCode }: { stoneCode: string }) {
  const api = useAuthenticatedApi();
  const [position, setPosition] = useState<RightsPosition | null>(null);
  useEffect(() => {
    if (!stoneCode) return;
    let active = true;
    api<{ rightsPosition?: RightsPosition | null }>(`/api/financial/stone-portfolio?stoneCode=${encodeURIComponent(stoneCode)}`)
      .then(value => { if (active) setPosition(value.rightsPosition ?? null); })
      .catch(() => { if (active) setPosition(null); });
    return () => { active = false; };
  }, [api, stoneCode]);
  return <section aria-label="Posição da Stone" className="rounded-ds-card border border-ds-border bg-ds-surface p-4 sm:px-[18px]"><StonePositionBar position={position} /></section>;
}
