"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDoc, deleteDoc, doc, updateDoc, writeBatch } from "firebase/firestore";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertCircle, ChevronDown, ChevronRight, GripVertical, Loader2, MoreHorizontal, PlusCircle,
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
import { financialDb } from "@/lib/firebase-financial";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { financialCollection } from "@/features/financial/lib/repositories";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ── constants ─────────────────────────────────────────────────────────────────

const DRE_POSITIONS = [
  { value: "receita_bruta_produto",   label: "Receita — Produto" },
  { value: "receita_bruta_delivery",  label: "Receita — Delivery" },
  { value: "receita_bruta_evento",    label: "Receita — Evento" },
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
  receita_bruta_produto:   "text-emerald-700 bg-emerald-50 border-emerald-200",
  receita_bruta_delivery:  "text-emerald-700 bg-emerald-50 border-emerald-200",
  receita_bruta_evento:    "text-emerald-700 bg-emerald-50 border-emerald-200",
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
  order?: number;
  active?: boolean;
  isGroup?: boolean;
  children?: Account[];
};

const accountFormSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres."),
  description: z.string().optional(),
  parentId: z.string().nullable().optional(),
  dre_position: z.string().nullable().optional(),
});
type AccountFormValues = z.infer<typeof accountFormSchema>;

// ── helpers ───────────────────────────────────────────────────────────────────

function buildTree(items: Account[], parentId: string | null = null): Account[] {
  return items
    .filter((item) => (item.parentId ?? null) === parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((item) => ({ ...item, children: buildTree(items, item.id) }));
}

async function persistOrder(ids: string[]) {
  const batch = writeBatch(financialDb);
  ids.forEach((id, index) => {
    batch.update(doc(financialDb, "accounts", id), { order: index });
  });
  await batch.commit();
}

function DreBadge({ position }: { position?: string | null }) {
  if (!position) return null;
  const pos = DRE_POSITIONS.find((p) => p.value === position);
  if (!pos) return null;
  return (
    <span className={cn("ml-1.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium", DRE_POS_COLORS[position] ?? "")}>
      {pos.label}
    </span>
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
          isRoot ? "hover:bg-muted/30" : "hover:bg-muted/20",
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
        <span className={cn("min-w-0 flex-1 truncate", isRoot && "font-semibold")}>
          {node.name}
        </span>

        {/* dre badge */}
        <DreBadge position={node.dre_position} />

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
  const [defaultParentId, setDefaultParentId] = useState<string | null>(null);
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

  // root-level items for DnD
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

  function expandAll() {
    setExpanded(new Set(accounts.map((a) => a.id)));
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  // ── form ────────────────────────────────────────────────────────────────────

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { name: "", description: "", parentId: null, dre_position: null },
  });

  const parentOptions = useMemo(
    () => accounts.filter((a) => !editingAccount || a.id !== editingAccount.id),
    [accounts, editingAccount]
  );

  function openAdd(parentId: string | null = null) {
    setEditingAccount(null);
    setDefaultParentId(parentId);
    form.reset({ name: "", description: "", parentId, dre_position: null });
    setDialogOpen(true);
  }

  function openEdit(account: Account) {
    setEditingAccount(account);
    form.reset({
      name: account.name,
      description: account.description ?? "",
      parentId: account.parentId ?? null,
      dre_position: account.dre_position ?? null,
    });
    setDialogOpen(true);
  }

  async function onSubmit(values: AccountFormValues) {
    try {
      if (editingAccount) {
        await updateDoc(doc(financialDb, "accounts", editingAccount.id), {
          name: values.name,
          description: values.description ?? null,
          parentId: values.parentId ?? null,
          dre_position: values.dre_position ?? null,
        });
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === editingAccount.id
              ? { ...a, name: values.name, description: values.description, parentId: values.parentId ?? null, dre_position: values.dre_position ?? null }
              : a
          )
        );
        toast({ title: "Conta atualizada." });
      } else {
        const siblings = accounts.filter((a) => (a.parentId ?? null) === (values.parentId ?? null));
        const ref = await addDoc(financialCollection("accounts"), {
          name: values.name,
          description: values.description ?? null,
          parentId: values.parentId ?? null,
          dre_position: values.dre_position ?? null,
          order: siblings.length,
          active: true,
        });
        setAccounts((prev) => [
          ...prev,
          { id: ref.id, name: values.name, description: values.description, parentId: values.parentId ?? null, dre_position: values.dre_position ?? null, order: siblings.length, active: true },
        ]);
        if (values.parentId) setExpanded((prev) => new Set([...prev, values.parentId!]));
        toast({ title: "Conta criada." });
      }
      setDialogOpen(false);
    } catch {
      toast({ variant: "destructive", title: "Erro ao salvar." });
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
      await deleteDoc(doc(financialDb, "accounts", deleteTarget.id));
      setAccounts((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      toast({ title: "Conta removida." });
    } catch {
      toast({ variant: "destructive", title: "Erro ao remover." });
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
                name="dre_position"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Posição na DRE <span className="text-muted-foreground">(opcional para grupos)</span></FormLabel>
                    <Select value={field.value ?? "none"} onValueChange={(v) => field.onChange(v === "none" ? null : v)}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Sem posição" /></SelectTrigger>
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
