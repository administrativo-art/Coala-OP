"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, GitBranch, Play, Plus, Trash2 } from "lucide-react";

import { simulateIntegrationTemplate, validateIntegrationTemplate } from "./engine";
import type { IntegrationCondition, IntegrationRule, IntegrationTemplateVersion } from "./schemas";

type ConditionProps = {
  condition: IntegrationCondition;
  blocks: IntegrationTemplateVersion["blocks"];
  disabled: boolean;
  depth?: number;
  onChange: (condition: IntegrationCondition) => void;
  onRemove?: () => void;
};

const OPERATORS = [
  ["equals", "é igual a"], ["not_equals", "é diferente de"], ["contains", "contém"],
  ["not_contains", "não contém"], ["gt", "maior que"], ["gte", "maior ou igual"],
  ["lt", "menor que"], ["lte", "menor ou igual"], ["between", "está entre"],
  ["in", "está na lista"], ["not_in", "não está na lista"], ["is_empty", "está vazio"],
  ["is_not_empty", "está preenchido"], ["file_uploaded", "arquivo enviado"],
  ["file_approved", "arquivo aprovado"], ["date_before", "data anterior a"], ["date_after", "data posterior a"],
] as const;

const ACTIONS = [
  ["show_block", "Exibir bloco"], ["hide_block", "Ocultar bloco"], ["require_block", "Tornar obrigatório"],
  ["skip_stage", "Pular etapa"], ["activate_stage", "Ativar etapa"], ["require_upload", "Exigir upload"],
  ["create_task", "Criar tarefa"], ["generate_document", "Gerar documento"], ["request_signature", "Solicitar assinatura"],
  ["notify", "Notificar"], ["block_progress", "Bloquear avanço"], ["complete_integration", "Concluir integração"],
] as const;

function emptyPredicate(): IntegrationCondition {
  return { kind: "predicate", source: "answer", key: "", operator: "equals", value: "" };
}

