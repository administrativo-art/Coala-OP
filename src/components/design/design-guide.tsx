"use client";

import * as React from "react";

import { PageContainer } from "@/components/layout/page-container";
import { ControlIndicator, ControlPanel } from "@/components/patterns/control-panel";
import { FilterChips } from "@/components/patterns/filter-chips";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { LiftRow } from "@/components/patterns/lift-row";
import { Segmented } from "@/components/patterns/segmented";
import { PanelField, SidePanel } from "@/components/patterns/side-panel";
import { WizardModal } from "@/components/patterns/wizard-modal";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useAuth } from "@/hooks/use-auth";

const BUTTON_VARIANTS = [
  "primary-page", "primary-modal", "ds-secondary", "ds-ghost", "ds-link", "danger-link", "danger",
] as const;
const BUTTON_SIZES = ["xl", "lg", "md", "sm", "xs"] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-ds-card border border-ds-border bg-ds-surface p-6">
      <h2 className="mb-4 text-[19px] font-extrabold uppercase text-ds-ink">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** Guia vivo (docs/design): componentes reais com variantes e estados. Somente administrador. */
export function DesignGuide() {
  const { isDefaultAdmin, loading: authLoading } = useAuth();
  const [view, setView] = React.useState<"cards" | "table">("cards");
  const [chip, setChip] = React.useState<string | null>(null);
  const [indicator, setIndicator] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [modalKind, setModalKind] = React.useState<"base" | "derived" | "record">("base");
  const [step, setStep] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const deleteTriggerRef = React.useRef<HTMLButtonElement>(null);

  const openModal = (kind: "base" | "derived" | "record") => {
    setModalKind(kind);
    setStep(0);
    setModalOpen(true);
  };

  const modalSteps = modalKind === "base"
    ? [
        { id: "id", label: "Identificação e medida", description: "Dados principais e unidade de controle.", summary: "Leite integral · kg" },
        { id: "par", label: "Parâmetros por quiosque", description: "Conversão, custo e disponibilidade.", summary: "3 quiosques" },
      ]
    : [
        { id: "id", label: "Identificação", description: "Nome, categoria e situação.", summary: "Leite fermentado" },
        { id: "aliases", label: "Aliases", description: "Outros nomes usados nas fichas.", summary: "3 aliases" },
        { id: "measure", label: "Medidas", description: "Unidade, rendimento e conversão.", summary: "1 pacote = 1 kg" },
        { id: "nutrition", label: "Nutricional", description: "Informações por porção.", summary: "Não informado" },
      ];

  if (authLoading) {
    return (
      <PageContainer variant="compact">
        <p className="py-16 text-center text-sm text-muted-foreground" role="status">Carregando guia de design…</p>
      </PageContainer>
    );
  }

  if (!isDefaultAdmin) {
    return (
      <PageContainer variant="compact">
        <p className="py-16 text-center text-sm text-muted-foreground">Esta página é restrita a administradores.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer variant="default" className="font-ds" data-ui="design-guide">
      <div className="flex flex-col gap-6 py-6">
        <header>
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">Guia de design</p>
          <h1 className="text-2xl font-extrabold tracking-[-0.025em] text-ds-ink">Design do Coala</h1>
          <p className="text-[12.5px] text-ds-ink-muted">Componentes reais. A regra escrita está em docs/design.</p>
        </header>

        <Section title="Botões">
          {BUTTON_SIZES.map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-3">
              <span className="w-8 text-xs font-bold text-ds-ink-muted">{size}</span>
              {BUTTON_VARIANTS.map((v) => (
                <Button key={v} variant={v} size={size}>{v}</Button>
              ))}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 rounded-ds-btn bg-ds-dark p-4">
            <Button variant="on-dark-secondary" size="xl">on-dark-secondary</Button>
            <Button variant="on-dark-icon" size="icon" aria-label="Scanner">▦</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary-modal" size="lg" loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1500); }}>
              Salvar alterações
            </Button>
            <span className="text-xs text-ds-ink-muted">Carregando: rótulo troca, usa o token disabled e impede clique duplo.</span>
          </div>
        </Section>

        <Section title="Status">
          <div className="flex flex-wrap gap-2">
            <StatusPill variant="ok">Vence em 156 dias</StatusPill>
            <StatusPill variant="warn">Vence em 4 dia(s)</StatusPill>
            <StatusPill variant="danger">Vencido há 3 dia(s)</StatusPill>
            <StatusPill variant="neutral">Validade indefinida</StatusPill>
            <StatusPill variant="info">Reserva · 24</StatusPill>
          </div>
        </Section>

        <Section title="Seleção e filtros">
          <Segmented aria-label="Visualização" value={view} onChange={setView} options={[{ value: "cards", label: "Cards" }, { value: "table", label: "Tabela" }]} />
          <ControlPanel>
            <div className="grid grid-cols-3 gap-2">
              <ControlIndicator value={7} label="Vencendo" tone="warning" active={indicator === "warn"} onClick={() => setIndicator(indicator === "warn" ? null : "warn")} />
              <ControlIndicator value={2} label="Vencidos" tone="danger" active={indicator === "danger"} onClick={() => setIndicator(indicator === "danger" ? null : "danger")} />
              <ControlIndicator value={0} label="Reservas" tone="info" active={indicator === "info"} onClick={() => setIndicator(indicator === "info" ? null : "info")} />
            </div>
            <FilterChips className="mt-4" value={chip} onChange={setChip} allCount={42} chips={[{ value: "a", label: "Laticínios", count: 12 }, { value: "b", label: "Frutas", count: 9 }]} />
          </ControlPanel>
        </Section>

        <Section title="Linhas e painel lateral">
          <div className="rounded-ds-card border border-ds-border bg-ds-surface">
            {["SJ-2409-118", "SJ-2409-119", "SJ-2410-004"].map((lot) => (
              <LiftRow key={lot} selected={selected === lot} onClick={() => setSelected(lot)}>
                <span className="font-ds-mono text-[12.5px] font-bold">{lot}</span>
                <span className="ml-3"><StatusPill variant="warn">Vence em 4 dia(s)</StatusPill></span>
              </LiftRow>
            ))}
          </div>
          <SidePanel
            open={selected !== null}
            onOpenChange={(o) => { if (!o) { setSelected(null); setConfirming(false); } }}
            kicker={selected}
            title="Leite integral 1L"
            subtitle="Marca · Caixa com 12 un"
            highlights={<span>42</span>}
          >
            <div className="grid grid-cols-2 gap-4">
              <PanelField label="Quiosque">São José</PanelField>
              <PanelField label="Validade"><span className="font-ds-mono">12/10/2026</span></PanelField>
            </div>
            {confirming && (
              <InlineConfirm message={`Excluir o lote ${selected}? Esta ação não pode ser desfeita.`} onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); setSelected(null); }} returnFocusRef={deleteTriggerRef} />
            )}
            <Button ref={deleteTriggerRef} variant="danger-link" size="sm" className={confirming ? "hidden" : "self-start px-0"} onClick={() => setConfirming(true)}>Excluir lote</Button>
          </SidePanel>
        </Section>

        <Section title="Modal em etapas">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary-modal" size="lg" onClick={() => openModal("base")}>Stepper superior</Button>
            <Button variant="ds-secondary" size="lg" onClick={() => openModal("derived")}>Stepper lateral</Button>
            <Button variant="ds-secondary" size="lg" onClick={() => openModal("record")}>Ficha somente leitura</Button>
          </div>
          <WizardModal
            open={modalOpen}
            onOpenChange={setModalOpen}
            title={modalKind === "base" ? "Editar insumo base" : modalKind === "derived" ? "Editar insumo derivado" : "Ficha cadastral do insumo"}
            description="Exemplo isolado do padrão de modal do guia de design."
            mode="edit"
            readOnly={modalKind === "record"}
            stepper={modalKind === "base" ? "top" : "sidebar"}
            saveMode={modalKind === "derived" ? "per-step" : "final"}
            sidebarWidth={modalKind === "base" ? 380 : 360}
            steps={modalSteps}
            stepIndex={step}
            onStepChange={setStep}
            submitLabel="Salvar alterações"
            onSubmit={() => setModalOpen(false)}
            onSaveStep={() => setModalOpen(false)}
            onEdit={(index) => { setModalKind("derived"); setStep(index); }}
            dirty
            sidebar={(
              <>
                <div>
                  <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">{modalKind === "record" ? "Ficha cadastral" : "Editar insumo"}</p>
                  <h3 className="mt-2 break-words text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em]">Leite integral</h3>
                  <span className="mt-3 inline-flex rounded-ds-pill bg-white/[.08] px-2.5 py-1 text-[11.5px] font-bold text-ds-on-dark-2">Ativo</span>
                </div>
                <div className="rounded-ds-card border border-white/[.08] bg-white/[.05] p-4 text-[12.5px]">
                  <div className="flex justify-between gap-3 border-b border-white/[.06] pb-2"><span className="text-ds-on-dark-muted">Conversão</span><strong>1 pacote = 1 kg</strong></div>
                  <div className="flex justify-between gap-3 pt-2"><span className="text-ds-on-dark-muted">Vínculos</span><strong>3 derivados</strong></div>
                </div>
              </>
            )}
            footerNote="As alterações são demonstrativas e não gravam dados."
          >
            {modalKind === "record" ? (
              <dl className="grid grid-cols-2 gap-5 rounded-ds-card border border-ds-border bg-ds-surface p-5">
                <PanelField label="Nome">Leite integral</PanelField>
                <PanelField label="Categoria">Insumo</PanelField>
                <PanelField label="Unidade">Quilograma</PanelField>
                <PanelField label="Situação">Ativo</PanelField>
              </dl>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="grid gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-muted">
                  Nome do insumo
                  <input defaultValue="Leite integral" className="h-[42px] rounded-ds-btn border border-ds-border-input bg-ds-surface px-3 text-[13px] font-semibold normal-case tracking-normal text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink" />
                </label>
                <label className="grid gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-muted">
                  Unidade de medida
                  <select defaultValue="kg" className="h-[42px] rounded-ds-btn border border-ds-border-input bg-ds-surface px-3 text-[13px] font-semibold normal-case tracking-normal text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink">
                    <option value="kg">Quilograma</option>
                    <option value="l">Litro</option>
                  </select>
                </label>
                <div className="sm:col-span-2 rounded-ds-btn border border-ds-alert-border bg-ds-alert-bg p-3 text-[12.5px] font-semibold text-ds-alert-ink">
                  Este conteúdo existe apenas para demonstrar o shell, a rolagem e os estados do padrão.
                </div>
              </div>
            )}
          </WizardModal>
        </Section>
      </div>
    </PageContainer>
  );
}
