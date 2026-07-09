"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertCircle, ChevronDown, ChevronRight, GripVertical, Info, Loader2, MoreHorizontal, PlusCircle, X,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ── constants ─────────────────────────────────────────────────────────────────

const DRE_POSITIONS = [
  { value: "impostos_deducoes",       label: "Impostos e deduções" },
  { value: "custos_variaveis",        label: "Custos variáveis" },
  { value: "pessoal",                 label: "Pessoal" },
  { value: "despesas_operacionais",   label: "Despesas operacionais" },
  { value: "ocupacao",                label: "Ocupação" },
  { value: "despesas_financeiras",    label: "Despesas financeiras" },
  { value: "receita_financeira",      label: "Receita financeira" },
  { value: "receita_nao_operacional", label: "Receita não operacional" },
  { value: "despesa_nao_operacional", label: "Despesa não operacional" },
  { value: "impostos_resultado",      label: "IR / CSLL" },
] as const;

const DRE_POS_COLORS: Record<string, string> = {
  impostos_deducoes:       "text-red-700 bg-red-50 border-red-200",
  custos_variaveis:        "text-orange-700 bg-orange-50 border-orange-200",
  pessoal:                 "text-blue-700 bg-blue-50 border-blue-200",
  despesas_operacionais:   "text-purple-700 bg-purple-50 border-purple-200",
  ocupacao:                "text-indigo-700 bg-indigo-50 border-indigo-200",
  despesas_financeiras:    "text-rose-700 bg-rose-50 border-rose-200",
  receita_financeira:      "text-teal-700 bg-teal-50 border-teal-200",
  receita_nao_operacional: "text-slate-700 bg-slate-50 border-slate-200",
  despesa_nao_operacional: "text-slate-700 bg-slate-50 border-slate-200",
  impostos_resultado:      "text-amber-700 bg-amber-50 border-amber-200",
};

const GROUP_COLORS = [
  "#22c55e","#3b82f6","#8b5cf6","#eab308",
  "#ef4444","#ec4899","#14b8a6","#f97316",
];

// ── types & schema ────────────────────────────────────────────────────────────

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
  children?: Account[];
};

const accountFormSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres."),
  description: z.string().optional(),
  parentId: z.string().nullable().optional(),
  includeInDre: z.boolean(),
  dre_position: z.string().nullable().optional(),
  isPatrimonial: z.boolean().default(false),
});
type AccountFormValues = z.infer<typeof accountFormSchema>;

// ── helpers ───────────────────────────────────────────────────────────────────

function buildTree(items: Account[], parentId: string | null = null): Account[] {
  return items
    .filter((item) => (item.parentId ?? null) === parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((item) => ({ ...item, children: buildTree(items, item.id) }));
}

function collectDescendantIds(items: Account[], parentId: string): Set<string> {
  const result = new Set<string>();
  const visit = (id: string) => {
    items
      .filter((item) => item.parentId === id)
      .forEach((child) => {
        if (result.has(child.id)) return;
        result.add(child.id);
        visit(child.id);
      });
  };
  visit(parentId);
  return result;
}

async function apiRequest(
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
  queryId?: string
) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Não autenticado.");
  const url = queryId
    ? `/api/financial/accounts?id=${queryId}`
    : "/api/financial/accounts";
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
  if (!token) return;
  await Promise.all(
    ids.map((id, index) =>
      fetchWithTimeout("/api/financial/accounts", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id, order: index }),
      })
    )
  );
}

function DreBadge({ position, isPatrimonial }: { position?: string | null; isPatrimonial?: boolean }) {
  if (isPatrimonial) {
    return (
      <span className="ml-1.5 shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
        Patrimonial
      </span>
    );
  }
  if (!position) return null;
  const pos = DRE_POSITIONS.find((p) => p.value === position);
  if (!pos) return null;
  return (
    <span className={cn("ml-1.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium", DRE_POS_COLORS[position] ?? "")}>
      {pos.label}
    </span>
  );
}