function ConditionEditor({ condition, blocks, disabled, depth = 0, onChange, onRemove }: ConditionProps) {
  if (condition.kind === "predicate") {
    const needsValue = !["is_empty", "is_not_empty", "file_uploaded", "file_approved"].includes(condition.operator);
    return (
      <div className="grid gap-2 rounded-lg border bg-white p-2 md:grid-cols-[130px_minmax(150px,1fr)_150px_minmax(120px,1fr)_32px]">
        <select disabled={disabled} value={condition.source} onChange={(event) => onChange({ ...condition, source: event.target.value as typeof condition.source })} className="h-9 rounded-lg border px-2 text-xs">
          <option value="answer">Resposta</option><option value="variable">Variável</option><option value="context">Contexto</option><option value="stage">Etapa</option><option value="upload">Upload</option><option value="evaluation">Avaliação</option>
        </select>
        {condition.source === "answer" ? (
          <select disabled={disabled} value={condition.key} onChange={(event) => onChange({ ...condition, key: event.target.value })} className="h-9 rounded-lg border px-2 text-xs">
            <option value="">Selecione o bloco</option>{blocks.map((block) => <option key={block.id} value={block.id}>{block.label}</option>)}
          </select>
        ) : <input disabled={disabled} value={condition.key} onChange={(event) => onChange({ ...condition, key: event.target.value })} placeholder="chave.do.campo" className="h-9 rounded-lg border px-2 text-xs" />}
        <select disabled={disabled} value={condition.operator} onChange={(event) => onChange({ ...condition, operator: event.target.value as typeof condition.operator })} className="h-9 rounded-lg border px-2 text-xs">{OPERATORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        {needsValue ? <input disabled={disabled} value={String(condition.value ?? "")} onChange={(event) => onChange({ ...condition, value: event.target.value })} placeholder="Valor" className="h-9 rounded-lg border px-2 text-xs" /> : <span className="grid h-9 place-items-center rounded-lg bg-slate-50 text-xs text-slate-400">sem valor</span>}
        {onRemove && !disabled ? <button type="button" onClick={onRemove} className="grid h-9 place-items-center text-rose-500"><Trash2 className="h-4 w-4" /></button> : <span />}
      </div>
    );
  }

  return (
    <div className={`space-y-2 rounded-xl border p-3 ${depth % 2 ? "bg-indigo-50/40" : "bg-slate-50"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-black uppercase text-slate-500">Grupo</span>
        <select disabled={disabled} value={condition.operator} onChange={(event) => onChange({ ...condition, operator: event.target.value as "and" | "or" | "not", conditions: event.target.value === "not" ? [condition.conditions[0] ?? emptyPredicate()] : condition.conditions })} className="h-8 rounded-lg border px-2 text-xs font-bold">
          <option value="and">Todas (E)</option><option value="or">Qualquer (OU)</option><option value="not">Negar (NÃO)</option>
        </select>
        {!disabled && condition.operator !== "not" ? <><button type="button" onClick={() => onChange({ ...condition, conditions: [...condition.conditions, emptyPredicate()] })} className="inline-flex h-8 items-center gap-1 rounded-lg border bg-white px-2 text-xs font-bold"><Plus className="h-3 w-3" />Condição</button><button type="button" onClick={() => onChange({ ...condition, conditions: [...condition.conditions, { kind: "group", operator: "and", conditions: [emptyPredicate()] }] })} className="inline-flex h-8 items-center gap-1 rounded-lg border bg-white px-2 text-xs font-bold"><GitBranch className="h-3 w-3" />Subgrupo</button></> : null}
        {onRemove && !disabled ? <button type="button" onClick={onRemove} className="ml-auto text-rose-500"><Trash2 className="h-4 w-4" /></button> : null}
      </div>
      {condition.conditions.map((child, index) => <ConditionEditor key={index} condition={child} blocks={blocks} disabled={disabled} depth={depth + 1} onChange={(next) => onChange({ ...condition, conditions: condition.conditions.map((item, childIndex) => childIndex === index ? next : item) })} onRemove={condition.conditions.length > 1 ? () => onChange({ ...condition, conditions: condition.conditions.filter((_, childIndex) => childIndex !== index) }) : undefined} />)}
    </div>
  );
}

export function IntegrationRulesPanel({ draft, disabled, onChange }: { draft: IntegrationTemplateVersion; disabled: boolean; onChange: (rules: IntegrationRule[]) => void }) {
  const issues = useMemo(() => validateIntegrationTemplate(draft), [draft]);

  function addRule() {
    onChange([...draft.rules, { id: `rule_${Date.now()}`, label: "Nova regra", active: true, priority: 0, condition: { kind: "group", operator: "and", conditions: [emptyPredicate()] }, actions: [{ id: `action_${Date.now()}`, type: "show_block", targetId: draft.blocks[0]?.id, config: {} }] }]);
  }
  function patchRule(ruleId: string, patch: Partial<IntegrationRule>) { onChange(draft.rules.map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule)); }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border bg-white p-4"><div><h3 className="font-black">Regras condicionais</h3><p className="text-xs text-slate-500">Crie cascatas com grupos E, OU e NÃO, sem limite funcional de profundidade.</p></div>{!disabled ? <button type="button" onClick={addRule} className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-bold text-white"><Plus className="h-4 w-4" />Regra</button> : null}</div>
      {issues.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">{issues.map((issue, index) => <p key={`${issue.code}-${index}`} className="flex gap-2 text-xs font-semibold text-amber-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{issue.message}</p>)}</div> : null}
      {draft.rules.map((rule) => (
        <div key={rule.id} className="space-y-3 rounded-xl border bg-white p-4">
          <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_100px_auto]">
            <input disabled={disabled} value={rule.label} onChange={(event) => patchRule(rule.id, { label: event.target.value })} className="h-10 rounded-lg border px-3 text-sm font-black" />
            <input disabled={disabled} type="number" value={rule.priority} onChange={(event) => patchRule(rule.id, { priority: Number(event.target.value) })} title="Prioridade" className="h-10 rounded-lg border px-3 text-sm" />
            {!disabled ? <button type="button" onClick={() => onChange(draft.rules.filter((item) => item.id !== rule.id))} className="grid h-10 w-10 place-items-center text-rose-500"><Trash2 className="h-4 w-4" /></button> : null}
          </div>
          <ConditionEditor condition={rule.condition} blocks={draft.blocks} disabled={disabled} onChange={(condition) => patchRule(rule.id, { condition })} />
          <div className="space-y-2"><p className="text-xs font-black uppercase text-slate-400">Então</p>{rule.actions.map((action, index) => {
            const targetsStages = ["skip_stage", "activate_stage"].includes(action.type);
            const hasTarget = !["notify", "block_progress", "complete_integration", "create_task", "generate_document", "request_signature"].includes(action.type);
            return <div key={action.id} className="grid gap-2 rounded-lg bg-slate-50 p-2 md:grid-cols-[200px_minmax(160px,1fr)_32px]"><select disabled={disabled} value={action.type} onChange={(event) => patchRule(rule.id, { actions: rule.actions.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as typeof item.type } : item) })} className="h-9 rounded-lg border px-2 text-xs">{ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{hasTarget ? <select disabled={disabled} value={action.targetId ?? ""} onChange={(event) => patchRule(rule.id, { actions: rule.actions.map((item, itemIndex) => itemIndex === index ? { ...item, targetId: event.target.value } : item) })} className="h-9 rounded-lg border px-2 text-xs"><option value="">Selecione o destino</option>{(targetsStages ? draft.stages : draft.blocks).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <input disabled={disabled} value={String(action.config.message ?? "")} onChange={(event) => patchRule(rule.id, { actions: rule.actions.map((item, itemIndex) => itemIndex === index ? { ...item, config: { ...item.config, message: event.target.value } } : item) })} placeholder="Mensagem/configuração" className="h-9 rounded-lg border px-2 text-xs" />}{!disabled ? <button type="button" disabled={rule.actions.length === 1} onClick={() => patchRule(rule.id, { actions: rule.actions.filter((_, itemIndex) => itemIndex !== index) })} className="grid h-9 place-items-center text-rose-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button> : null}</div>;
          })}{!disabled ? <button type="button" onClick={() => patchRule(rule.id, { actions: [...rule.actions, { id: `action_${Date.now()}`, type: "show_block", targetId: draft.blocks[0]?.id, config: {} }] })} className="inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-bold"><Plus className="h-3 w-3" />Ação</button> : null}</div>
        </div>
      ))}
      {!draft.rules.length ? <p className="rounded-xl border border-dashed bg-white py-12 text-center text-sm text-slate-500">Nenhuma regra condicional configurada.</p> : null}
    </div>
  );
}

export function IntegrationSimulatorPanel({ draft }: { draft: IntegrationTemplateVersion }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const result = useMemo(() => simulateIntegrationTemplate(draft, { answers }), [answers, draft]);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-xl border bg-white p-4"><div className="mb-4 flex items-center gap-2"><Play className="h-4 w-4 text-emerald-600" /><div><h3 className="font-black">Simular respostas</h3><p className="text-xs text-slate-500">Altere valores e veja a cascata recalculada imediatamente.</p></div></div><div className="space-y-2">{draft.blocks.filter((block) => result.visibleBlockIds.includes(block.id)).map((block) => <label key={block.id} className="grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-[minmax(160px,1fr)_minmax(160px,1fr)] md:items-center"><span className="text-sm font-bold">{block.label}{result.requiredBlockIds.includes(block.id) ? <b className="text-rose-500"> *</b> : null}</span><input value={String(answers[block.id] ?? "")} onChange={(event) => setAnswers((current) => ({ ...current, [block.id]: event.target.value }))} className="h-9 rounded-lg border bg-white px-3 text-sm" /></label>)}</div></div>
      <aside className="space-y-3"><div className="rounded-xl border bg-white p-4"><p className="text-xs font-black uppercase text-slate-400">Resultado</p><p className="mt-2 text-sm"><b>{result.visibleStageIds.length}</b> etapas visíveis</p><p className="text-sm"><b>{result.visibleBlockIds.length}</b> blocos visíveis</p><p className="text-sm"><b>{result.triggeredRuleIds.length}</b> regras acionadas</p></div><div className={`rounded-xl border p-4 ${result.blockedReasons.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}><p className="text-xs font-black uppercase">Validação</p>{result.blockedReasons.length ? result.blockedReasons.map((reason) => <p key={reason} className="mt-2 text-xs font-semibold">{reason}</p>) : <p className="mt-2 text-xs font-semibold">Fluxo liberado para avançar.</p>}</div></aside>
    </div>
  );
}
