"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X } from "lucide-react";
import { auth } from "@/lib/firebase";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { CadastrosHero, EmptyResults, ListShell, ListSkeleton, SoftPill } from "@/components/cadastros/cadastros-ui";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { errorMessageOf, PanelErrorNote, PanelFormFooter, PanelSelectField, PanelSwitchRow } from "@/components/patterns/panel-form";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buildPlanTree,
  collectDescendantIds,
  DRE_POSITIONS,
  dreLabel,
  flattenPlan,
  matchesFinanceQuery,
  normalizeFinanceText,
  summarizePlan,
  type PlanNode,
} from "./settings-model";

type Account = {
  id: string;
  name: string;
  description?: string;
  parentId?: string | null;
  dre_position?: string | null;
  is_dre_account?: boolean;
  searchTerms?: string[];
  order?: number;
  active?: boolean;
  isGroup?: boolean;
};

type PanelState =
  | { mode: "view"; item: Account; number: string }
  | { mode: "edit"; item: Account; number: string }
  | { mode: "create"; parentId: string | null };

const accountFormSchema = z.object({
  name: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres."),
  description: z.string().optional(),
  parentId: z.string().nullable().optional(),
  includeInDre: z.boolean(),
  dre_position: z.string().nullable().optional(),
  isPatrimonial: z.boolean().default(false),
});
type AccountFormValues = z.infer<typeof accountFormSchema>;

type SavePayload = { values: AccountFormValues; searchTerms: string[] };

async function apiRequest(method: "POST" | "PATCH" | "DELETE", body?: unknown, queryId?: string) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Não autenticado.");
  const url = queryId ? `/api/financial/accounts?id=${queryId}` : "/api/financial/accounts";
  const res = await fetchWithTimeout(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || "Erro na operação.");
  return payload;
}

async function persistOrder(ids: string[]) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Não autenticado.");
  const responses = await Promise.all(
    ids.map((id, index) =>
      fetchWithTimeout("/api/financial/accounts", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id, order: index }),
      })
    )
  );
  if (responses.some((response) => !response.ok)) throw new Error("Não foi possível salvar a nova ordem.");
}

function ClassificationPill({ account }: { account: Account }) {
  if (account.is_dre_account === false) return <StatusPill variant="neutral">Patrimonial</StatusPill>;
  const label = dreLabel(account.dre_position);
  return label ? <StatusPill variant="info">{label}</StatusPill> : null;
}

/* ───────────────────────── Linha do plano ───────────────────────── */

type RowHandlers = {
  expanded: ReadonlySet<string>;
  canManage: boolean;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onOpen: (account: Account, number: string) => void;
  onReorder: (ids: string[]) => void;
};

function PlanRowBody({
  node,
  number,
  depth,
  expanded,
  selected,
  handle,
  onToggle,
  onOpen,
}: {
  node: PlanNode<Account>;
  number: string;
  depth: number;
  expanded: boolean;
  selected: boolean;
  handle?: React.ReactNode;
  onToggle: (() => void) | null;
  onOpen: () => void;
}) {
  const hasChildren = node.children.length > 0;
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-ds-divider px-3 py-1.5 transition-colors hover:bg-ds-surface",
        selected && "bg-ds-accent-soft/40",
        node.active === false && "opacity-60"
      )}
      style={{ paddingLeft: `${12 + depth * 22}px` }}
    >
      {handle ?? <span className="h-6 w-5 shrink-0" aria-hidden="true" />}
      {onToggle && hasChildren ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Recolher" : "Expandir"} ${node.name}`}
          onClick={onToggle}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-ds-sm text-[11px] text-ds-ink-faint hover:bg-ds-muted hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
        >
          {expanded ? "▾" : "▸"}
        </button>
      ) : (
        <span className="h-6 w-6 shrink-0" aria-hidden="true" />
      )}
      <button
        type="button"
        aria-label={`Abrir ${node.name}`}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-ds-sm py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
      >
        <span className="w-12 shrink-0 font-ds-mono text-[11px] tabular-nums text-ds-ink-faint">{number}</span>
        <span className={cn("min-w-0 truncate text-[13.5px]", depth === 0 ? "font-bold" : "font-semibold")}>{node.name}</span>
        {node.active === false ? <StatusPill variant="neutral">Inativa</StatusPill> : null}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <ClassificationPill account={node} />
          <span className="text-[13px] text-ds-ink-faint">›</span>
        </span>
      </button>
    </div>
  );
}

