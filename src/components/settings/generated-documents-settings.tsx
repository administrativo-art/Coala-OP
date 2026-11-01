"use client";

import { useMemo, useState } from "react";
import { FileCheck2, FileText, PackageCheck } from "lucide-react";

import { ListHead, ListShell, SoftPill } from "@/components/cadastros/cadastros-ui";
import { ControlPanel, ControlSearch } from "@/components/patterns/control-panel";
import { FilterChips } from "@/components/patterns/filter-chips";
import { LiftRow } from "@/components/patterns/lift-row";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import {
  SYSTEM_DOCUMENT_TEMPLATES,
  type SystemDocumentTemplate,
} from "@/features/hr/documents/system-template-catalog";

const generatedTemplates = SYSTEM_DOCUMENT_TEMPLATES.filter(
  (template) => template.generationMode !== "reference",
);

function originLabel(template: SystemDocumentTemplate) {
  if (template.id === "system-receipt-standard") return "Gerador de documentos";
  if (template.id.includes("transportation-voucher-reactivation")) return "Solicitações do colaborador";
  if (template.sourceModule === "uniforms") return "Uniformes";
  if (template.sourceModule === "assets") return "Patrimônio";
  if (template.sourceModule === "time_recording") return "Registro de ponto";
  if (template.id.startsWith("system-admission-")) return "Admissão";
  return template.category;
}

function generationLabel(template: SystemDocumentTemplate) {
  return template.generationMode === "contextual"
    ? "Automática no fluxo de origem"
    : "Sob demanda no fluxo responsável";
}

function signatureLabel(template: SystemDocumentTemplate) {
  if (template.renderer === "rep_p_receipt") return "Assinatura digital PAdES";
  if (template.renderer === "time_mirror") return "Autentique, com o contracheque do mês";
  if (template.signatureScope === "independent") return "Assinatura individual";
  if (template.signatureScope === "bundle") return "Assinatura do pacote";
  return "Sem assinatura";
}

function collaboratorBindingLabel(template: SystemDocumentTemplate) {
  if (template.id.includes("transportation-voucher-reactivation")) return "Colaborador da solicitação";
  if (template.sourceModule === "uniforms") return "Colaborador do movimento de uniforme";
  if (template.sourceModule === "assets") return "Colaborador que recebe a posse do patrimônio";
  if (template.renderer === "time_mirror") return "Colaborador do mês fechado";
  if (template.sourceModule === "time_recording") return "Colaborador que registrou a batida";
  if (template.id.startsWith("system-admission-")) return "Colaborador da admissão";
  return "Definido no momento da geração";
}

type DocumentCatalogEntry = {
  id: string;
  name: string;
  description: string;
  origin: string;
  generation: string;
  signature: string;
  version: string;
  templates: SystemDocumentTemplate[];
  package: boolean;
  collaboratorBinding: string;
};

const admissionBundleTemplates = generatedTemplates.filter(
  (template) => template.id.startsWith("system-admission-") && template.signatureScope === "bundle",
);
const admissionBundleIds = new Set(admissionBundleTemplates.map((template) => template.id));

const catalogEntries: DocumentCatalogEntry[] = [
  ...(admissionBundleTemplates.length
    ? [{
        id: "admission-document-package",
        name: "Pacote admissional",
        description: "Documento final único formado pelos modelos aplicáveis à admissão do colaborador.",
        origin: "Admissão",
        generation: "Automática no fluxo admissional",
        signature: "Assinatura do pacote",
        version: `${admissionBundleTemplates.length} modelos disponíveis`,
        templates: admissionBundleTemplates,
        package: true,
        collaboratorBinding: "Colaborador da admissão",
      } satisfies DocumentCatalogEntry]
    : []),
  ...generatedTemplates
    .filter((template) => !admissionBundleIds.has(template.id))
    .map((template): DocumentCatalogEntry => ({
      id: template.id,
      name: template.name,
      description: template.description,
      origin: originLabel(template),
      generation: generationLabel(template),
      signature: signatureLabel(template),
      version: `v${template.version}`,
      templates: [template],
      package: false,
      collaboratorBinding: collaboratorBindingLabel(template),
    })),
].sort((left, right) => (
  left.origin.localeCompare(right.origin, "pt-BR")
  || left.name.localeCompare(right.name, "pt-BR")
));

