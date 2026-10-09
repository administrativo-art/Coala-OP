"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/hooks/use-toast";
import { extractBrazilianPostalCode } from "@/lib/brazilian-postal-code";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { resolveDPCoverageMode } from "@/lib/dp-coverage-demands";
import type { DPShiftDefinition, DPUnitGroup, DPUnitOrganization } from "@/types";
import {
  COVERAGE_MODE_LABELS,
  STOCK_ROLE_LABELS,
  coverageSummaryFor,
  pluralize,
  unitExternalLabel,
  type MergedOperationalUnit,
} from "./units-model";

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(field);
  if (!copied) throw new Error("Clipboard indisponível");
}

type CopyTarget = "address" | "postalCode";

export function UnitDetailPanel({
  unit,
  organization,
  group,
  shifts,
  canManage,
  busy,
  onClose,
  onEdit,
  onRegister,
  onDetachFromGroup,
  onDelete,
}: {
  unit: MergedOperationalUnit | null;
  organization?: DPUnitOrganization;
  group?: DPUnitGroup;
  shifts: DPShiftDefinition[];
  canManage: boolean;
  busy: boolean;
  onClose: () => void;
  onEdit: (unit: NonNullable<MergedOperationalUnit["dpUnit"]>) => void;
  onRegister: (kioskId?: string) => void;
  onDetachFromGroup: (unit: NonNullable<MergedOperationalUnit["dpUnit"]>) => void;
  onDelete: (unit: NonNullable<MergedOperationalUnit["dpUnit"]>) => Promise<void>;
}) {
  const { toast } = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setConfirmingDelete(false), [unit?.key]);
  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  const address = unit?.dpUnit?.address;
  const postalCode = address ? extractBrazilianPostalCode(address) : null;

  const copy = useCallback(async (value: string, target: CopyTarget) => {
    try {
      await writeClipboard(value);
      setCopied(target);
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => setCopied(null), 1600);
      toast({ title: target === "address" ? "Endereço copiado" : "CEP copiado", description: target === "address" ? unit?.name : value });
    } catch {
      toast({ variant: "destructive", title: "Não foi possível copiar", description: "Copie o dado manualmente na ficha da unidade." });
    }
  }, [toast, unit?.name]);

  const dpUnit = unit?.dpUnit;
  const coverage = coverageSummaryFor(dpUnit);
  const coverageMode = resolveDPCoverageMode(dpUnit);

  return (
    <SidePanel
      open={!!unit}
      onOpenChange={(open) => { if (!open) onClose(); }}
      kicker="Unidade"
      title={unit?.name ?? ""}
      subtitle={
        unit ? (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            <StatusPill variant={dpUnit ? "neutral" : "warn"}>{dpUnit ? unitExternalLabel(dpUnit) : "Só operacional"}</StatusPill>
            {dpUnit ? <StatusPill variant="info">{STOCK_ROLE_LABELS[dpUnit.stockRole ?? "commercial"]}</StatusPill> : null}
          </span>
        ) : undefined
      }
    >
      {unit ? (
        <>
          {!dpUnit ? (
            <p role="status" className="rounded-ds-btn border border-ds-alert-border bg-ds-alert-bg px-3.5 py-[11px] text-[12.5px] leading-normal text-ds-alert-ink">
              Este quiosque existe na operação, mas ainda não foi cadastrado na estrutura de unidades.
            </p>
          ) : null}

          <PanelSection title="Estrutura">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <PanelField label="Organização">{organization?.name ?? "Sem organização"}</PanelField>
              <PanelField label="Grupo">{group?.name ?? "Sem grupo"}</PanelField>
            </div>
          </PanelSection>

          <PanelSection title="Identificação">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <PanelField label="CNPJ">{dpUnit?.cnpj ? <span className="font-ds-mono">{CnpjValidator.format(dpUnit.cnpj)}</span> : "Não informado"}</PanelField>
              <PanelField label="Tipo">{dpUnit?.unitType || "Não informado"}</PanelField>
            </div>
            <PanelField label="Endereço">
              {address ? (
                <>
                  <span className="block leading-5">{address}</span>
                  <span className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" variant="ds-secondary" size="xs" onClick={() => void copy(address, "address")}>
                      {copied === "address" ? <Check aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" /> : <Copy aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />}
                      Copiar endereço
                    </Button>
                    {postalCode ? (
                      <Button type="button" variant="ds-secondary" size="xs" onClick={() => void copy(postalCode, "postalCode")}>
                        {copied === "postalCode" ? <Check aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" /> : <Copy aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />}
                        Copiar CEP
                      </Button>
                    ) : null}
                  </span>
                </>
              ) : (
                <span className="font-medium text-ds-ink-muted">Endereço não informado.</span>
              )}
            </PanelField>
          </PanelSection>

          <PanelSection title="Integrações">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <PanelField label="PDV Legal">{unit.pdvFilialId ? <span className="font-ds-mono">ID {unit.pdvFilialId}</span> : "Sem vínculo"}</PanelField>
              <PanelField label="Bizneo">{typeof unit.bizneoTaxonId === "number" ? <span className="font-ds-mono">{unit.bizneoTaxonId}</span> : "Sem vínculo"}</PanelField>
            </div>
          </PanelSection>

          <PanelSection title="Operação" aside={COVERAGE_MODE_LABELS[coverageMode]}>
            <PanelField label="Cobertura">
              <span className={coverage.needsConfiguration ? "text-ds-warn" : undefined}>{coverage.text}</span>
            </PanelField>
            <PanelField label={`Turnos vinculados · ${pluralize(shifts.length, "turno", "turnos")}`}>
              {shifts.length > 0 ? (
                <ul className="m-0 mt-1 flex max-h-56 list-none flex-col overflow-y-auto rounded-ds-btn border border-ds-divider p-0">
                  {shifts.map((shift, index) => (
                    <li key={shift.id} className={index > 0 ? "flex items-baseline justify-between gap-3.5 border-t border-ds-divider px-3 py-2" : "flex items-baseline justify-between gap-3.5 px-3 py-2"}>
                      <span className="min-w-0 truncate text-[12.5px] font-semibold">{shift.name}</span>
                      <span className="whitespace-nowrap font-ds-mono text-xs text-ds-ink-faint">{shift.startTime}–{shift.endTime}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="font-medium text-ds-ink-muted">Nenhum turno vinculado a esta unidade.</span>
              )}
            </PanelField>
          </PanelSection>

          {canManage ? (
            <div className="mt-auto flex flex-col gap-3 border-t border-ds-divider pt-4">
              {confirmingDelete && dpUnit ? (
                <InlineConfirm
                  message={`Excluir a unidade “${unit.name}”? Ela será removida do cadastro administrativo.`}
                  loading={busy}
                  returnFocusRef={deleteTriggerRef}
                  onCancel={() => setConfirmingDelete(false)}
                  onConfirm={() => void onDelete(dpUnit).then(() => setConfirmingDelete(false))}
                />
              ) : (
                <>
                  {dpUnit ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant="primary-modal" size="md" onClick={() => onEdit(dpUnit)}>Editar unidade</Button>
                      {dpUnit.groupId ? (
                        <Button type="button" variant="ds-secondary" size="md" disabled={busy} onClick={() => onDetachFromGroup(dpUnit)}>
                          Remover do grupo
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <Button type="button" variant="primary-modal" size="md" onClick={() => onRegister(unit.kiosk?.id)}>
                      Cadastrar na estrutura
                    </Button>
                  )}
                  {dpUnit ? (
                    <div>
                      <Button ref={deleteTriggerRef} type="button" variant="danger-link" size="xs" onClick={() => setConfirmingDelete(true)}>
                        Excluir unidade
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </SidePanel>
  );
}