function SortableRow({ node, number, depth, handlers }: { node: PlanNode<Account>; number: string; depth: number; handlers: RowHandlers }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  const isExpanded = handlers.expanded.has(node.id);
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}>
      <PlanRowBody
        node={node}
        number={number}
        depth={depth}
        expanded={isExpanded}
        selected={handlers.selectedId === node.id}
        onToggle={() => handlers.onToggle(node.id)}
        onOpen={() => handlers.onOpen(node, number)}
        handle={
          handlers.canManage ? (
            <button
              type="button"
              aria-label={`Reordenar ${node.name}`}
              className="flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-ds-sm text-ds-ink-faint hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              ⋮⋮
            </button>
          ) : undefined
        }
      />
      {node.children.length > 0 && isExpanded ? <Level nodes={node.children} depth={depth + 1} prefix={number} handlers={handlers} /> : null}
    </div>
  );
}

function Level({ nodes, depth, prefix, handlers }: { nodes: Array<PlanNode<Account>>; depth: number; prefix: string; handlers: RowHandlers }) {
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [items, setItems] = useState(nodes);
  useEffect(() => setItems(nodes), [nodes]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const reordered = arrayMove(items, items.findIndex((item) => item.id === active.id), items.findIndex((item) => item.id === over.id));
    setItems(reordered);
    handlers.onReorder(reordered.map((item) => item.id));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        {items.map((node, index) => (
          <SortableRow key={node.id} node={node} number={prefix ? `${prefix}.${index + 1}` : String(index + 1)} depth={depth} handlers={handlers} />
        ))}
      </SortableContext>
    </DndContext>
  );
}

/* ───────────────────────── Tela ───────────────────────── */

type ClassFilter = "all" | "dre" | "patrimonial" | "unclassified";