function AccountInfoTooltip({ account }: { account: Account }) {
  const description = account.description?.trim();
  const searchTerms = (account.searchTerms ?? []).filter((term) => term.trim().length > 0);
  const hasMetadata = !!description || searchTerms.length > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            hasMetadata && "text-slate-500"
          )}
          aria-label={`Ver descrição e palavras-chave de ${account.name}`}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-sm p-3">
        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Descrição</p>
            <p className="mt-1 text-xs leading-relaxed text-foreground">
              {description || "Sem descrição cadastrada."}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Palavras-chave</p>
            {searchTerms.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {searchTerms.map((term) => (
                  <span key={term} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                    {term}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Sem palavras-chave cadastradas.</p>
            )}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ── sortable row (any depth) ──────────────────────────────────────────────────

function SortableRow({
  node,
  number,
  depth,
  topLevelIndex,
  expanded,
  canManage,
  onToggle,
  onEdit,
  onDelete,
  onAddChild,
}: {
  node: Account;
  number: string;
  depth: number;
  topLevelIndex: number;
  expanded: Set<string>;
  canManage: boolean;
  onToggle: (id: string) => void;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
  onAddChild: (parentId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const color = GROUP_COLORS[topLevelIndex % GROUP_COLORS.length];
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isExpanded = expanded.has(node.id);
  const isRoot = depth === 0;

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-transparent px-2 py-2 text-sm transition-colors",
          isRoot ? "hover:bg-muted/80" : "hover:bg-muted/70",
          isDragging && "border-border bg-muted/20"
        )}
        style={{ paddingLeft: `${8 + depth * 20}px` }}
      >
        {/* drag handle */}
        {canManage && (
          <button
            type="button"
            className="flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        {/* expand toggle */}
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground"
          onClick={() => hasChildren && onToggle(node.id)}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <span className="h-3.5 w-3.5" />
          )}
        </button>

        {/* color dot */}
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color, opacity: isRoot ? 1 : 0.5 }}
        />

        {/* number */}
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{number}</span>

        {/* name */}
        <div className={cn("flex min-w-0 flex-1 items-center gap-1.5", isRoot && "font-semibold")}>
          <span className="min-w-0 truncate">{node.name}</span>
          <AccountInfoTooltip account={node} />
        </div>

        {/* dre badge */}
        <DreBadge position={node.dre_position} isPatrimonial={node.is_dre_account === false} />

        {/* actions */}
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {node.name}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onAddChild(node.id)}>
                <PlusCircle className="mr-2 h-3.5 w-3.5" />
                Adicionar subconta
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(node)}>Editar</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(node)}
              >
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* children */}
      {hasChildren && isExpanded && (
        <ChildrenLevel
          nodes={node.children!}
          depth={depth + 1}
          topLevelIndex={topLevelIndex}
          expanded={expanded}
          canManage={canManage}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddChild={onAddChild}
          parentNumber={number}
        />
      )}
    </div>
  );
}

// ── children level (sortable context per parent) ──────────────────────────────

