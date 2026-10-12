"use client";

import React from "react";

import {
  CadastrosHero,
  CadastrosTabs,
  Chevron,
  EmptyResults,
  ListHead,
  ListRow,
  ListShell,
  ListSkeleton,
  SoftPill,
} from "@/components/cadastros/cadastros-ui";
import { buildChips } from "@/components/cadastros/cadastros-utils";
import { CompetitorPriceModal } from "@/components/competitor-price-modal";
import { CompetitorProductModal } from "@/components/competitor-product-modal";
import { LiftRow } from "@/components/patterns/lift-row";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { StatTile } from "@/components/patterns/stat-tile";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useCompetitors } from "@/hooks/use-competitors";
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { cn } from "@/lib/utils";
import type { Competitor, CompetitorGroup, CompetitorProduct } from "@/types";
import {
  CompetitorGroupPanel,
  CompetitorSelectionPanel,
  CompetitorUnitPanel,
  type CompetitorGroupPanelState,
  type CompetitorPanelState,
} from "./competitor-panels";
import {
  GAP_THRESHOLD,
  STALE_DAYS,
  buildComparisonCsv,
  classifyGap,
  competitorAddress,
  correlatedSimulations,
  daysSince,
  groupNameMap,
  latestPriceByProduct,
  marginAtPrice,
  priceGapPercent,
  productsByCompetitor,
  summarizeComparison,
} from "./competitors-model";

type Tab = "comparison" | "units" | "groups" | "products";

const NO_GROUP = "__no_group__";
const UNIT_TEMPLATE = "minmax(220px,1.4fr) minmax(160px,1fr) minmax(220px,1.4fr) 16px";
const GROUP_TEMPLATE = "minmax(260px,1.6fr) 140px 140px 16px";
const PRODUCT_TEMPLATE = "minmax(240px,1.5fr) minmax(170px,1fr) minmax(200px,1.2fr) 130px 16px";

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

function searchKey(value: string | undefined) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
const matches = (query: string, ...fields: Array<string | undefined>) => {
  const needle = searchKey(query.trim());
  return !needle || fields.some((field) => searchKey(field).includes(needle));
};