export default function AccountPlansManagement({ canManage = true }: { canManage?: boolean }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState<ClassFilter>("all");
  const [panel, setPanel] = useState<PanelState | null>(null);

  const load = useCallback(async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    setLoadError(null);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetchWithTimeout("/api/financial/data?path=accounts", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Falha ao carregar contas.");
      setAccounts((payload.docs ?? []) as Account[]);
    } catch (error) {
      setLoadError(errorMessageOf(error, "Erro desconhecido."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tree = useMemo(() => buildPlanTree(accounts), [accounts]);
  const [rootItems, setRootItems] = useState<Array<PlanNode<Account>>>([]);
  useEffect(() => setRootItems(tree), [tree]);

  const summary = useMemo(() => summarizePlan(accounts), [accounts]);
  const filtering = query.trim().length > 0 || classFilter !== "all";
  const matcher = useMemo(() => {
    if (!filtering) return null;
    return (item: Account) => {
      const inClass =
        classFilter === "all" ||
        (classFilter === "patrimonial" ? item.is_dre_account === false : classFilter === "dre" ? item.is_dre_account !== false && !!item.dre_position : item.is_dre_account !== false && !item.dre_position);
      return inClass && matchesFinanceQuery(query, item.name, item.description, dreLabel(item.dre_position), ...(item.searchTerms ?? []));
    };
  }, [filtering, query, classFilter]);

  const flatRows = useMemo(() => flattenPlan(tree, expanded, matcher), [tree, expanded, matcher]);

  const reorder = useCallback(async (ids: string[]) => {
    setOrderError(null);
    try {
      await persistOrder(ids);
    } catch (error) {
      setOrderError(errorMessageOf(error, "Não foi possível salvar a nova ordem."));
      void load();
    }
  }, [load]);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  function handleRootDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const reordered = arrayMove(rootItems, rootItems.findIndex((item) => item.id === active.id), rootItems.findIndex((item) => item.id === over.id));
    setRootItems(reordered);
    void reorder(reordered.map((item) => item.id));
  }

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allExpanded = expanded.size > 0;

  async function save({ values, searchTerms }: SavePayload, current: Account | null) {
    const dre_position = values.includeInDre ? values.dre_position ?? null : null;
    const is_dre_account = values.isPatrimonial ? false : true;
    const searchTermsPayload = searchTerms.length > 0 ? searchTerms : null;
    if (current) {
      await apiRequest("PATCH", {
        id: current.id,
        name: values.name,
        description: values.description ?? null,
        parentId: values.parentId ?? null,
        dre_position,
        is_dre_account,
        searchTerms: searchTermsPayload,
      });
      setAccounts((prev) =>
        prev.map((item) =>
          item.id === current.id
            ? { ...item, name: values.name, description: values.description, parentId: values.parentId ?? null, dre_position, is_dre_account, searchTerms: searchTermsPayload ?? undefined }
            : item
        )
      );
      return;
    }
    const siblings = accounts.filter((item) => (item.parentId ?? null) === (values.parentId ?? null));
    const { id } = await apiRequest("POST", {
      name: values.name,
      description: values.description ?? null,
      parentId: values.parentId ?? null,
      dre_position,
      is_dre_account,
      order: siblings.length,
      searchTerms: searchTermsPayload,
    });
    setAccounts((prev) => [
      ...prev,
      { id, name: values.name, description: values.description, parentId: values.parentId ?? null, dre_position, is_dre_account, searchTerms: searchTermsPayload ?? undefined, order: siblings.length, active: true },
    ]);
    if (values.parentId) setExpanded((prev) => new Set([...prev, values.parentId!]));
  }

  async function remove(item: Account) {
    if (accounts.some((entry) => entry.parentId === item.id)) throw new Error("Remova as subcontas primeiro.");
    await apiRequest("DELETE", undefined, item.id);
    setAccounts((prev) => prev.filter((entry) => entry.id !== item.id));
  }

  const handlers: RowHandlers = {
    expanded,
    canManage,
    selectedId: panel && panel.mode !== "create" ? panel.item.id : null,
    onToggle: toggle,
    onOpen: (item, number) => setPanel({ mode: "view", item, number }),
    onReorder: (ids) => void reorder(ids),
  };

  const chips = [
    { id: "all", label: "Todas", count: summary.total },
    { id: "dre", label: "Na DRE", count: summary.dre },
    { id: "patrimonial", label: "Patrimoniais", count: summary.patrimonial },
    { id: "unclassified", label: "Sem classificação", count: summary.unclassified },
  ];

  return (
    <div className="space-y-5">
      <CadastrosHero
        kicker="Plano de contas"
        tabs={null}
        search={{ value: query, placeholder: "Buscar conta, descrição ou palavra-chave", onChange: setQuery }}
        manage={accounts.length > 0 && !filtering ? { label: allExpanded ? "Recolher tudo" : "Expandir tudo", onClick: () => setExpanded(allExpanded ? new Set() : new Set(accounts.map((item) => item.id))) } : undefined}
        primary={canManage ? { label: "Nova conta raiz", onClick: () => setPanel({ mode: "create", parentId: null }) } : undefined}
        chips={chips}
        activeChip={classFilter}
        onChip={(id) => setClassFilter(id as ClassFilter)}
      />

      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[28px] font-extrabold tracking-[-0.03em]">{filtering ? flatRows.length : summary.total}</span>
        <span className="text-[13px] text-ds-ink-faint">{filtering ? `de ${summary.total} contas` : "contas"}</span>
        <span className="text-[13px] text-ds-ink-muted">· Categorias e subcontas que classificam despesas e resultados.</span>
      </div>
      {filtering ? <p className="-mt-3 text-xs text-ds-ink-muted">Com filtro ou busca ativa a lista aparece sem hierarquia e sem reordenação.</p> : null}

      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-ds-card border border-ds-confirm-border bg-ds-confirm-bg px-5 py-4">
          <p className="text-[13px] font-semibold text-ds-confirm-ink">{loadError}</p>
          <Button type="button" variant="ds-secondary" size="md" onClick={() => void load()}>Tentar novamente</Button>
        </div>
      ) : null}
      <PanelErrorNote message={orderError} />

      {loading ? (
        <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Carregando plano de contas">
          <ListSkeleton rows={6} />
        </div>
      ) : (
        <ListShell minWidth={720}>
          {filtering ? (
            flatRows.length > 0 ? (
              flatRows.map((row) => (
                <PlanRowBody
                  key={row.item.id}
                  node={row.item}
                  number={row.number}
                  depth={0}
                  expanded={false}
                  selected={handlers.selectedId === row.item.id}
                  onToggle={null}
                  onOpen={() => handlers.onOpen(row.item, row.number)}
                />
              ))
            ) : (
              <EmptyResults title="Nenhuma conta encontrada com esses filtros." onClear={() => { setQuery(""); setClassFilter("all"); }} />
            )
          ) : rootItems.length > 0 ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRootDragEnd}>
              <SortableContext items={rootItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                {rootItems.map((node, index) => (
                  <SortableRow key={node.id} node={node} number={String(index + 1)} depth={0} handlers={handlers} />
                ))}
              </SortableContext>
            </DndContext>
          ) : !loadError ? (
            <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhuma conta cadastrada.</p>
          ) : null}
        </ListShell>
      )}

      <AccountPanel
        state={panel}
        accounts={accounts}
        canManage={canManage}
        onClose={() => setPanel(null)}
        onMode={setPanel}
        onSave={save}
        onRemove={remove}
      />
    </div>
  );
}