function ChildrenLevel({
  nodes,
  depth,
  topLevelIndex,
  expanded,
  canManage,
  onToggle,
  onEdit,
  onDelete,
  onAddChild,
  parentNumber,
}: {
  nodes: Account[];
  depth: number;
  topLevelIndex: number;
  expanded: Set<string>;
  canManage: boolean;
  onToggle: (id: string) => void;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
  onAddChild: (parentId: string) => void;
  parentNumber: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const [items, setItems] = useState(nodes);
  useEffect(() => { setItems(nodes); }, [nodes]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);
    setItems(reordered);
    void persistOrder(reordered.map((i) => i.id));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="mt-0.5 space-y-0.5">
          {items.map((node, index) => (
            <SortableRow
              key={node.id}
              node={node}
              number={`${parentNumber}.${index + 1}`}
              depth={depth}
              topLevelIndex={topLevelIndex}
              expanded={expanded}
              canManage={canManage}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function AccountPlansManagement({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = useCallback(async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetchWithTimeout("/api/financial/data?path=accounts", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Falha ao carregar contas.");
      setAccounts((payload.docs ?? []) as Account[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const tree = useMemo(() => buildTree(accounts), [accounts]);

  const [rootItems, setRootItems] = useState<Account[]>([]);
  useEffect(() => { setRootItems(tree); }, [tree]);

  function handleRootDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rootItems.findIndex((i) => i.id === active.id);
    const newIndex = rootItems.findIndex((i) => i.id === over.id);
    const reordered = arrayMove(rootItems, oldIndex, newIndex);
    setRootItems(reordered);
    void persistOrder(reordered.map((i) => i.id));
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function expandAll() { setExpanded(new Set(accounts.map((a) => a.id))); }
  function collapseAll() { setExpanded(new Set()); }

  // ── form ────────────────────────────────────────────────────────────────────

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { name: "", description: "", parentId: null, includeInDre: false, dre_position: null, isPatrimonial: false },
  });

  const includeInDre = form.watch("includeInDre");
  const isPatrimonial = form.watch("isPatrimonial");

  // Palavras-chave de busca (chips), fora do zod — mesmo padrão dos aliases de produto.
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  const [searchTermInput, setSearchTermInput] = useState("");

  const normalizeTerm = (value: string) =>
    value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

  function handleAddSearchTerm() {
    const term = searchTermInput.trim();
    if (!term) return;
    const normalized = normalizeTerm(term);
    if (!searchTerms.some((existing) => normalizeTerm(existing) === normalized)) {
      setSearchTerms((prev) => [...prev, term]);
    }
    setSearchTermInput("");
  }

  function handleRemoveSearchTerm(term: string) {
    setSearchTerms((prev) => prev.filter((entry) => entry !== term));
  }

  const parentOptions = useMemo(() => {
    if (!editingAccount) return accounts;
    const blockedIds = collectDescendantIds(accounts, editingAccount.id);
    blockedIds.add(editingAccount.id);
    return accounts.filter((account) => !blockedIds.has(account.id));
  }, [accounts, editingAccount]);

  function openAdd(parentId: string | null = null) {
    setEditingAccount(null);
    form.reset({ name: "", description: "", parentId, includeInDre: false, dre_position: null, isPatrimonial: false });
    setSearchTerms([]);
    setSearchTermInput("");
    setDialogOpen(true);
  }

  function openEdit(account: Account) {
    setEditingAccount(account);
    form.reset({
      name: account.name,
      description: account.description ?? "",
      parentId: account.parentId ?? null,
      includeInDre: !!account.dre_position,
      dre_position: account.dre_position ?? null,
      isPatrimonial: account.is_dre_account === false,
    });
    setSearchTerms(account.searchTerms ?? []);
    setSearchTermInput("");
    setDialogOpen(true);
  }

  async function onSubmit(values: AccountFormValues) {
    const dre_position = values.includeInDre ? (values.dre_position ?? null) : null;
    // Regra: patrimonial → false, caso contrário → true (sempre explícito)
    const is_dre_account = values.isPatrimonial ? false : true;
    try {
      const searchTermsPayload = searchTerms.length > 0 ? searchTerms : null;
      if (editingAccount) {
        await apiRequest("PATCH", {
          id: editingAccount.id,
          name: values.name,
          description: values.description ?? null,
          parentId: values.parentId ?? null,
          dre_position,
          is_dre_account,
          searchTerms: searchTermsPayload,
        });
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === editingAccount.id
              ? { ...a, name: values.name, description: values.description, parentId: values.parentId ?? null, dre_position, is_dre_account, searchTerms: searchTermsPayload ?? undefined }
              : a
          )
        );
        toast({ title: "Conta atualizada." });
      } else {
        const siblings = accounts.filter((a) => (a.parentId ?? null) === (values.parentId ?? null));
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
        toast({ title: "Conta criada." });
      }
      setDialogOpen(false);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Erro ao salvar." });
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const hasChildren = accounts.some((a) => a.parentId === deleteTarget.id);
    if (hasChildren) {
      toast({ variant: "destructive", title: "Remova as subcontas primeiro." });
      setDeleteTarget(null);
      return;
    }
    try {
      await apiRequest("DELETE", undefined, deleteTarget.id);
      setAccounts((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      toast({ title: "Conta removida." });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Erro ao remover." });
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Plano de contas</CardTitle>
              <CardDescription>
                Estruture categorias e subcontas para classificar despesas e resultados.
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={expandAll} className="rounded-lg border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                Expandir tudo
              </button>
              <button type="button" onClick={collapseAll} className="rounded-lg border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                Recolher tudo
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <TooltipProvider delayDuration={150}>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRootDragEnd}>
                  <SortableContext items={rootItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1">
                      {rootItems.map((node, index) => (
                        <SortableRow
                          key={node.id}
                          node={node}
                          number={`${index + 1}`}
                          depth={0}
                          topLevelIndex={index}
                          expanded={expanded}
                          canManage={canManage}
                          onToggle={toggleExpand}
                          onEdit={openEdit}
                          onDelete={setDeleteTarget}
                          onAddChild={(parentId) => openAdd(parentId)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </TooltipProvider>

              {canManage && (
                <button
                  type="button"
                  onClick={() => openAdd(null)}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <PlusCircle className="h-4 w-4" />
                  Nova conta raiz
                </button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingAccount ? "Editar conta" : "Nova conta"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl><Input placeholder="Ex: Salários" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição <span className="text-muted-foreground">(opcional)</span></FormLabel>
                    <FormControl><Textarea rows={2} placeholder="Descreva o uso desta conta..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <Label>Palavras-chave de busca <span className="text-muted-foreground">(opcional)</span></Label>
                <div className="flex gap-2">
                  <Input
                    value={searchTermInput}
                    onChange={(event) => setSearchTermInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleAddSearchTerm();
                      }
                    }}
                    placeholder="Ex: uniforme, EPI, fardamento..."
                  />
                  <Button type="button" variant="outline" onClick={handleAddSearchTerm} disabled={!searchTermInput.trim()}>
                    Adicionar
                  </Button>
                </div>
                {searchTerms.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {searchTerms.map((term) => (
                      <span key={term} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                        {term}
                        <button
                          type="button"
                          onClick={() => handleRemoveSearchTerm(term)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Remover ${term}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Termos que direcionam as buscas para esta conta (ex.: &ldquo;uniforme&rdquo; encontra esta conta mesmo que o nome não contenha a palavra).
                </p>
              </div>

              <FormField
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Conta pai <span className="text-muted-foreground">(opcional)</span></FormLabel>
                    <Select value={field.value ?? "none"} onValueChange={(v) => field.onChange(v === "none" ? null : v)}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Sem pai (raiz)" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none"><span className="text-muted-foreground">Sem pai (raiz)</span></SelectItem>
                        {parentOptions.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="includeInDre"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                      <div>
                        <FormLabel className="text-sm font-medium">Entra na DRE</FormLabel>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Vincule esta conta a uma posição do demonstrativo de resultados.
                        </p>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            field.onChange(checked);
                            if (!checked) form.setValue("dre_position", null);
                            if (checked) form.setValue("isPatrimonial", false);
                          }}
                        />
                      </FormControl>
                    </div>
                  </FormItem>
                )}
              />

              {!includeInDre && (
                <FormField
                  control={form.control}
                  name="isPatrimonial"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-3">
                        <div>
                          <FormLabel className="text-sm font-medium">Conta patrimonial</FormLabel>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Estoque, ativo imobilizado, aplicações financeiras. Não aparece na DRE nem em &ldquo;Não classificado&rdquo;.
                          </p>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </div>
                    </FormItem>
                  )}
                />
              )}

              {includeInDre && (
                <FormField
                  control={form.control}
                  name="dre_position"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Posição na DRE</FormLabel>
                      <Select value={field.value ?? "none"} onValueChange={(v) => field.onChange(v === "none" ? null : v)}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Selecione a posição" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none"><span className="text-muted-foreground">Sem posição</span></SelectItem>
                          {DRE_POSITIONS.map((p) => (
                            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingAccount ? "Salvar" : "Criar"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conta?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> será removida permanentemente. Despesas já lançadas nessa conta não serão afetadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