export function CompetitorsWorkspace() {
  const {
    competitors,
    competitorGroups,
    competitorProducts,
    competitorPrices,
    loading,
    addCompetitorGroup,
    updateCompetitorGroup,
    deleteCompetitorGroup,
    addCompetitor,
    updateCompetitor,
    deleteCompetitor,
    deleteProduct,
  } = useCompetitors();
  const { simulations, loading: loadingSimulations } = useProductSimulation();

  const [tab, setTab] = React.useState<Tab>("comparison");
  const [queries, setQueries] = React.useState<Record<Tab, string>>({ comparison: "", units: "", groups: "", products: "" });
  const [chipByTab, setChipByTab] = React.useState<Record<Tab, string>>({ comparison: "all", units: "all", groups: "all", products: "all" });
  const [selectedCompetitorIds, setSelectedCompetitorIds] = React.useState<string[]>([]);
  const [selectionOpen, setSelectionOpen] = React.useState(false);
  const [unitPanel, setUnitPanel] = React.useState<CompetitorPanelState | null>(null);
  const [groupPanel, setGroupPanel] = React.useState<CompetitorGroupPanelState | null>(null);
  const [openProduct, setOpenProduct] = React.useState<CompetitorProduct | null>(null);
  const [productFormOpen, setProductFormOpen] = React.useState(false);
  const [productToEdit, setProductToEdit] = React.useState<CompetitorProduct | null>(null);
  const [priceProduct, setPriceProduct] = React.useState<CompetitorProduct | null>(null);
  const [confirmingProductDelete, setConfirmingProductDelete] = React.useState(false);
  const [deletingProduct, setDeletingProduct] = React.useState(false);
  const [productError, setProductError] = React.useState<string | null>(null);
  const productDeleteRef = React.useRef<HTMLButtonElement>(null);

  const isLoading = loading || loadingSimulations;
  const groupNames = React.useMemo(() => groupNameMap(competitorGroups), [competitorGroups]);
  const competitorById = React.useMemo(() => new Map(competitors.map((competitor) => [competitor.id, competitor])), [competitors]);
  const simulationById = React.useMemo(() => new Map(simulations.map((simulation) => [simulation.id, simulation])), [simulations]);
  const priceMap = React.useMemo(() => latestPriceByProduct(competitorPrices), [competitorPrices]);
  const productMap = React.useMemo(() => productsByCompetitor(competitorProducts), [competitorProducts]);

  React.useEffect(() => {
    setConfirmingProductDelete(false);
    setProductError(null);
  }, [openProduct]);

  /* ───────── comparativo ───────── */

  const comparisonRows = React.useMemo(
    () => correlatedSimulations(simulations, selectedCompetitorIds, productMap).filter((simulation) => matches(queries.comparison, simulation.name)),
    [simulations, selectedCompetitorIds, productMap, queries.comparison]
  );
  const summary = React.useMemo(
    () => summarizeComparison(comparisonRows, selectedCompetitorIds, productMap, priceMap),
    [comparisonRows, selectedCompetitorIds, productMap, priceMap]
  );

  function exportCsv() {
    const csv = buildComparisonCsv(comparisonRows, selectedCompetitorIds, competitors, productMap, priceMap);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `estudo-de-preco-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /* ───────── listas filtradas ───────── */

  const searchedUnits = React.useMemo(
    () => competitors.filter((competitor) => matches(queries.units, competitor.name, groupNames.get(competitor.competitorGroupId), competitorAddress(competitor))),
    [competitors, queries.units, groupNames]
  );
  const unitChips = React.useMemo(
    () =>
      buildChips(
        searchedUnits.length,
        [
          ...competitorGroups.map((group) => ({ id: group.id, label: group.name, count: searchedUnits.filter((unit) => unit.competitorGroupId === group.id).length })),
          { id: NO_GROUP, label: "Sem grupo", count: searchedUnits.filter((unit) => !groupNames.has(unit.competitorGroupId)).length },
        ],
        chipByTab.units,
        "Todas"
      ),
    [searchedUnits, competitorGroups, groupNames, chipByTab.units]
  );
  const visibleUnits = searchedUnits.filter((unit) => {
    const chip = chipByTab.units;
    if (chip === "all") return true;
    return chip === NO_GROUP ? !groupNames.has(unit.competitorGroupId) : unit.competitorGroupId === chip;
  });
  const visibleGroups = competitorGroups.filter((group) => matches(queries.groups, group.name));

  const searchedProducts = React.useMemo(
    () =>
      competitorProducts.filter((product) =>
        matches(queries.products, product.itemName, simulationById.get(product.ksProductId ?? "")?.name, competitorById.get(product.competitorId)?.name)
      ),
    [competitorProducts, queries.products, simulationById, competitorById]
  );
  const productChips = React.useMemo(
    () =>
      buildChips(
        searchedProducts.length,
        competitors.map((competitor) => ({ id: competitor.id, label: competitor.name, count: searchedProducts.filter((product) => product.competitorId === competitor.id).length })),
        chipByTab.products,
        "Todas"
      ),
    [searchedProducts, competitors, chipByTab.products]
  );
  const visibleProducts = searchedProducts.filter((product) => chipByTab.products === "all" || product.competitorId === chipByTab.products);

  /* ───────── gravações ───────── */

  async function saveUnit(values: { name: string; competitorGroupId: string; address?: string; city?: string; state?: string }, current: Competitor | null) {
    if (current) await updateCompetitor(current.id, { ...current, ...values });
    else await addCompetitor({ ...values, active: true });
  }

  async function saveGroup(values: { name: string }, current: CompetitorGroup | null) {
    if (current) await updateCompetitorGroup(current.id, { ...current, name: values.name });
    else await addCompetitorGroup({ name: values.name });
  }

  async function removeProduct() {
    if (!openProduct) return;
    setDeletingProduct(true);
    setProductError(null);
    try {
      await deleteProduct(openProduct.id);
      setOpenProduct(null);
    } catch {
      setConfirmingProductDelete(false);
      setProductError("Não foi possível excluir a mercadoria. Tente novamente.");
    } finally {
      setDeletingProduct(false);
    }
  }

  /* ───────── hero ───────── */

  const tabItems = [
    { id: "comparison", label: "Comparativo", count: selectedCompetitorIds.length },
    { id: "units", label: "Unidades", count: competitors.length },
    { id: "groups", label: "Grupos", count: competitorGroups.length },
    { id: "products", label: "Mercadorias", count: competitorProducts.length },
  ];
  const primary =
    tab === "comparison"
      ? { label: "Selecionar concorrentes", onClick: () => setSelectionOpen(true) }
      : tab === "units"
        ? { label: "Nova unidade", onClick: () => setUnitPanel({ mode: "create" }) }
        : tab === "groups"
          ? { label: "Novo grupo", onClick: () => setGroupPanel({ mode: "create" }) }
          : { label: "Nova mercadoria", onClick: () => { setProductToEdit(null); setProductFormOpen(true); } };
  const placeholder =
    tab === "comparison" ? "Buscar mercadoria" : tab === "units" ? "Buscar unidade, grupo ou endereço" : tab === "groups" ? "Buscar grupo" : "Buscar mercadoria, concorrente ou vínculo";
  const chips = tab === "units" ? unitChips : tab === "products" ? productChips : [];
  const comparisonTemplate = `minmax(220px,1.4fr) 110px 100px repeat(${Math.max(selectedCompetitorIds.length, 1)}, minmax(160px,1fr))`;

  return (
    <div className="space-y-5">
      <CadastrosHero
        kicker="Concorrência"
        tabs={<CadastrosTabs tabs={tabItems} active={tab} onChange={(id) => setTab(id as Tab)} />}
        search={{ value: queries[tab], placeholder, onChange: (value) => setQueries((current) => ({ ...current, [tab]: value })) }}
        manage={tab === "comparison" && comparisonRows.length > 0 ? { label: "Exportar CSV", onClick: exportCsv } : undefined}
        primary={primary}
        chips={chips}
        activeChip={chipByTab[tab]}
        onChip={(id) => setChipByTab((current) => ({ ...current, [tab]: id }))}
      />

      {tab === "comparison" ? (
        selectedCompetitorIds.length === 0 ? (
          <div className="rounded-ds-card-lg border border-dashed border-ds-border-input px-5 py-16 text-center">
            <p className="text-sm font-bold">Selecione um ou mais concorrentes</p>
            <p className="mt-1 text-xs text-ds-ink-muted">A análise comparativa será exibida aqui.</p>
            <Button type="button" variant="ds-secondary" size="md" className="mt-4" onClick={() => setSelectionOpen(true)}>Selecionar concorrentes</Button>
          </div>
        ) : isLoading ? (
          <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm"><ListSkeleton rows={5} /></div>
        ) : correlatedSimulations(simulations, selectedCompetitorIds, productMap).length === 0 ? (
          <div className="rounded-ds-card-lg border border-dashed border-ds-border-input px-5 py-16 text-center">
            <p className="text-sm font-bold">Nenhuma mercadoria correlacionada</p>
            <p className="mt-1 text-xs text-ds-ink-muted">Nenhuma das suas mercadorias está vinculada a produtos dos concorrentes selecionados.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Acima do concorrente" value={summary.above} hint={`itens com mais de ${GAP_THRESHOLD}% acima`} />
              <StatTile label="Abaixo do concorrente" value={summary.below} hint={`itens com mais de ${GAP_THRESHOLD}% abaixo`} />
              <StatTile label="Gap médio de preço" value={`${summary.avgGap > 0 ? "+" : ""}${summary.avgGap.toFixed(0)}%`} hint={`${summary.total} comparações`} />
              <StatTile label="Preços desatualizados" value={summary.stale} hint={`coletados há mais de ${STALE_DAYS} dias`} />
            </div>
            <ListShell minWidth={620 + selectedCompetitorIds.length * 170}>
              <ListHead template={comparisonTemplate}>
                <span>Sua mercadoria</span>
                <span className="text-right">Seu preço</span>
                <span className="text-right">Margem</span>
                {selectedCompetitorIds.map((id) => (
                  <span key={id} className="truncate text-right">{competitorById.get(id)?.name ?? id}</span>
                ))}
              </ListHead>
              {comparisonRows.map((simulation) => (
                <LiftRow key={simulation.id} interactive={false} className="grid items-center gap-3.5 px-5 py-[11px] last:border-b-0" style={{ gridTemplateColumns: comparisonTemplate }}>
                  <p className="truncate text-[13.5px] font-bold">{simulation.name}</p>
                  <span className="text-right font-ds-mono text-[13px] font-bold">{brl(simulation.salePrice)}</span>
                  <span className={cn("text-right text-xs font-semibold", typeof simulation.profitPercentage === "number" && simulation.profitPercentage < 0 && "text-ds-danger")}>
                    {typeof simulation.profitPercentage === "number" ? `${simulation.profitPercentage.toFixed(0)}%` : "—"}
                  </span>
                  {selectedCompetitorIds.map((competitorId) => {
                    const product = (productMap.get(competitorId) ?? []).find((entry) => entry.ksProductId === simulation.id);
                    if (!product) return <span key={competitorId} className="text-right text-xs text-ds-ink-faint">—</span>;
                    const latest = priceMap.get(product.id);
                    if (!latest) {
                      return (
                        <div key={competitorId} className="text-right">
                          <Button type="button" variant="ds-link" size="xs" onClick={() => setPriceProduct(product)}>Registrar preço</Button>
                        </div>
                      );
                    }
                    const gap = priceGapPercent(simulation.salePrice, latest.price);
                    const kind = gap === null ? null : classifyGap(gap);
                    const stale = daysSince(latest.date) > STALE_DAYS;
                    const margin = marginAtPrice(latest.price, simulation.totalCmv);
                    return (
                      <button
                        key={competitorId}
                        type="button"
                        onClick={() => setPriceProduct(product)}
                        aria-label={`Preço de ${competitorById.get(competitorId)?.name ?? competitorId} para ${simulation.name}: ver histórico ou registrar`}
                        className="ml-auto flex flex-col items-end gap-1 rounded-ds-sm px-1.5 py-1 text-right transition-colors hover:bg-ds-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
                      >
                        <span className="font-ds-mono text-[13px] font-bold">{brl(latest.price)}</span>
                        {kind === "above" ? <StatusPill variant="danger">+{gap!.toFixed(0)}% acima</StatusPill> : null}
                        {kind === "below" ? <StatusPill variant="ok">{gap!.toFixed(0)}% abaixo</StatusPill> : null}
                        {kind === "neutral" ? <StatusPill variant="neutral">Neutro</StatusPill> : null}
                        <span className={cn("text-[11px]", stale ? "font-bold text-ds-warn" : "text-ds-ink-muted")}>
                          {stale ? "Desatualizado · " : ""}{shortDate(latest.date)}
                        </span>
                        {kind === "above" && margin !== null ? (
                          <span className={cn("text-[11px]", margin < 0 ? "font-bold text-ds-danger" : "text-ds-ink-muted")}>margem a esse preço: {margin.toFixed(0)}%</span>
                        ) : null}
                      </button>
                    );
                  })}
                </LiftRow>
              ))}
              {comparisonRows.length === 0 ? <EmptyResults title="Nenhuma mercadoria encontrada com essa busca." onClear={() => setQueries((current) => ({ ...current, comparison: "" }))} /> : null}
            </ListShell>
          </>
        )
      ) : null}

      {tab === "units" ? (
        <ListShell minWidth={760}>
          <ListHead template={UNIT_TEMPLATE}><span>Unidade</span><span>Grupo</span><span>Endereço</span><span /></ListHead>
          {isLoading ? <ListSkeleton rows={5} /> : null}
          {visibleUnits.map((unit) => (
            <ListRow
              key={unit.id}
              template={UNIT_TEMPLATE}
              isOpen={unitPanel?.mode !== "create" && unitPanel?.item.id === unit.id}
              isSelected={false}
              isMuted={false}
              onOpen={() => setUnitPanel({ mode: "view", item: unit })}
              label={`Abrir ${unit.name}`}
            >
              <p className="truncate text-[13.5px] font-bold">{unit.name}</p>
              <span className="truncate text-[13px]">{groupNames.get(unit.competitorGroupId) ?? <SoftPill isEmpty>Sem grupo</SoftPill>}</span>
              <span className="truncate text-xs text-ds-ink-muted">{competitorAddress(unit) || "Endereço não informado"}</span>
              <Chevron />
            </ListRow>
          ))}
          {!isLoading && visibleUnits.length === 0 ? (
            competitors.length === 0
              ? <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhuma unidade concorrente cadastrada.</p>
              : <EmptyResults title="Nenhuma unidade encontrada com esses filtros." onClear={() => { setQueries((current) => ({ ...current, units: "" })); setChipByTab((current) => ({ ...current, units: "all" })); }} />
          ) : null}
        </ListShell>
      ) : null}

      {tab === "groups" ? (
        <ListShell minWidth={620}>
          <ListHead template={GROUP_TEMPLATE}><span>Grupo</span><span>Unidades</span><span>Mercadorias</span><span /></ListHead>
          {isLoading ? <ListSkeleton rows={4} /> : null}
          {visibleGroups.map((group) => {
            const units = competitors.filter((competitor) => competitor.competitorGroupId === group.id);
            const productCount = competitorProducts.filter((product) => units.some((unit) => unit.id === product.competitorId)).length;
            return (
              <ListRow
                key={group.id}
                template={GROUP_TEMPLATE}
                isOpen={groupPanel?.mode !== "create" && groupPanel?.item.id === group.id}
                isSelected={false}
                isMuted={false}
                onOpen={() => setGroupPanel({ mode: "view", item: group })}
                label={`Abrir ${group.name}`}
              >
                <p className="truncate text-[13.5px] font-bold">{group.name}</p>
                <span className="text-xs text-ds-ink-muted">{units.length}</span>
                <span className="text-xs text-ds-ink-muted">{productCount}</span>
                <Chevron />
              </ListRow>
            );
          })}
          {!isLoading && visibleGroups.length === 0 ? (
            competitorGroups.length === 0
              ? <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhum grupo cadastrado.</p>
              : <EmptyResults title="Nenhum grupo encontrado com essa busca." onClear={() => setQueries((current) => ({ ...current, groups: "" }))} />
          ) : null}
        </ListShell>
      ) : null}

      {tab === "products" ? (
        <ListShell minWidth={820}>
          <ListHead template={PRODUCT_TEMPLATE}><span>Mercadoria do concorrente</span><span>Concorrente</span><span>Vínculo KS</span><span>Último preço</span><span /></ListHead>
          {isLoading ? <ListSkeleton rows={5} /> : null}
          {visibleProducts.map((product) => {
            const competitor = competitorById.get(product.competitorId);
            const linked = product.ksProductId ? simulationById.get(product.ksProductId) : undefined;
            const latest = priceMap.get(product.id);
            return (
              <ListRow
                key={product.id}
                template={PRODUCT_TEMPLATE}
                isOpen={openProduct?.id === product.id}
                isSelected={false}
                isMuted={false}
                onOpen={() => setOpenProduct(product)}
                label={`Abrir ${product.itemName}`}
              >
                <p className="truncate text-[13.5px] font-bold">{product.itemName}{product.unit ? ` (${product.unit})` : ""}</p>
                <span className="truncate text-[13px]">{competitor?.name ?? <StatusPill variant="danger">Sem concorrente</StatusPill>}</span>
                <span className="truncate text-[13px]">{linked?.name ?? <SoftPill isEmpty>Não vinculado</SoftPill>}</span>
                <span className="font-ds-mono text-xs font-semibold">{latest ? `${brl(latest.price)} · ${shortDate(latest.date)}` : "—"}</span>
                <Chevron />
              </ListRow>
            );
          })}
          {!isLoading && visibleProducts.length === 0 ? (
            competitorProducts.length === 0
              ? <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhuma mercadoria de concorrente cadastrada.</p>
              : <EmptyResults title="Nenhuma mercadoria encontrada com esses filtros." onClear={() => { setQueries((current) => ({ ...current, products: "" })); setChipByTab((current) => ({ ...current, products: "all" })); }} />
          ) : null}
        </ListShell>
      ) : null}

      <CompetitorSelectionPanel
        open={selectionOpen}
        onClose={() => setSelectionOpen(false)}
        groups={competitorGroups}
        competitors={competitors}
        selectedIds={selectedCompetitorIds}
        onApply={setSelectedCompetitorIds}
      />

      <CompetitorUnitPanel
        state={unitPanel}
        groups={competitorGroups}
        products={competitorProducts}
        onClose={() => setUnitPanel(null)}
        onMode={setUnitPanel}
        onSave={saveUnit}
        onDelete={(item) => deleteCompetitor(item.id)}
      />

      <CompetitorGroupPanel
        state={groupPanel}
        competitors={competitors}
        onClose={() => setGroupPanel(null)}
        onMode={setGroupPanel}
        onSave={saveGroup}
        onDelete={(item) => deleteCompetitorGroup(item.id)}
      />

      <SidePanel
        open={!!openProduct}
        onOpenChange={(open) => { if (!open) setOpenProduct(null); }}
        kicker="Mercadoria do concorrente"
        title={openProduct?.itemName ?? ""}
        subtitle={openProduct ? competitorById.get(openProduct.competitorId)?.name : undefined}
      >
        {openProduct ? (
          <>
            <PanelSection title="Dados">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <PanelField label="Unidade de medida">{openProduct.unit || "Não informada"}</PanelField>
                <PanelField label="Embalagem">{openProduct.packageSize || "Não informada"}</PanelField>
                <PanelField label="Vínculo KS">{(openProduct.ksProductId && simulationById.get(openProduct.ksProductId)?.name) || "Não vinculado"}</PanelField>
                <PanelField label="Último preço">
                  {priceMap.get(openProduct.id) ? `${brl(priceMap.get(openProduct.id)!.price)} · ${shortDate(priceMap.get(openProduct.id)!.date)}` : "Sem preço coletado"}
                </PanelField>
              </div>
            </PanelSection>
            {productError ? <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{productError}</p> : null}
            <div className="mt-auto flex flex-col gap-3 border-t border-ds-divider pt-4">
              {confirmingProductDelete ? (
                <InlineConfirm
                  message={`Excluir a mercadoria “${openProduct.itemName}”? Todo o histórico de preços também será excluído.`}
                  loading={deletingProduct}
                  returnFocusRef={productDeleteRef}
                  onCancel={() => setConfirmingProductDelete(false)}
                  onConfirm={() => void removeProduct()}
                />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="primary-modal" size="md" onClick={() => { setProductToEdit(openProduct); setOpenProduct(null); setProductFormOpen(true); }}>Editar mercadoria</Button>
                    <Button type="button" variant="ds-secondary" size="md" onClick={() => { setPriceProduct(openProduct); setOpenProduct(null); }}>Histórico de preços</Button>
                  </div>
                  <div>
                    <Button ref={productDeleteRef} type="button" variant="danger-link" size="xs" onClick={() => setConfirmingProductDelete(true)}>Excluir mercadoria</Button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}
      </SidePanel>

      <CompetitorProductModal isOpen={productFormOpen} onClose={() => { setProductFormOpen(false); setProductToEdit(null); }} productToEdit={productToEdit} />
      {priceProduct ? <CompetitorPriceModal isOpen onClose={() => setPriceProduct(null)} product={priceProduct} /> : null}
    </div>
  );
}
