"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Blocks,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileUp,
  GitBranch,
  Loader2,
  Mail,
  Plus,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";

import type { JobFunction, JobRole } from "@/types";

import {
  archiveIntegrationTemplateClient,
  createIntegrationTemplateClient,
  getIntegrationTemplateClient,
  listIntegrationTemplatesClient,
  publishIntegrationTemplateClient,
  updateIntegrationTemplateClient,
  type IntegrationTemplateDetailClient,
  type IntegrationTemplateMetadataClient,
} from "./client";
import { IntegrationRulesPanel, IntegrationSimulatorPanel } from "./IntegrationRulePanels";
import { DEFAULT_PROBATION_CONFIG, PROBATION_TOTAL_DAYS } from "./probation";
import {
  type IntegrationBlock,
  type IntegrationCommunication,
  type IntegrationSubfield,
  type IntegrationStage,
  type IntegrationTemplateVersion,
} from "./schemas";

type Props = {
  roles: JobRole[];
  functions: JobFunction[];
  getToken: () => Promise<string>;
  canManage: boolean;
  onSaved?: () => void;
};

type EditorTab = "stages" | "blocks" | "rules" | "communications" | "simulation" | "probation" | "settings";

const BLOCK_TYPES: Array<{ type: IntegrationBlock["type"]; label: string }> = [
  { type: "heading", label: "Título" },
  { type: "rich_text", label: "Texto de orientação" },
  { type: "text", label: "Texto curto" },
  { type: "textarea", label: "Texto longo" },
  { type: "number", label: "Número" },
  { type: "currency", label: "Moeda" },
  { type: "date", label: "Data" },
  { type: "yes_no", label: "Sim/Não" },
  { type: "single_select", label: "Escolha única" },
  { type: "multi_select", label: "Múltipla escolha" },
  { type: "confirmation", label: "Confirmação" },
  { type: "signature", label: "Assinatura" },
  { type: "repeatable_group", label: "Grupo repetível" },
  { type: "repeatable_table", label: "Tabela repetível" },
  { type: "subform", label: "Subformulário" },
  { type: "upload", label: "Upload" },
  { type: "task", label: "Tarefa" },
  { type: "approval", label: "Aprovação" },
  { type: "evaluation", label: "Avaliação" },
  { type: "decision", label: "Decisão" },
  { type: "document_generation", label: "Gerar documento" },
  { type: "notification", label: "Notificação" },
  { type: "probation", label: "Período de experiência" },
];

const SUBFIELD_TYPES: Array<{ type: IntegrationSubfield["type"]; label: string }> = [
  { type: "text", label: "Texto curto" },
  { type: "textarea", label: "Texto longo" },
  { type: "number", label: "Número" },
  { type: "currency", label: "Moeda" },
  { type: "percentage", label: "Percentual" },
  { type: "date", label: "Data" },
  { type: "yes_no", label: "Sim/Não" },
  { type: "single_select", label: "Escolha única" },
  { type: "multi_select", label: "Múltipla escolha" },
  { type: "confirmation", label: "Confirmação" },
  { type: "upload", label: "Upload" },
  { type: "subform", label: "Subformulário" },
  { type: "repeatable_group", label: "Grupo repetível" },
  { type: "repeatable_table", label: "Tabela repetível" },
];

function localId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function statusLabel(template: IntegrationTemplateMetadataClient) {
  if (template.status === "archived") return "Arquivado";
  if (template.hasDraft && template.currentVersion > 0) return `Versão ${template.currentVersion + 1} em edição`;
  if (template.hasDraft) return "Rascunho";
  return `Publicado · v${template.currentVersion}`;
}

function draftFromDetail(detail: IntegrationTemplateDetailClient) {
  return detail.draft ?? detail.currentVersion;
}

function createSubfield(type: IntegrationSubfield["type"] = "text"): IntegrationSubfield {
  return {
    id: localId("field"),
    type,
    label: SUBFIELD_TYPES.find((item) => item.type === type)?.label ?? "Campo",
    required: false,
    readOnly: false,
    config: {},
    ...(type === "repeatable_group" || type === "repeatable_table" || type === "subform" ? { fields: [] } : {}),
  };
}

function optionText(field: IntegrationSubfield) {
  return (field.options ?? []).map((option) => option.label).join("\n");
}

