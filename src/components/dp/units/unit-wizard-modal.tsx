"use client";

import React, { useEffect, useMemo, useState } from "react";

import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { resolveDPCoverageMode } from "@/lib/dp-coverage-demands";
import {
  DP_WEEKDAYS,
  dpOperatingHoursSchema,
  emptyOperatingHours,
  normalizeOperatingHours,
  type DPWeekdayKey,
} from "@/lib/dp-operating-hours";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { Segmented } from "@/components/patterns/segmented";
import { WizardModal, type WizardStep } from "@/components/patterns/wizard-modal";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { DPCoverageMode, DPUnit, DPUnitGroup, DPUnitOrganization, DPUnitStockRole, Kiosk } from "@/types";
import {
  COVERAGE_MODE_LABELS,
  NONE,
  STOCK_ROLE_LABELS,
  maskCnpjInput,
  type UnitForm,
} from "./units-model";

export type UnitDialogState =
  | { mode: "manual"; organizationId?: string; groupId?: string; unit?: null }
  | { mode: "sync"; organizationId?: string; groupId?: string; kioskId?: string; unit?: null }
  | { mode: "edit"; unit: DPUnit };

const STEPS: WizardStep[] = [
  { id: "identity", label: "Identificação", description: "Nome, CNPJ, tipo e endereço da unidade." },
  { id: "structure", label: "Estrutura", description: "Organização, grupo e função no estoque." },
  { id: "coverage", label: "Cobertura", description: "Como a escala identifica falta de pessoas na unidade." },
  { id: "integrations", label: "Integrações", description: "Vínculos independentes com o PDV Legal e o Bizneo." },
];

function blankForm(): UnitForm {
  return {
    name: "",
    cnpj: "",
    address: "",
    unitType: "",
    organizationId: "",
    groupId: "",
    kioskId: "",
    pdvFilialId: "",
    bizneoTaxonId: "",
    coverageMode: "fixed_hours",
    operatingHours: emptyOperatingHours(),
    stockRole: "commercial",
  };
}

function bizneoFromKiosk(kiosk?: Kiosk | null) {
  return kiosk?.bizneoId && !Number.isNaN(Number(kiosk.bizneoId)) ? String(Number(kiosk.bizneoId)) : "";
}