export function GeneratedDocumentsSettings() {
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<string | null>(null);
  const [selected, setSelected] = useState<DocumentCatalogEntry | null>(null);
  const origins = useMemo(
    () => Array.from(new Set(catalogEntries.map((entry) => entry.origin))).sort(
      (left, right) => left.localeCompare(right, "pt-BR"),
    ),
    [],
  );
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return catalogEntries.filter((entry) => {
      if (origin && entry.origin !== origin) return false;
      if (!normalizedQuery) return true;
      return [
        entry.name,
        entry.description,
        entry.origin,
        ...entry.templates.flatMap((template) => [template.name, template.category]),
      ].some((value) => value.toLocaleLowerCase("pt-BR").includes(normalizedQuery));
    });
  }, [origin, query]);
  const groups = useMemo(() => origins
    .map((groupOrigin) => ({
      origin: groupOrigin,
      entries: visible.filter((entry) => entry.origin === groupOrigin),
    }))
    .filter((group) => group.entries.length > 0), [origins, visible]);

  return (
    <div className="space-y-5 font-ds">
      <div className="rounded-ds-card border border-ds-info/20 bg-ds-info-bg px-4 py-3 text-[13px] leading-5 text-ds-info">
        <strong>Uma regra por modelo ou pacote.</strong> Esta aba controla o local de geração, o vínculo com o colaborador, a assinatura, o arquivamento e a publicação. O conteúdo e as versões ficam na aba Modelos.
      </div>

      <ControlPanel className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Geração e publicação de documentos</p>
            <p className="mt-1 font-ds-mono text-[42px] font-bold leading-none text-ds-on-dark">{catalogEntries.length}</p>
            <p className="mt-1 text-sm font-bold text-ds-on-dark-2">modelos ou pacotes governados</p>
          </div>
          <FileCheck2 className="h-9 w-9 text-ds-accent-kicker" aria-hidden="true" />
        </div>
        <ControlSearch value={query} onChange={setQuery} placeholder="Buscar documento, pacote ou local de geração" />
        <FilterChips
          chips={origins.map((value) => ({
            value,
            label: value,
            count: catalogEntries.filter((entry) => entry.origin === value).length,
          }))}
          value={origin}
          onChange={setOrigin}
          allLabel="Todos os locais"
          allCount={catalogEntries.length}
        />
      </ControlPanel>

      <div className="flex items-baseline gap-2.5">
        <span className="text-[28px] font-extrabold tracking-[-0.03em] text-ds-ink">{visible.length}</span>
        <span className="text-[13px] text-ds-ink-faint">de {catalogEntries.length} modelos ou pacotes</span>
      </div>

      {groups.length ? groups.map((group) => (
        <section key={group.origin} className="space-y-2.5" aria-labelledby={`document-origin-${group.origin}`}>
          <div className="flex items-center justify-between px-1">
            <h3 id={`document-origin-${group.origin}`} className="text-[12px] font-extrabold uppercase tracking-[0.13em] text-ds-ink-muted">
              {group.origin}
            </h3>
            <span className="font-ds-mono text-[11.5px] font-bold text-ds-ink-faint">{group.entries.length}</span>
          </div>
          <ListShell minWidth={980}>
            <ListHead template="minmax(260px,1.45fr) minmax(180px,.9fr) minmax(160px,.8fr) minmax(150px,.75fr) 22px">
              <span>Documento ou pacote</span><span>Geração</span><span>Assinatura</span><span>Publicação</span><span />
            </ListHead>
            {group.entries.map((entry) => (
              <LiftRow
                key={entry.id}
                table
                selected={selected?.id === entry.id}
                onClick={() => setSelected(entry)}
                aria-label={`Ver regras de ${entry.name}`}
                className="grid items-center gap-3.5 px-5 py-[12px] last:border-b-0"
                style={{ gridTemplateColumns: "minmax(260px,1.45fr) minmax(180px,.9fr) minmax(160px,.8fr) minmax(150px,.75fr) 22px" }}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {entry.package ? <PackageCheck className="h-4 w-4 shrink-0 text-ds-accent-ink" aria-hidden="true" /> : null}
                    <p className="truncate text-[13.5px] font-extrabold text-ds-ink">{entry.name}</p>
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px] text-ds-ink-faint">{entry.package ? entry.version : entry.description}</p>
                </div>
                <span className="text-[12.5px] font-semibold text-ds-ink-2">{entry.generation}</span>
                <SoftPill>{entry.signature}</SoftPill>
                <span className="text-[12.5px] font-bold text-ds-ink-muted">Não configurada</span>
                <span className="text-ds-ink-faint">›</span>
              </LiftRow>
            ))}
          </ListShell>
        </section>
      )) : (
        <div className="rounded-ds-card border border-dashed border-ds-border p-8 text-center text-sm font-semibold text-ds-ink-faint">
          Nenhum documento corresponde aos filtros.
        </div>
      )}

      <SidePanel
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        kicker={selected?.package ? "Pacote de documentos" : "Modelo governado"}
        title={selected?.name ?? "Documento"}
        subtitle={selected?.description}
      >
        {selected ? (
          <>
            <PanelSection title="Origem e geração">
              <div className="grid grid-cols-2 gap-4">
                <PanelField label="Local de geração">{selected.origin}</PanelField>
                <PanelField label="Como nasce">{selected.generation}</PanelField>
                <PanelField label="Vínculo">{selected.collaboratorBinding}</PanelField>
                <PanelField label="Versão">{selected.version}</PanelField>
              </div>
            </PanelSection>
            {selected.package ? (
              <PanelSection title="Modelos do pacote" aside={`${selected.templates.length} disponíveis`}>
                <ol className="space-y-2">
                  {selected.templates.map((template, index) => (
                    <li key={template.id} className="flex items-start gap-3 rounded-ds-card border border-ds-border bg-ds-surface px-3 py-2.5">
                      <span className="font-ds-mono text-[11px] font-bold text-ds-ink-faint">{String(index + 1).padStart(2, "0")}</span>
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-bold text-ds-ink">{template.name}</span>
                        <span className="block text-[11.5px] text-ds-ink-faint">v{template.version}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-3 text-[12px] leading-5 text-ds-ink-muted">
                  O fluxo escolhe os modelos aplicáveis à admissão e acrescenta o termo de encerramento. O resultado é um único PDF final para assinatura e disponibilização.
                </p>
              </PanelSection>
            ) : (
              <PanelSection title="Modelo">
                <div className="grid grid-cols-2 gap-4">
                  <PanelField label="Categoria">{selected.templates[0].category}</PanelField>
                  <PanelField label="Formato">{selected.templates[0].sourceFormat.toUpperCase()}</PanelField>
                  <PanelField label="Assinatura">{selected.signature}</PanelField>
                  <PanelField label="Retenção">{selected.templates[0].retentionPolicyId}</PanelField>
                </div>
              </PanelSection>
            )}
            <PanelSection title="Publicação para o colaborador">
              <div className="space-y-3">
                <PanelField label="Política atual">Não configurada — permanece restrito</PanelField>
                <PanelField label="Destino">Será definido ao configurar a publicação</PanelField>
                <PanelField label="Momento">Será definido pela regra do modelo ou pacote</PanelField>
              </div>
            </PanelSection>
            <div className="flex items-start gap-3 rounded-ds-card border border-ds-border bg-ds-surface p-4">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ds-accent-ink" aria-hidden="true" />
              <p className="text-[12.5px] leading-5 text-ds-ink-muted">
                Na ausência de uma política explícita, o documento permanece somente no arquivo restrito. O cadastro e as versões do modelo continuam no módulo Documentos.
              </p>
            </div>
          </>
        ) : null}
      </SidePanel>
    </div>
  );
}