function parseOptions(raw: string) {
  return raw
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((label, index) => ({ id: `option_${index}_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, label, value: label, active: true }));
}

export function IntegrationSubfieldEditor({ fields, disabled, onChange, depth = 0 }: { fields: IntegrationSubfield[]; disabled: boolean; onChange: (fields: IntegrationSubfield[]) => void; depth?: number }) {
  function patchField(fieldId: string, patch: Partial<IntegrationSubfield>) {
    onChange(fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field));
  }
  function addField(type: IntegrationSubfield["type"] = "text") {
    onChange([...fields, createSubfield(type)]);
  }
  return (
    <div className={`space-y-2 rounded-lg border p-3 ${depth ? "bg-slate-50" : "bg-indigo-50/40"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black uppercase text-slate-500">Campos internos</p>
        {!disabled ? <select defaultValue="" onChange={(event) => { if (event.target.value) addField(event.target.value as IntegrationSubfield["type"]); event.target.value = ""; }} className="h-8 rounded-lg border bg-white px-2 text-xs font-bold"><option value="">+ Campo</option>{SUBFIELD_TYPES.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select> : null}
      </div>
      {fields.map((field) => {
        const hasChildren = field.type === "subform" || field.type === "repeatable_group" || field.type === "repeatable_table";
        const hasOptions = field.type === "single_select" || field.type === "multi_select";
        return (
          <div key={field.id} className="space-y-2 rounded-lg border bg-white p-2">
            <div className="grid gap-2 md:grid-cols-[minmax(120px,1fr)_150px_auto_auto]">
              <input disabled={disabled} value={field.label} onChange={(event) => patchField(field.id, { label: event.target.value })} className="h-9 rounded-lg border px-2 text-xs font-bold" />
              <select disabled={disabled} value={field.type} onChange={(event) => patchField(field.id, { type: event.target.value as IntegrationSubfield["type"], fields: ["subform", "repeatable_group", "repeatable_table"].includes(event.target.value) ? field.fields ?? [] : undefined })} className="h-9 rounded-lg border px-2 text-xs">{SUBFIELD_TYPES.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select>
              <label className="flex h-9 items-center gap-2 text-xs font-bold"><input type="checkbox" disabled={disabled} checked={field.required} onChange={(event) => patchField(field.id, { required: event.target.checked })} />Obrigatório</label>
              {!disabled ? <button type="button" onClick={() => onChange(fields.filter((item) => item.id !== field.id))} className="grid h-9 w-9 place-items-center text-rose-500"><Trash2 className="h-4 w-4" /></button> : null}
            </div>
            <input disabled={disabled} value={field.placeholder ?? ""} onChange={(event) => patchField(field.id, { placeholder: event.target.value || undefined })} placeholder="Placeholder" className="h-8 w-full rounded-lg border px-2 text-xs" />
            {field.type === "upload" ? <input disabled={disabled} value={String(field.config.accept ?? "")} onChange={(event) => patchField(field.id, { config: { ...field.config, accept: event.target.value } })} placeholder=".pdf,.jpg,.png" className="h-8 w-full rounded-lg border px-2 text-xs" /> : null}
            {hasOptions ? <textarea disabled={disabled} value={optionText(field)} onChange={(event) => patchField(field.id, { options: parseOptions(event.target.value) })} placeholder="Uma opção por linha" className="min-h-16 w-full rounded-lg border p-2 text-xs" /> : null}
            {hasChildren ? <IntegrationSubfieldEditor fields={field.fields ?? []} disabled={disabled} depth={depth + 1} onChange={(nextFields) => patchField(field.id, { fields: nextFields })} /> : null}
          </div>
        );
      })}
      {!fields.length ? <p className="rounded-lg border border-dashed bg-white p-3 text-xs text-slate-400">Nenhum campo interno configurado.</p> : null}
    </div>
  );
}

export function IntegrationTemplateManager({ roles, functions, getToken, canManage, onSaved }: Props) {
  const [templates, setTemplates] = useState<IntegrationTemplateMetadataClient[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<IntegrationTemplateDetailClient | null>(null);
  const [draft, setDraft] = useState<IntegrationTemplateVersion | null>(null);
  const [selectedStageId, setSelectedStageId] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [tab, setTab] = useState<EditorTab>("stages");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", roleId: "", functionId: "", isDefault: true });

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listIntegrationTemplatesClient(getToken);
      setTemplates(items);
      setSelectedId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar modelos.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDraft(null);
      return;
    }
    let active = true;
    setLoading(true);
    void getIntegrationTemplateClient(selectedId, getToken)
      .then((next) => {
        if (!active) return;
        const nextDraft = draftFromDetail(next);
        setDetail(next);
        setDraft(nextDraft);
        setSelectedStageId(nextDraft?.stages[0]?.id ?? "");
        setSelectedBlockId("");
      })
      .catch((error) => active && setMessage(error instanceof Error ? error.message : "Falha ao abrir modelo."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [getToken, selectedId]);

  const filteredTemplates = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return templates.filter((template) => {
      if (!term) return true;
      const role = roles.find((item) => item.id === template.roleId)?.name ?? "";
      const fn = functions.find((item) => item.id === template.functionId)?.name ?? "";
      return `${template.name} ${role} ${fn}`.toLocaleLowerCase("pt-BR").includes(term);
    });
  }, [functions, query, roles, templates]);

  const compatibleFunctions = useMemo(() => functions
    .filter((item) => item.isActive !== false)
    .filter((item) => !createForm.roleId || !item.compatibleRoleIds?.length || item.compatibleRoleIds.includes(createForm.roleId))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), [createForm.roleId, functions]);

  const selectedStage = draft?.stages.find((stage) => stage.id === selectedStageId) ?? draft?.stages[0] ?? null;
  const stageBlocks = (draft?.blocks ?? []).filter((block) => block.stageId === selectedStage?.id).sort((a, b) => a.order - b.order);
  const selectedBlock = draft?.blocks.find((block) => block.id === selectedBlockId) ?? null;
  const probationConfig = draft?.probation ?? {
    ...DEFAULT_PROBATION_CONFIG,
    alertsBeforeDays: [10, 5, 1], extensionTermRequired: false,
    evaluator: { strategy: "direct_manager" as const, fallback: "hr_pool" as const },
    effectivenessRule: "manual" as const,
  };

  function patchDraft(patch: Partial<IntegrationTemplateVersion>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  function patchStage(stageId: string, patch: Partial<IntegrationStage>) {
    if (!draft) return;
    patchDraft({ stages: draft.stages.map((stage) => stage.id === stageId ? { ...stage, ...patch } : stage) });
  }

  function patchBlock(blockId: string, patch: Partial<IntegrationBlock>) {
    if (!draft) return;
    patchDraft({ blocks: draft.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block) });
  }

  function patchCommunication(
    event: IntegrationCommunication["event"],
    patch: Partial<IntegrationCommunication>,
  ) {
    if (!draft) return;
    patchDraft({
      communications: draft.communications.map((communication) =>
        communication.event === event ? { ...communication, ...patch } : communication
      ),
    });
  }

  function addStage() {
    if (!draft) return;
    const stage: IntegrationStage = {
      id: localId("stage"),
      label: "Nova etapa",
      order: draft.stages.length,
      required: true,
      skippable: false,
      dueDays: null,
      dueDateSource: "stage_entry",
    };
    patchDraft({ stages: [...draft.stages, stage] });
    setSelectedStageId(stage.id);
  }

  function moveStage(stageId: string, direction: -1 | 1) {
    if (!draft) return;
    const ordered = [...draft.stages].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((stage) => stage.id === stageId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    patchDraft({ stages: ordered.map((stage, order) => ({ ...stage, order })) });
  }

  function removeStage(stageId: string) {
    if (!draft || draft.stages.length <= 1) return;
    const stages = draft.stages.filter((stage) => stage.id !== stageId).map((stage, order) => ({ ...stage, order }));
    patchDraft({ stages, blocks: draft.blocks.filter((block) => block.stageId !== stageId) });
    setSelectedStageId(stages[0]?.id ?? "");
  }

  function addBlock(type: IntegrationBlock["type"]) {
    if (!draft || !selectedStage) return;
    const label = BLOCK_TYPES.find((item) => item.type === type)?.label ?? "Novo bloco";
    const block: IntegrationBlock = {
      id: localId("block"),
      stageId: selectedStage.id,
      order: stageBlocks.length,
      type,
      label,
      required: false,
      readOnly: false,
      active: true,
      writePolicy: "process_only",
      hiddenAnswerPolicy: "exclude",
      ...(type === "repeatable_group" || type === "repeatable_table" || type === "subform" ? { fields: [] } : {}),
      config: {},
    };
    patchDraft({ blocks: [...draft.blocks, block] });
    setSelectedBlockId(block.id);
  }

  function removeBlock(blockId: string) {
    if (!draft) return;
    patchDraft({ blocks: draft.blocks.filter((block) => block.id !== blockId) });
    setSelectedBlockId("");
  }

  async function save() {
    if (!draft || !detail) return;
    setSaving(true);
    setMessage(null);
    try {
      const next = await updateIntegrationTemplateClient(detail.metadata.id, {
        name: draft.name,
        description: draft.description ?? null,
        isDefault: detail.metadata.isDefault,
        content: {
          stages: draft.stages,
          blocks: draft.blocks,
          rules: draft.rules,
          communications: draft.communications,
          probation: draft.probation,
          completionRules: draft.completionRules,
        },
      }, getToken);
      setDetail(next);
      setDraft(draftFromDetail(next));
      setMessage("Rascunho salvo.");
      await loadTemplates();
      onSaved?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar modelo.");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!detail) return;
    setSaving(true);
    setMessage(null);
    try {
      if (draft) await save();
      const version = await publishIntegrationTemplateClient(detail.metadata.id, getToken);
      setMessage(`Versão ${version.version} publicada.`);
      await loadTemplates();
      const next = await getIntegrationTemplateClient(detail.metadata.id, getToken);
      setDetail(next);
      setDraft(draftFromDetail(next));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao publicar modelo.");
    } finally {
      setSaving(false);
    }
  }

  async function createTemplate() {
    if (!createForm.name.trim() || !createForm.roleId) return;
    setSaving(true);
    setMessage(null);
    try {
      const created = await createIntegrationTemplateClient({
        name: createForm.name.trim(),
        roleId: createForm.roleId,
        functionId: createForm.functionId || null,
        isDefault: createForm.isDefault,
      }, getToken);
      setCreating(false);
      setCreateForm({ name: "", roleId: "", functionId: "", isDefault: true });
      await loadTemplates();
      setSelectedId(created.metadata.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar modelo.");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!detail || !window.confirm("Arquivar este modelo de integração?")) return;
    setSaving(true);
    try {
      await archiveIntegrationTemplateClient(detail.metadata.id, getToken);
      setSelectedId("");
      await loadTemplates();
      setMessage("Modelo arquivado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao arquivar modelo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-pink-600">Integração V2</p>
          <h2 className="mt-1 text-xl font-black text-slate-950">Modelos por cargo e função</h2>
          <p className="mt-1 text-sm text-slate-500">Fluxos versionados com etapas, perguntas, uploads e experiência.</p>
        </div>
        {canManage ? (
          <button type="button" onClick={() => setCreating(true)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white">
            <Plus className="h-4 w-4" /> Novo modelo
          </button>
        ) : null}
      </div>

      {message ? <p className="rounded-xl border bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">{message}</p> : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-xl border bg-white">
          <div className="border-b p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar modelo..." className="h-10 w-full rounded-xl border bg-slate-50 pl-9 pr-3 text-sm outline-none" />
            </div>
          </div>
          <div className="max-h-[680px] space-y-1 overflow-y-auto p-2">
            {loading && templates.length === 0 ? <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin" /> : null}
            {filteredTemplates.map((template) => {
              const role = roles.find((item) => item.id === template.roleId)?.name ?? "Cargo";
              const fn = functions.find((item) => item.id === template.functionId)?.name;
              return (
                <button key={template.id} type="button" onClick={() => setSelectedId(template.id)} className={`w-full rounded-xl px-3 py-3 text-left ${selectedId === template.id ? "bg-slate-950 text-white" : "hover:bg-slate-50"}`}>
                  <span className="block truncate text-sm font-bold">{template.name}</span>
                  <span className={`mt-1 block truncate text-xs ${selectedId === template.id ? "text-white/65" : "text-slate-500"}`}>{role}{fn ? ` · ${fn}` : ""}</span>
                  <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${selectedId === template.id ? "bg-white/15" : "bg-slate-100 text-slate-600"}`}>{statusLabel(template)}</span>
                </button>
              );
            })}
            {!loading && filteredTemplates.length === 0 ? <p className="px-3 py-10 text-center text-sm text-slate-500">Nenhum modelo criado.</p> : null}
          </div>
        </aside>

        <section className="min-w-0">
          {!draft || !detail ? (
            <div className="grid min-h-80 place-items-center rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : "Crie ou selecione um modelo para editar."}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border bg-white p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <input value={draft.name} disabled={!canManage} onChange={(event) => patchDraft({ name: event.target.value })} className="h-10 w-full max-w-xl rounded-lg border px-3 text-lg font-black" />
                    <p className="mt-2 text-xs text-slate-500">{statusLabel(detail.metadata)} · {draft.stages.length} etapas · {draft.blocks.length} blocos</p>
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-bold"><Save className="h-4 w-4" /> Salvar</button>
                      <button type="button" onClick={() => void publish()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white"><CheckCircle2 className="h-4 w-4" /> Publicar</button>
                      <button type="button" onClick={() => void archive()} disabled={saving} className="grid h-9 w-9 place-items-center rounded-lg border text-slate-500"><Archive className="h-4 w-4" /></button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex gap-2 overflow-x-auto rounded-xl border bg-white p-2">
                {([
                  ["stages", "Etapas", GitBranch],
                  ["blocks", "Inputs e blocos", Blocks],
                  ["rules", "Condicionais", GitBranch],
                  ["communications", "Comunicações", Mail],
                  ["simulation", "Simulação", Sparkles],
                  ["probation", "Experiência", Clock3],
                  ["settings", "Configurações", Settings2],
                ] as const).map(([value, label, Icon]) => (
                  <button key={value} type="button" onClick={() => setTab(value)} className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-bold ${tab === value ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-50"}`}><Icon className="h-4 w-4" />{label}</button>
                ))}
              </div>

              {tab === "stages" ? (
                <div className="rounded-xl border bg-white p-4">
                  <div className="mb-4 flex items-center justify-between"><div><h3 className="font-black">Etapas</h3><p className="text-xs text-slate-500">Organize a sequência principal do processo.</p></div>{canManage ? <button type="button" onClick={addStage} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-bold"><Plus className="h-4 w-4" /> Etapa</button> : null}</div>
                  <div className="space-y-2">
                    {[...draft.stages].sort((a, b) => a.order - b.order).map((stage, index) => (
                      <div key={stage.id} className={`grid gap-3 rounded-xl border p-3 md:grid-cols-[36px_minmax(0,1fr)_130px_auto] md:items-center ${selectedStageId === stage.id ? "border-pink-300 bg-pink-50/40" : "bg-slate-50"}`}>
                        <button type="button" onClick={() => setSelectedStageId(stage.id)} className="grid h-9 w-9 place-items-center rounded-full bg-white text-xs font-black ring-1 ring-slate-200">{index + 1}</button>
                        <input value={stage.label} disabled={!canManage} onChange={(event) => patchStage(stage.id, { label: event.target.value })} className="h-10 rounded-lg border bg-white px-3 text-sm font-bold" />
                        <input type="number" min="0" value={stage.dueDays ?? ""} disabled={!canManage} onChange={(event) => patchStage(stage.id, { dueDays: event.target.value ? Number(event.target.value) : null })} placeholder="Prazo em dias" className="h-10 rounded-lg border bg-white px-3 text-sm" />
                        {canManage ? <div className="flex gap-1"><button type="button" onClick={() => moveStage(stage.id, -1)} className="p-2"><ChevronUp className="h-4 w-4" /></button><button type="button" onClick={() => moveStage(stage.id, 1)} className="p-2"><ChevronDown className="h-4 w-4" /></button><button type="button" onClick={() => removeStage(stage.id)} disabled={draft.stages.length <= 1} className="p-2 text-rose-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {tab === "blocks" ? (
                <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
                  <aside className="rounded-xl border bg-white p-3"><p className="mb-2 text-xs font-bold uppercase text-slate-400">Etapa</p>{draft.stages.map((stage) => <button key={stage.id} type="button" onClick={() => { setSelectedStageId(stage.id); setSelectedBlockId(""); }} className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm font-semibold ${selectedStage?.id === stage.id ? "bg-slate-950 text-white" : "hover:bg-slate-50"}`}>{stage.label}</button>)}</aside>
                  <div className="rounded-xl border bg-white p-4">
                    <div className="mb-3 flex items-center justify-between"><div><h3 className="font-black">{selectedStage?.label}</h3><p className="text-xs text-slate-500">{stageBlocks.length} blocos</p></div>{canManage ? <select defaultValue="" onChange={(event) => { if (event.target.value) addBlock(event.target.value as IntegrationBlock["type"]); event.target.value = ""; }} className="h-9 rounded-lg border px-2 text-sm font-bold"><option value="">+ Adicionar bloco</option>{BLOCK_TYPES.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select> : null}</div>
                    <div className="space-y-2">{stageBlocks.map((block) => <button key={block.id} type="button" onClick={() => setSelectedBlockId(block.id)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${selectedBlockId === block.id ? "border-pink-300 bg-pink-50" : "bg-slate-50"}`}><span className="grid h-9 w-9 place-items-center rounded-lg bg-white"><Blocks className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{block.label}</span><span className="text-xs text-slate-500">{BLOCK_TYPES.find((item) => item.type === block.type)?.label ?? block.type}</span></span>{block.required ? <span className="text-[10px] font-bold text-rose-600">Obrigatório</span> : null}</button>)}</div>
                  </div>
                  <aside className="rounded-xl border bg-white p-4">{selectedBlock ? <div className="space-y-3"><div className="flex items-center justify-between"><p className="font-black">Configurar bloco</p>{canManage ? <button type="button" onClick={() => removeBlock(selectedBlock.id)} className="text-rose-500"><Trash2 className="h-4 w-4" /></button> : null}</div><label className="block text-xs font-bold text-slate-500">Nome<input value={selectedBlock.label} disabled={!canManage} onChange={(event) => patchBlock(selectedBlock.id, { label: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900" /></label><label className="block text-xs font-bold text-slate-500">Descrição<textarea value={selectedBlock.description ?? ""} disabled={!canManage} onChange={(event) => patchBlock(selectedBlock.id, { description: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border p-3 text-sm text-slate-900" /></label><label className="block text-xs font-bold text-slate-500">Variável de destino<input value={selectedBlock.variableKey ?? ""} disabled={!canManage} onChange={(event) => patchBlock(selectedBlock.id, { variableKey: event.target.value || undefined })} placeholder="employee.name" className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900" /></label><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={selectedBlock.required} disabled={!canManage} onChange={(event) => patchBlock(selectedBlock.id, { required: event.target.checked })} /> Obrigatório</label><label className="block text-xs font-bold text-slate-500">Gravação<select value={selectedBlock.writePolicy} disabled={!canManage} onChange={(event) => patchBlock(selectedBlock.id, { writePolicy: event.target.value as IntegrationBlock["writePolicy"] })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900"><option value="process_only">Somente no processo</option><option value="direct">Atualização direta</option><option value="confirm">Pedir confirmação</option><option value="approval">Exigir aprovação</option></select></label>{selectedBlock.type === "upload" ? <div className="space-y-2 rounded-lg bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-500">Upload</p><input value={String(selectedBlock.config.accept ?? "")} onChange={(event) => patchBlock(selectedBlock.id, { config: { ...selectedBlock.config, accept: event.target.value } })} placeholder=".pdf,.docx,.jpg" className="h-9 w-full rounded-lg border px-2 text-xs" /><label className="flex gap-2 text-xs"><input type="checkbox" checked={selectedBlock.config.approvalRequired === true} onChange={(event) => patchBlock(selectedBlock.id, { config: { ...selectedBlock.config, approvalRequired: event.target.checked } })} />Exigir aprovação</label></div> : null}{selectedBlock.type === "document_generation" ? <label className="block rounded-lg bg-violet-50 p-3 text-xs font-bold text-violet-800">ID do modelo documental<input value={String(selectedBlock.config.templateId ?? "")} onChange={(event) => patchBlock(selectedBlock.id, { config: { ...selectedBlock.config, templateId: event.target.value } })} placeholder="ID exibido no cadastro do modelo" className="mt-1 h-9 w-full rounded-lg border bg-white px-2 text-xs text-slate-900" /></label> : null}{["repeatable_group", "repeatable_table", "subform"].includes(selectedBlock.type) ? <IntegrationSubfieldEditor fields={selectedBlock.fields ?? []} disabled={!canManage} onChange={(fields) => patchBlock(selectedBlock.id, { fields })} /> : null}</div> : <p className="text-sm text-slate-500">Selecione um bloco para editar.</p>}</aside>
                </div>
              ) : null}

              {tab === "rules" ? <IntegrationRulesPanel draft={draft} disabled={!canManage} onChange={(rules) => patchDraft({ rules })} /> : null}

              {tab === "communications" ? (
                <div className="space-y-4">
                  <div className="rounded-xl border bg-white p-5">
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Mail className="h-5 w-5" /></span>
                      <div>
                        <h3 className="font-black">Comunicações automáticas</h3>
                        <p className="mt-1 text-sm text-slate-500">Os gatilhos são fixos. Assunto, texto e botão são versionados junto com este modelo.</p>
                      </div>
                    </div>
                    <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      Variáveis: <code>{"{{employee.name}}"}</code>, <code>{"{{system.role.job_role}}"}</code>, <code>{"{{system.role.functions}}"}</code>, <code>{"{{system.schedule.units}}"}</code>, <code>{"{{integration.formalization_deadline}}"}</code>.
                    </div>
                  </div>
                  {draft.communications.map((communication) => {
                    const isStart = communication.event === "formalization_started";
                    return (
                      <div key={communication.event} className="grid gap-4 rounded-xl border bg-white p-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
                        <div className="space-y-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-black">{isStart ? "Início da formalização" : "Formalização concluída e primeiro acesso"}</p>
                              <p className="text-xs text-slate-500">{isStart ? "Enviado após criar o processo e o link público." : "Enviado somente após criar o usuário, aplicar o perfil e gerar o link de senha."}</p>
                            </div>
                            <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={communication.enabled} disabled={!canManage} onChange={(event) => patchCommunication(communication.event, { enabled: event.target.checked })} />Ativo</label>
                          </div>
                          <label className="block text-xs font-bold text-slate-500">Assunto<input value={communication.subject} disabled={!canManage} onChange={(event) => patchCommunication(communication.event, { subject: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900" /></label>
                          <label className="block text-xs font-bold text-slate-500">Título<input value={communication.title} disabled={!canManage} onChange={(event) => patchCommunication(communication.event, { title: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900" /></label>
                          <label className="block text-xs font-bold text-slate-500">Mensagem<textarea value={communication.message} disabled={!canManage} onChange={(event) => patchCommunication(communication.event, { message: event.target.value })} className="mt-1 min-h-44 w-full rounded-lg border p-3 text-sm leading-relaxed text-slate-900" /></label>
                          <label className="block text-xs font-bold text-slate-500">Texto do botão<input value={communication.buttonLabel} disabled={!canManage} onChange={(event) => patchCommunication(communication.event, { buttonLabel: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900" /></label>
                        </div>
                        <div className="rounded-xl bg-slate-100 p-4">
                          <p className="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">Prévia simplificada</p>
                          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
                            <div className="bg-emerald-800 px-5 py-4 font-black text-white">{isStart ? "Coala Shakes" : "Coala One"}</div>
                            <div className="space-y-4 p-5">
                              <p className="text-lg font-black text-slate-950">{communication.title}</p>
                              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{communication.message}</p>
                              <span className="inline-flex rounded-lg bg-emerald-800 px-4 py-2 text-sm font-bold text-white">{communication.buttonLabel}</span>
                              {!isStart ? <p className="text-xs text-slate-500">Depois, acesse normalmente em <span className="font-bold text-emerald-800">op.coalashakes.com</span>.</p> : null}
                            </div>
                            <div className="border-t px-5 py-3 text-xs text-slate-500">Essa é uma mensagem automática, não responda esse e-mail.</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {tab === "simulation" ? <IntegrationSimulatorPanel draft={draft} /> : null}

              {tab === "probation" ? (
                <div className="space-y-5 rounded-xl border bg-white p-5">
                  <div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700"><Clock3 className="h-5 w-5" /></span><div><h3 className="font-black">Período de experiência</h3><p className="text-sm text-slate-500">A admissão calculará períodos, avaliações, alertas e decisão automaticamente.</p></div></div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="text-xs font-bold text-slate-500">Primeiro período<div className="mt-1 flex items-center rounded-lg border bg-white"><input type="number" min="1" max={PROBATION_TOTAL_DAYS - 1} value={probationConfig.firstPeriodDays} disabled={!canManage} onChange={(event) => { const firstPeriodDays = Number(event.target.value); patchDraft({ probation: { ...probationConfig, firstPeriodDays, secondPeriodDays: PROBATION_TOTAL_DAYS - firstPeriodDays } }); }} className="h-11 min-w-0 flex-1 px-3 text-sm font-black outline-none" /><span className="pr-3 text-xs text-slate-400">dias</span></div></label>
                    <label className="text-xs font-bold text-slate-500">Prorrogação automática<div className="mt-1 flex items-center rounded-lg border bg-slate-50"><input type="number" value={probationConfig.secondPeriodDays} disabled className="h-11 min-w-0 flex-1 bg-transparent px-3 text-sm font-black text-slate-500 outline-none" /><span className="pr-3 text-xs text-slate-400">dias</span></div></label>
                    <label className="text-xs font-bold text-slate-500">Janela de avaliação<div className="mt-1 flex items-center rounded-lg border bg-white"><input type="number" min="1" max="90" value={probationConfig.evaluationWindowDays} disabled={!canManage} onChange={(event) => patchDraft({ probation: { ...probationConfig, evaluationWindowDays: Number(event.target.value) } })} className="h-11 min-w-0 flex-1 px-3 text-sm font-black outline-none" /><span className="pr-3 text-xs text-slate-400">dias</span></div></label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-xs font-bold text-slate-500">Alertas antes do fim de cada período<input value={probationConfig.alertsBeforeDays.join(', ')} disabled={!canManage} onChange={(event) => patchDraft({ probation: { ...probationConfig, alertsBeforeDays: event.target.value.split(',').map(Number).filter(Number.isFinite) } })} placeholder="10, 5, 1" className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" /></label>
                    <label className="text-xs font-bold text-slate-500">Responsável pela avaliação<select value={probationConfig.evaluator.strategy} disabled={!canManage} onChange={(event) => patchDraft({ probation: { ...probationConfig, evaluator: { ...probationConfig.evaluator, strategy: event.target.value as typeof probationConfig.evaluator.strategy } } })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm"><option value="direct_manager">Gestor direto</option><option value="unit_manager">Gestor da unidade</option><option value="hr_pool">Equipe de RH</option><option value="specific_user">Usuário específico</option><option value="selected_during_execution">Escolher na execução</option></select></label>
                    <label className="text-xs font-bold text-slate-500">Regra de efetivação<select value={probationConfig.effectivenessRule} disabled={!canManage} onChange={(event) => patchDraft({ probation: { ...probationConfig, effectivenessRule: event.target.value as typeof probationConfig.effectivenessRule } })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm"><option value="manual">Decisão manual do RH</option><option value="approved_evaluations">Efetivar com avaliações aprovadas</option><option value="automatic_at_end">Efetivar ao fim do período</option></select></label>
                  </div>
                  <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">Total: {probationConfig.firstPeriodDays + probationConfig.secondPeriodDays} dias · na abertura da integração, o RH confirma o primeiro período e o sistema calcula o segundo · avaliações nos últimos {probationConfig.evaluationWindowDays} dias de cada período.</p>
                </div>
              ) : null}

              {tab === "settings" ? (
                <div className="rounded-xl border bg-white p-5"><h3 className="font-black">Configurações gerais</h3><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-xs font-bold text-slate-500">Descrição<textarea value={draft.description ?? ""} disabled={!canManage} onChange={(event) => patchDraft({ description: event.target.value })} className="mt-1 min-h-28 w-full rounded-lg border p-3 text-sm text-slate-900" /></label><div className="space-y-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Cargo</p><p className="mt-1 text-sm font-black">{roles.find((item) => item.id === draft.roleId)?.name ?? draft.roleId}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Função</p><p className="mt-1 text-sm font-black">{functions.find((item) => item.id === draft.functionId)?.name ?? "Todas as funções compatíveis"}</p></div></div></div></div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {creating ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><div className="w-full max-w-lg rounded-xl bg-white shadow-2xl"><div className="border-b px-5 py-4"><h3 className="text-lg font-black">Novo modelo de integração</h3></div><div className="space-y-4 p-5"><label className="block text-xs font-bold text-slate-500">Nome<input value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900" /></label><label className="block text-xs font-bold text-slate-500">Cargo<select value={createForm.roleId} onChange={(event) => setCreateForm((current) => ({ ...current, roleId: event.target.value, functionId: "" }))} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900"><option value="">Selecione</option>{roles.filter((item) => item.isActive !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="block text-xs font-bold text-slate-500">Função opcional<select value={createForm.functionId} onChange={(event) => setCreateForm((current) => ({ ...current, functionId: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900"><option value="">Todas as funções</option>{compatibleFunctions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={createForm.isDefault} onChange={(event) => setCreateForm((current) => ({ ...current, isDefault: event.target.checked }))} />Definir como padrão</label></div><div className="flex justify-end gap-2 border-t px-5 py-3"><button type="button" onClick={() => setCreating(false)} className="h-9 rounded-lg border px-3 text-sm font-bold">Cancelar</button><button type="button" onClick={() => void createTemplate()} disabled={saving || !createForm.name.trim() || !createForm.roleId} className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-bold text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Criar modelo</button></div></div></div>
      ) : null}
    </div>
  );
}