export function UnitWizardModal({
  dialog,
  organizations,
  groups,
  kiosks,
  syncCandidates,
  saving,
  onClose,
  onSubmit,
}: {
  dialog: UnitDialogState | null;
  organizations: DPUnitOrganization[];
  groups: DPUnitGroup[];
  kiosks: Kiosk[];
  syncCandidates: Kiosk[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (form: UnitForm, dialog: UnitDialogState) => Promise<void>;
}) {
  const [form, setForm] = useState<UnitForm>(blankForm);
  const [initialJson, setInitialJson] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [highestStep, setHighestStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const availableGroups = useMemo(
    () => (form.organizationId ? groups.filter((group) => group.organizationId === form.organizationId) : groups),
    [groups, form.organizationId]
  );
  const cnpjValidation = form.cnpj.trim() ? CnpjValidator.validate(form.cnpj) : null;
  const hoursValid = dpOperatingHoursSchema.safeParse(form.operatingHours).success;

  // Reinicia o formulário sempre que o modal abre para outra unidade ou outro modo.
  useEffect(() => {
    if (!dialog) return;
    let next: UnitForm;
    if (dialog.mode === "edit") {
      const unit = dialog.unit;
      const group = unit.groupId ? groupById.get(unit.groupId) : null;
      next = {
        name: unit.name,
        cnpj: unit.cnpj ? CnpjValidator.format(unit.cnpj) : "",
        address: unit.address ?? "",
        unitType: unit.unitType ?? "",
        organizationId: unit.organizationId ?? group?.organizationId ?? "",
        groupId: unit.groupId ?? "",
        kioskId: "",
        pdvFilialId: unit.pdvFilialId ?? "",
        bizneoTaxonId: typeof unit.bizneoTaxonId === "number" ? String(unit.bizneoTaxonId) : "",
        coverageMode: resolveDPCoverageMode(unit),
        operatingHours: normalizeOperatingHours(unit.operatingHours),
        stockRole: unit.stockRole ?? "commercial",
      };
    } else {
      const candidate =
        dialog.mode === "sync"
          ? (dialog.kioskId ? kiosks.find((kiosk) => kiosk.id === dialog.kioskId) : undefined) ?? syncCandidates[0]
          : undefined;
      next = {
        ...blankForm(),
        name: candidate?.name ?? "",
        organizationId: dialog.organizationId ?? "",
        groupId: dialog.groupId ?? "",
        kioskId: candidate?.id ?? "",
        pdvFilialId: candidate?.pdvFilialId ?? "",
        bizneoTaxonId: bizneoFromKiosk(candidate),
      };
    }
    setForm(next);
    setInitialJson(JSON.stringify(next));
    setStepIndex(0);
    setHighestStep(0);
    setErrors({});
    // O formulário só reinicia quando o diálogo muda; listas de apoio chegam depois e não devem apagar a edição.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  const patch = (partial: Partial<UnitForm>) => setForm((current) => ({ ...current, ...partial }));
  const clearError = (key: string) =>
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });

  function selectOrganization(value: string) {
    const organizationId = value === NONE ? "" : value;
    setForm((current) => {
      const currentGroup = current.groupId ? groupById.get(current.groupId) : null;
      return {
        ...current,
        organizationId,
        groupId: currentGroup && currentGroup.organizationId === organizationId ? current.groupId : "",
      };
    });
  }

  function selectGroup(value: string) {
    const groupId = value === NONE ? "" : value;
    const group = groupId ? groupById.get(groupId) : null;
    setForm((current) => ({ ...current, groupId, organizationId: group?.organizationId ?? current.organizationId }));
  }

  function selectSyncCandidate(kioskId: string) {
    if (kioskId === "__empty__") return;
    const kiosk = kiosks.find((entry) => entry.id === kioskId);
    setForm((current) => ({
      ...current,
      kioskId,
      name: kiosk?.name ?? current.name,
      pdvFilialId: kiosk?.pdvFilialId ?? "",
      bizneoTaxonId: bizneoFromKiosk(kiosk),
    }));
    clearError("kioskId");
  }

  function updateOperatingDay(weekday: DPWeekdayKey, change: { isOpen: boolean } | { startTime: string } | { endTime: string }) {
    setForm((current) => {
      const existing = current.operatingHours[weekday];
      let nextDay = existing;
      if ("isOpen" in change) {
        nextDay = change.isOpen
          ? {
              isOpen: true,
              startTime: existing.isOpen ? existing.startTime : "09:00",
              endTime: existing.isOpen ? existing.endTime : "21:00",
            }
          : { isOpen: false };
      } else if (existing.isOpen) {
        nextDay = { ...existing, ...change };
      }
      return { ...current, operatingHours: { ...current.operatingHours, [weekday]: nextDay } };
    });
  }

  function validateStep(index: number) {
    const found: Record<string, string> = {};
    if (index === 0) {
      if (dialog?.mode === "sync" && !form.kioskId) found.kioskId = "Selecione a unidade operacional de origem.";
      if (!form.name.trim()) found.name = "Informe o nome da unidade.";
      if (cnpjValidation && !cnpjValidation.valid) {
        found.cnpj = cnpjValidation.clean.length < 14 ? "Informe os 14 dígitos do CNPJ." : cnpjValidation.message ?? "CNPJ inválido.";
      }
    }
    if (index === 2 && form.coverageMode === "fixed_hours" && !hoursValid) {
      found.hours = "Em cada dia aberto, o encerramento deve ser posterior à abertura.";
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  }

  async function submit() {
    // A última etapa valida só a si mesma; as anteriores precisam estar corretas antes de gravar.
    for (const index of [0, 2]) {
      if (!validateStep(index)) {
        setStepIndex(index);
        return;
      }
    }
    if (dialog) await onSubmit(form, dialog);
  }

  if (!dialog) return null;

  const isEdit = dialog.mode === "edit";
  const selectedOrganization = organizations.find((organization) => organization.id === form.organizationId);
  const selectedGroup = form.groupId ? groupById.get(form.groupId) : undefined;
  const steps = STEPS.map((step) => {
    if (step.id === "identity") return { ...step, summary: form.name.trim() || "Sem nome" };
    if (step.id === "structure") return { ...step, summary: selectedGroup?.name ?? selectedOrganization?.name ?? "Sem vínculo" };
    if (step.id === "coverage") return { ...step, summary: COVERAGE_MODE_LABELS[form.coverageMode] };
    return { ...step, summary: form.pdvFilialId ? `PDV ${form.pdvFilialId}` : "Sem PDV" };
  });

  return (
    <WizardModal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      mode={isEdit ? "edit" : "new"}
      stepper="sidebar"
      saveMode="final"
      sidebarWidth={360}
      height={800}
      steps={steps}
      stepIndex={stepIndex}
      highestStep={highestStep}
      onStepChange={(index) => {
        setStepIndex(index);
        setHighestStep((current) => Math.max(current, index));
      }}
      onValidateStep={validateStep}
      title={isEdit ? "Editar unidade" : dialog.mode === "sync" ? "Criar unidade via sincronização" : "Criar unidade manualmente"}
      description="Dados cadastrais, estrutura, cobertura e integrações da unidade."
      submitLabel={isEdit ? "Salvar unidade" : "Criar unidade"}
      onSubmit={() => void submit()}
      submitting={saving}
      dirty={JSON.stringify(form) !== initialJson}
      sidebar={
        <div className="space-y-5">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">
            {isEdit ? "Editar unidade" : dialog.mode === "sync" ? "Nova unidade · sincronizada" : "Nova unidade"}
          </p>
          <div>
            <p className={cn("break-words text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em]", !form.name.trim() && "text-ds-on-dark-muted")}>
              {form.name.trim() || "Sem nome"}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selectedOrganization ? <SideTag>{selectedOrganization.name}</SideTag> : <SideTag muted>Sem organização</SideTag>}
              {selectedGroup ? <SideTag>{selectedGroup.name}</SideTag> : <SideTag muted>Sem grupo</SideTag>}
            </div>
          </div>
          <dl className="space-y-2.5 rounded-ds-btn-lg bg-white/[.06] p-4 text-[12.5px]">
            <SideFact label="Função no estoque" value={STOCK_ROLE_LABELS[form.stockRole]} />
            <SideFact label="Cobertura" value={COVERAGE_MODE_LABELS[form.coverageMode]} />
            <SideFact label="PDV Legal" value={form.pdvFilialId ? `ID ${form.pdvFilialId}` : "Sem vínculo"} />
            <SideFact label="Bizneo" value={form.bizneoTaxonId.trim() || "Sem vínculo"} />
          </dl>
        </div>
      }
    >
      {stepIndex === 0 ? (
        <div className="space-y-4">
          {dialog.mode === "sync" ? (
            <Field
              label="Origem"
              htmlFor="unit-kiosk"
              error={errors.kioskId}
              hint="A cópia traz o vínculo da unidade operacional. O nome continua editável antes de salvar."
            >
              <Select value={form.kioskId} onValueChange={selectSyncCandidate}>
                <SelectTrigger id="unit-kiosk" className={fieldInputClass} aria-invalid={!!errors.kioskId}>
                  <SelectValue placeholder="Selecione uma unidade operacional" />
                </SelectTrigger>
                <SelectContent>
                  {syncCandidates.length > 0 ? (
                    syncCandidates.map((kiosk) => (
                      <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name || kiosk.id}</SelectItem>
                    ))
                  ) : (
                    <SelectItem value="__empty__" disabled>Nenhuma unidade disponível para sincronizar</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label="Nome da unidade" htmlFor="unit-name" error={errors.name}>
            <Input
              id="unit-name"
              value={form.name}
              onChange={(event) => { patch({ name: event.target.value }); clearError("name"); }}
              placeholder="Ex.: Quiosque João Paulo"
              aria-invalid={!!errors.name}
              className={cn(fieldInputClass, "font-bold")}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CNPJ" htmlFor="unit-cnpj" requirement="opcional" error={errors.cnpj}>
              <Input
                id="unit-cnpj"
                value={form.cnpj}
                onChange={(event) => { patch({ cnpj: maskCnpjInput(event.target.value) }); clearError("cnpj"); }}
                placeholder="00.000.000/0000-00"
                inputMode="numeric"
                aria-invalid={!!errors.cnpj}
                className={cn(fieldInputClass, "font-ds-mono")}
              />
            </Field>
            <Field label="Tipo de unidade" htmlFor="unit-type" requirement="opcional" hint="Campo livre; as opções serão configuradas depois.">
              <Input
                id="unit-type"
                value={form.unitType}
                onChange={(event) => patch({ unitType: event.target.value })}
                placeholder="Ex.: Quiosque pequeno"
                className={fieldInputClass}
              />
            </Field>
          </div>
          <Field label="Endereço" htmlFor="unit-address" requirement="opcional">
            <Textarea
              id="unit-address"
              value={form.address}
              onChange={(event) => patch({ address: event.target.value })}
              placeholder="Rua, número, complemento, bairro, cidade e UF"
              rows={3}
              className={cn(fieldInputClass, "h-auto py-2.5")}
            />
          </Field>
        </div>
      ) : null}

      {stepIndex === 1 ? (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Organização" htmlFor="unit-organization">
              <Select value={form.organizationId || NONE} onValueChange={selectOrganization}>
                <SelectTrigger id="unit-organization" className={fieldInputClass}>
                  <SelectValue placeholder="Selecione uma organização" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem organização</SelectItem>
                  {organizations.map((organization) => (
                    <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Grupo" htmlFor="unit-group">
              <Select value={form.groupId || NONE} onValueChange={selectGroup}>
                <SelectTrigger id="unit-group" className={fieldInputClass}>
                  <SelectValue placeholder="Selecione um grupo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem grupo</SelectItem>
                  {availableGroups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div data-testid="unit-stock-role">
            <Field
              label="Função no estoque"
              hint="Define como o estoque mínimo da unidade é calculado. Comercial usa o consumo da própria unidade; abastecimento e mista usam a soma do consumo das unidades atendidas (veja “Grupos que este grupo abastece”)."
            >
              <Segmented<DPUnitStockRole>
                aria-label="Função no estoque"
                value={form.stockRole}
                onChange={(stockRole) => patch({ stockRole })}
                options={[
                  { value: "commercial", label: "Unidade comercial" },
                  { value: "mixed", label: "Unidade mista" },
                  { value: "supply", label: "Unidade de abastecimento" },
                ]}
              />
            </Field>
          </div>
        </div>
      ) : null}

      {stepIndex === 2 ? (
        <div className="space-y-4">
          <Field label="Modelo de cobertura" hint="Define como a escala identifica falta de pessoas na unidade.">
            <Segmented<DPCoverageMode>
              aria-label="Modelo de cobertura"
              value={form.coverageMode}
              onChange={(coverageMode) => { patch({ coverageMode }); clearError("hours"); }}
              options={[
                { value: "fixed_hours", label: "Horário fixo" },
                { value: "on_demand", label: "Sob demanda" },
                { value: "disabled", label: "Sem controle de cobertura" },
              ]}
            />
          </Field>
          {form.coverageMode === "fixed_hours" ? (
            <div className="space-y-2">
              <p className="text-xs text-ds-ink-muted">
                A escala usará os intervalos abaixo para identificar períodos sem nenhum turno cobrindo a unidade.
              </p>
              <div className="divide-y divide-ds-divider rounded-ds-btn-lg border border-ds-border bg-white">
                {DP_WEEKDAYS.map(({ key, label }) => {
                  const day = form.operatingHours[key];
                  return (
                    <div key={key} className="grid grid-cols-[minmax(120px,1fr)_auto] items-center gap-3 px-3 py-2 sm:grid-cols-[minmax(150px,1fr)_auto_110px_110px]">
                      <span className="text-[13px] font-bold">{label}</span>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={day.isOpen}
                          onCheckedChange={(checked) => { updateOperatingDay(key, { isOpen: checked }); clearError("hours"); }}
                          aria-label={`${day.isOpen ? "Fechar" : "Abrir"} ${label}`}
                        />
                        <span className="w-14 text-xs text-ds-ink-muted">{day.isOpen ? "Aberta" : "Fechada"}</span>
                      </div>
                      <Input
                        type="time"
                        value={day.isOpen ? day.startTime : ""}
                        onChange={(event) => { updateOperatingDay(key, { startTime: event.target.value }); clearError("hours"); }}
                        disabled={!day.isOpen}
                        aria-label={`Abertura de ${label}`}
                        className={cn(fieldInputClass, "tabular-nums disabled:opacity-50")}
                      />
                      <Input
                        type="time"
                        value={day.isOpen ? day.endTime : ""}
                        onChange={(event) => { updateOperatingDay(key, { endTime: event.target.value }); clearError("hours"); }}
                        disabled={!day.isOpen}
                        aria-label={`Encerramento de ${label}`}
                        className={cn(fieldInputClass, "tabular-nums disabled:opacity-50")}
                      />
                    </div>
                  );
                })}
              </div>
              {errors.hours ? <p role="alert" className="text-xs font-semibold text-ds-danger">{errors.hours}</p> : null}
            </div>
          ) : form.coverageMode === "on_demand" ? (
            <p className="rounded-ds-btn border border-ds-info/20 bg-ds-info-bg px-3.5 py-2.5 text-xs font-semibold text-ds-info">
              Os intervalos e a quantidade mínima de pessoas serão definidos separadamente em cada data da escala mensal.
            </p>
          ) : (
            <p className="rounded-ds-btn bg-ds-neutral-bg px-3.5 py-2.5 text-xs font-semibold text-ds-neutral">
              A escala não exibirá alertas de cobertura para esta unidade.
            </p>
          )}
        </div>
      ) : null}

      {stepIndex === 3 ? (
        <div className="space-y-5">
          <p role="note" className="rounded-ds-btn border border-ds-info/20 bg-ds-info-bg px-3.5 py-2.5 text-xs font-semibold text-ds-info">
            Estes vínculos são capturados automaticamente pela integração e ficam congelados aqui: não podem ser editados.
          </p>
          <Field label="Filial no PDV Legal" htmlFor="unit-pdv" hint="Vínculo exclusivo com a unidade retornada pelo PDV.">
            <Input
              id="unit-pdv"
              value={form.pdvFilialId ? `ID ${form.pdvFilialId}` : ""}
              placeholder="Sem vínculo com o PDV"
              readOnly
              aria-readonly="true"
              className={cn(fieldInputClass, "cursor-default bg-ds-muted font-ds-mono text-ds-ink-2 focus-visible:bg-ds-muted")}
            />
          </Field>
          <Field label="ID da unidade no Bizneo" htmlFor="unit-bizneo" hint="Taxon do Bizneo. Este vínculo é independente do PDV Legal.">
            <Input
              id="unit-bizneo"
              value={form.bizneoTaxonId}
              placeholder="Sem vínculo com o Bizneo"
              readOnly
              aria-readonly="true"
              className={cn(fieldInputClass, "cursor-default bg-ds-muted font-ds-mono text-ds-ink-2 focus-visible:bg-ds-muted")}
            />
          </Field>
        </div>
      ) : null}
    </WizardModal>
  );
}

function SideTag({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center rounded-ds-pill px-2.5 text-[11.5px] font-semibold", muted ? "bg-white/[.06] text-ds-on-dark-muted" : "bg-white/[.12] text-ds-on-dark")}>
      {children}
    </span>
  );
}

function SideFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ds-on-dark-muted">{label}</dt>
      <dd className="m-0 text-right font-bold text-ds-on-dark">{value}</dd>
    </div>
  );
}