/* ───────────────────────── Painel ───────────────────────── */

function AccountPanel({
  state,
  accounts,
  canManage,
  onClose,
  onMode,
  onSave,
  onRemove,
}: {
  state: PanelState | null;
  accounts: Account[];
  canManage: boolean;
  onClose: () => void;
  onMode: (state: PanelState) => void;
  onSave: (payload: SavePayload, current: Account | null) => Promise<void>;
  onRemove: (item: Account) => Promise<void>;
}) {
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { name: "", description: "", parentId: null, includeInDre: false, dre_position: null, isPatrimonial: false },
  });
  const { register, control, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = form;
  const includeInDre = watch("includeInDre");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [terms, setTerms] = useState<string[]>([]);
  const [termInput, setTermInput] = useState("");
  const item = state && state.mode !== "create" ? state.item : null;
  const editing = state?.mode === "edit" || state?.mode === "create";

  useEffect(() => {
    setSaveError(null);
    setConfirmingDelete(false);
    setTermInput("");
    if (!state || state.mode === "view") return;
    if (state.mode === "edit") {
      reset({
        name: state.item.name,
        description: state.item.description ?? "",
        parentId: state.item.parentId ?? null,
        includeInDre: !!state.item.dre_position,
        dre_position: state.item.dre_position ?? null,
        isPatrimonial: state.item.is_dre_account === false,
      });
      setTerms(state.item.searchTerms ?? []);
    } else {
      reset({ name: "", description: "", parentId: state.parentId, includeInDre: false, dre_position: null, isPatrimonial: false });
      setTerms([]);
    }
  }, [state, reset]);

  const parentOptions = useMemo(() => {
    const blocked = item ? collectDescendantIds(accounts, item.id) : new Set<string>();
    if (item) blocked.add(item.id);
    return accounts.filter((account) => !blocked.has(account.id)).map((account) => ({ id: account.id, name: account.name }));
  }, [accounts, item]);

  const hasChildren = item ? accounts.some((account) => account.parentId === item.id) : false;
  const parentName = item?.parentId ? accounts.find((account) => account.id === item.parentId)?.name : undefined;

  function addTerm() {
    const term = termInput.trim();
    if (!term) return;
    const normalized = normalizeFinanceText(term);
    if (!terms.some((existing) => normalizeFinanceText(existing) === normalized)) setTerms((current) => [...current, term]);
    setTermInput("");
  }

  return (
    <SidePanel
      open={!!state}
      onOpenChange={(open) => { if (!open) onClose(); }}
      kicker={state?.mode === "create" ? "Nova conta" : state?.mode === "edit" ? "Editar conta" : "Conta"}
      title={state?.mode === "create" ? "Sem nome" : item?.name ?? ""}
      subtitle={state && state.mode !== "create" ? `Posição ${state.number} no plano de contas` : "Categoria ou subconta do plano."}
    >
      {state && !editing && item ? (
        <>
          <PanelSection title="Classificação">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <PanelField label="Situação"><StatusPill variant={item.active === false ? "neutral" : "ok"}>{item.active === false ? "Inativa" : "Ativa"}</StatusPill></PanelField>
              <PanelField label="Conta pai">{parentName ?? "Raiz"}</PanelField>
            </div>
            <PanelField label="Demonstrativo">
              {item.is_dre_account === false ? "Patrimonial (fora da DRE)" : dreLabel(item.dre_position) ?? "Sem posição na DRE"}
            </PanelField>
          </PanelSection>
          <PanelSection title="Uso">
            <PanelField label="Descrição">{item.description?.trim() || "Sem descrição cadastrada."}</PanelField>
            <PanelField label="Palavras-chave">
              {item.searchTerms?.length ? (
                <span className="flex flex-wrap gap-1.5">{item.searchTerms.map((term) => <SoftPill key={term}>{term}</SoftPill>)}</span>
              ) : (
                "Sem palavras-chave cadastradas."
              )}
            </PanelField>
          </PanelSection>
          {canManage ? (
            <div className="mt-auto space-y-3 border-t border-ds-divider pt-4">
              {confirmingDelete ? (
                <InlineConfirm
                  message={`Excluir “${item.name}”? Despesas já lançadas nessa conta não são afetadas.`}
                  loading={deleting}
                  onCancel={() => setConfirmingDelete(false)}
                  onConfirm={async () => {
                    setDeleting(true);
                    setSaveError(null);
                    try {
                      await onRemove(item);
                      onClose();
                    } catch (error) {
                      setConfirmingDelete(false);
                      setSaveError(errorMessageOf(error, "Não foi possível excluir a conta."));
                    } finally {
                      setDeleting(false);
                    }
                  }}
                />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="primary-modal" size="md" onClick={() => onMode({ mode: "edit", item, number: state.number })}>Editar conta</Button>
                  <Button type="button" variant="ds-secondary" size="md" onClick={() => onMode({ mode: "create", parentId: item.id })}>Adicionar subconta</Button>
                  <Button type="button" variant="danger-link" size="md" disabled={hasChildren} onClick={() => setConfirmingDelete(true)} className="col-span-2">Excluir conta</Button>
                </div>
              )}
              {hasChildren && !confirmingDelete ? <p className="text-xs text-ds-ink-muted">Remova ou mova as subcontas antes de excluir esta conta.</p> : null}
              <PanelErrorNote message={saveError} />
            </div>
          ) : null}
        </>
      ) : null}

      {state && editing ? (
        <form
          noValidate
          className="flex flex-1 flex-col gap-5"
          onSubmit={handleSubmit(async (values) => {
            setSaveError(null);
            try {
              await onSave({ values, searchTerms: terms }, item);
              onClose();
            } catch (error) {
              setSaveError(errorMessageOf(error, "Não foi possível salvar a conta."));
            }
          })}
        >
          <Field label="Nome" htmlFor="account-name" error={errors.name?.message}>
            <Input id="account-name" placeholder="Ex.: Salários" aria-invalid={!!errors.name} className={fieldInputClass} {...register("name")} />
          </Field>
          <Field label="Descrição" htmlFor="account-description" requirement="opcional">
            <Textarea id="account-description" rows={2} placeholder="Descreva o uso desta conta." className={cn(fieldInputClass, "h-auto py-2.5")} {...register("description")} />
          </Field>
          <Field label="Palavras-chave de busca" htmlFor="account-terms" requirement="opcional" hint="Direcionam as buscas para esta conta: “uniforme” encontra a conta mesmo que o nome não contenha a palavra.">
            <div className="flex gap-2">
              <Input
                id="account-terms"
                value={termInput}
                onChange={(event) => setTermInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTerm();
                  }
                }}
                placeholder="Ex.: uniforme, EPI, fardamento"
                className={fieldInputClass}
              />
              <Button type="button" variant="ds-secondary" size="md" disabled={!termInput.trim()} onClick={addTerm}>Adicionar</Button>
            </div>
            {terms.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {terms.map((term) => (
                  <span key={term} className="inline-flex items-center gap-1 rounded-full bg-ds-muted px-2.5 py-1 text-xs font-semibold text-ds-ink-2">
                    {term}
                    <button type="button" aria-label={`Remover ${term}`} onClick={() => setTerms((current) => current.filter((entry) => entry !== term))} className="text-ds-ink-faint hover:text-ds-ink">
                      <X aria-hidden="true" className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </Field>
          <Controller control={control} name="parentId" render={({ field }) => (
            <PanelSelectField id="account-parent" label="Conta pai" requirement="opcional" value={field.value} onChange={(value) => field.onChange(value || null)} noneLabel="Sem pai (raiz)" options={parentOptions} />
          )} />
          <Controller control={control} name="includeInDre" render={({ field }) => (
            <PanelSwitchRow
              id="account-dre"
              label="Entra na DRE"
              description="Vincule esta conta a uma posição do demonstrativo de resultados."
              checked={field.value}
              onChange={(checked) => {
                field.onChange(checked);
                if (!checked) setValue("dre_position", null);
                if (checked) setValue("isPatrimonial", false);
              }}
            />
          )} />
          {!includeInDre ? (
            <Controller control={control} name="isPatrimonial" render={({ field }) => (
              <PanelSwitchRow id="account-patrimonial" label="Conta patrimonial" description="Estoque, ativo imobilizado, aplicações. Não aparece na DRE nem em “Não classificado”." checked={field.value} onChange={field.onChange} />
            )} />
          ) : (
            <Controller control={control} name="dre_position" render={({ field }) => (
              <PanelSelectField id="account-dre-position" label="Posição na DRE" value={field.value} onChange={(value) => field.onChange(value || null)} noneLabel="Sem posição" options={DRE_POSITIONS.map((entry) => ({ id: entry.value, name: entry.label }))} />
            )} />
          )}
          <PanelErrorNote message={saveError} />
          <PanelFormFooter submitting={isSubmitting} creating={state.mode === "create"} noun="conta" onCancel={() => (item && state.mode === "edit" ? onMode({ mode: "view", item, number: state.number }) : onClose())} />
        </form>
      ) : null}
    </SidePanel>
  );
}
