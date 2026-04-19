"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDoc, deleteDoc, doc, writeBatch } from "firebase/firestore";
import { setDoc } from "firebase/firestore";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ChevronDown, ChevronRight, GripVertical, Loader2, MoreHorizontal, PlusCircle } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { financialDb } from "@/lib/firebase-financial";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import {
  accountPlanFormSchema,
  type AccountPlanFormValues,
} from "@/features/financial/lib/schemas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type AccountPlan = AccountPlanFormValues & {
  id: string;
  order?: number;
  children?: AccountPlan[];
};

const GROUP_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#eab308",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

function buildTree(items: AccountPlan[], parentId: string | null = null): AccountPlan[] {
  return items
    .filter((item) => (item.parentId ?? null) === parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((item) => ({ ...item, children: buildTree(items, item.id) }));
}

async function persistOrder(ids: string[]) {
  const batch = writeBatch(financialDb);
  ids.forEach((id, index) => {
    batch.update(doc(financialDb, "accountPlans", id), { order: index });
  });
  await batch.commit();
}

// ── Sortable child row ────────────────────────────────────────────────────────

function SortableChildRow({
  node,
  number,
  indentWidth,
  canManage,
  onEdit,
  onDelete,
  onAddChild,
}: {
  node: AccountPlan;
  number: string;
  indentWidth: number;
  canManage: boolean;
  onEdit: (plan: AccountPlan) => void;
  onDelete: (plan: AccountPlan) => void;
  onAddChild: (parentId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center justify-between px-4 py-2 hover:bg-muted/30">
        <div className="flex min-w-0 items-start">
          {canManage && (
            <button
              type="button"
              className="mr-1 mt-0.5 shrink-0 cursor-grab touch-none text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          <div className="relative mt-0.5 shrink-0" style={{ width: indentWidth + 22, height: 22 }}>
            <span
              className="absolute border-b-2 border-l-2 border-border/70"
              style={{
                left: indentWidth + 2,
                top: 0,
                height: 16,
                width: 12,
                borderBottomLeftRadius: 6,
              }}
            />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-xs font-mono text-muted-foreground">{number}</span>
              <p className="truncate text-sm font-medium">{node.name}</p>
            </div>
            {node.description && <p className="text-xs text-muted-foreground">{node.description}</p>}
          </div>
        </div>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-haspopup="true" size="icon" variant="ghost" className="h-7 w-7">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
              <DropdownMenuLabel>Ações</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onAddChild(node.id)}>Adicionar subconta</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(node)}>Editar</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(node)}>Excluir</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {node.children && node.children.length > 0 && (
        <AccountPlanBranch
          nodes={node.children}
          prefix={number}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddChild={onAddChild}
          canManage={canManage}
          depth={2}
          parentId={node.id}
        />
      )}
    </div>
  );
}

// ── Recursive branch (children, depth ≥ 2) ──────────────────────────────────

function AccountPlanBranch({
  nodes,
  prefix,
  onEdit,
  onDelete,
  onAddChild,
  canManage,
  depth = 1,
  parentId,
  onReorder,
}: {
  nodes: AccountPlan[];
  prefix: string;
  onEdit: (plan: AccountPlan) => void;
  onDelete: (plan: AccountPlan) => void;
  onAddChild: (parentId: string) => void;
  canManage: boolean;
  depth?: number;
  parentId: string;
  onReorder?: (parentId: string, ids: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const ids = useMemo(() => nodes.map((n) => n.id), [nodes]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = nodes.findIndex((n) => n.id === active.id);
    const newIndex = nodes.findIndex((n) => n.id === over.id);
    const reordered = arrayMove(nodes, oldIndex, newIndex);
    onReorder?.(parentId, reordered.map((n) => n.id));
  }

  // Depth ≥ 2: plain list (no independent DndContext to avoid nesting conflicts)
  if (depth > 1) {
    return (
      <>
        {nodes.map((node, index) => {
          const number = `${prefix}.${index + 1}`;
          const indentWidth = (depth - 1) * 28;
          return (
            <div key={node.id}>
              <div className="flex items-center justify-between px-4 py-2 hover:bg-muted/30">
                <div className="flex min-w-0 items-start">
                  <div className="relative mt-0.5 shrink-0" style={{ width: indentWidth + 22, height: 22 }}>
                    <span
                      className="absolute border-b-2 border-l-2 border-border/70"
                      style={{ left: indentWidth + 2, top: 0, height: 16, width: 12, borderBottomLeftRadius: 6 }}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-xs font-mono text-muted-foreground">{number}</span>
                      <p className="truncate text-sm font-medium">{node.name}</p>
                    </div>
                    {node.description && <p className="text-xs text-muted-foreground">{node.description}</p>}
                  </div>
                </div>
                {canManage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button aria-haspopup="true" size="icon" variant="ghost" className="h-7 w-7">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Toggle menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                      <DropdownMenuLabel>Ações</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => onAddChild(node.id)}>Adicionar subconta</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit(node)}>Editar</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onDelete(node)}>Excluir</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {node.children && node.children.length > 0 && (
                <AccountPlanBranch
                  nodes={node.children}
                  prefix={number}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onAddChild={onAddChild}
                  canManage={canManage}
                  depth={depth + 1}
                  parentId={node.id}
                />
              )}
            </div>
          );
        })}
      </>
    );
  }

  // Depth 1: sortable children within a group
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {nodes.map((node, index) => (
          <SortableChildRow
            key={node.id}
            node={node}
            number={`${prefix}.${index + 1}`}
            indentWidth={0}
            canManage={canManage}
            onEdit={onEdit}
            onDelete={onDelete}
            onAddChild={onAddChild}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

// ── Sortable top-level group row ─────────────────────────────────────────────

function SortableGroupRow({
  group,
  index,
  color,
  collapsed,
  canManage,
  onToggle,
  onEdit,
  onDelete,
  onAddChild,
  onChildReorder,
}: {
  group: AccountPlan;
  index: number;
  color: string;
  collapsed: boolean;
  canManage: boolean;
  onToggle: (id: string) => void;
  onEdit: (plan: AccountPlan) => void;
  onDelete: (plan: AccountPlan) => void;
  onAddChild: (parentId: string) => void;
  onChildReorder: (parentId: string, ids: string[]) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="border-b last:border-b-0">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex min-w-0 items-center gap-1">
          {canManage && (
            <button
              type="button"
              className="shrink-0 cursor-grab touch-none text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            className="flex items-center gap-3 text-left"
            onClick={() => onToggle(group.id)}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <div>
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-xs font-mono text-muted-foreground">{index + 1}</span>
                <p className="font-semibold">{group.name}</p>
              </div>
              {group.description && <p className="text-xs text-muted-foreground">{group.description}</p>}
            </div>
          </button>
        </div>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-haspopup="true" size="icon" variant="ghost">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
              <DropdownMenuLabel>Ações</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onAddChild(group.id)}>Adicionar subconta</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(group)}>Editar</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(group)}>Excluir</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {!collapsed && group.children && group.children.length > 0 && (
        <div className="pb-3">
          <AccountPlanBranch
            nodes={group.children}
            prefix={String(index + 1)}
            onEdit={onEdit}
            onDelete={onDelete}
            onAddChild={onAddChild}
            canManage={canManage}
            depth={1}
            parentId={group.id}
            onReorder={onChildReorder}
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AccountPlansManagement({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const [rawPlans, setRawPlans] = useState<AccountPlan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingPlan, setEditingPlan] = useState<AccountPlan | null>(null);
  const [deletingPlan, setDeletingPlan] = useState<AccountPlan | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapseInitialized, setCollapseInitialized] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const refresh = useCallback(async () => {
    if (!auth.currentUser) {
      setError(new Error("Usuário não autenticado."));
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetchWithTimeout("/api/financial/data?path=accountPlans", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Falha ao carregar o plano de contas.");
      }

      setRawPlans((payload.docs ?? []) as AccountPlan[]);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError : new Error("Falha ao carregar o plano de contas."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const plans = rawPlans ?? [];
  const tree = useMemo(() => buildTree(plans), [plans]);

  const form = useForm<AccountPlanFormValues>({
    resolver: zodResolver(accountPlanFormSchema),
    defaultValues: { name: "", description: "", parentId: null },
  });

  const topGroups = useMemo(() => tree.map((node) => node.id), [tree]);

  useEffect(() => {
    if (!collapseInitialized && topGroups.length > 0) {
      setCollapsedGroups(new Set(topGroups));
      setCollapseInitialized(true);
    }
  }, [collapseInitialized, topGroups]);

  function handleOpen(plan: AccountPlan | null = null, parentId: string | null = null) {
    setEditingPlan(plan);
    form.reset(
      plan
        ? { name: plan.name, description: plan.description ?? "", parentId: plan.parentId ?? null }
        : { name: "", description: "", parentId }
    );
    setIsFormOpen(true);
  }

  async function onSubmit(values: AccountPlanFormValues) {
    setIsSaving(true);
    try {
      if (editingPlan) {
        await setDoc(financialDoc("accountPlans", editingPlan.id), values);
        toast({ title: "Plano de contas atualizado!" });
      } else {
        const siblings = plans.filter((p) => (p.parentId ?? null) === (values.parentId ?? null));
        const order = siblings.length;
        await addDoc(financialCollection("accountPlans"), { ...values, order });
        toast({ title: "Plano de contas criado!" });
      }
      refresh();
      setIsFormOpen(false);
      setEditingPlan(null);
    } catch (submitError) {
      console.error(submitError);
      toast({ variant: "destructive", title: "Erro ao salvar o plano de contas." });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingPlan) return;
    try {
      await deleteDoc(financialDoc("accountPlans", deletingPlan.id));
      toast({ title: "Plano de contas removido." });
      refresh();
    } catch {
      toast({ variant: "destructive", title: "Erro ao remover o plano de contas." });
    } finally {
      setDeletingPlan(null);
    }
  }

  function toggleGroup(id: string) {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Top-level drag end
  function handleTopDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tree.findIndex((g) => g.id === active.id);
    const newIndex = tree.findIndex((g) => g.id === over.id);
    const reordered = arrayMove(tree, oldIndex, newIndex);
    // Optimistic update
    setRawPlans((prev) => {
      if (!prev) return prev;
      const children = prev.filter((p) => p.parentId !== null);
      return [...reordered.map((g, i) => ({ ...g, order: i })), ...children];
    });
    persistOrder(reordered.map((g) => g.id)).catch(() => {
      toast({ variant: "destructive", title: "Erro ao salvar a ordem." });
      refresh();
    });
  }

  // Children drag end (within a group)
  function handleChildReorder(parentId: string, ids: string[]) {
    setRawPlans((prev) => {
      if (!prev) return prev;
      const idOrder = Object.fromEntries(ids.map((id, i) => [id, i]));
      return prev.map((p) => (p.id in idOrder ? { ...p, order: idOrder[p.id] } : p));
    });
    persistOrder(ids).catch(() => {
      toast({ variant: "destructive", title: "Erro ao salvar a ordem." });
      refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Plano de contas</CardTitle>
            <CardDescription>Estruture categorias e subcontas para classificar despesas e resultados.</CardDescription>
          </div>
          {canManage && (
            <Button onClick={() => handleOpen()}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Nova conta
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCollapsedGroups(new Set())}>
            Expandir tudo
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCollapsedGroups(new Set(topGroups))}>
            Recolher tudo
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Falha ao carregar o plano de contas.</p>
                <p>{error.message}</p>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : tree.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nenhum plano de contas cadastrado.
          </div>
        ) : (
          <div className="rounded-lg border">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTopDragEnd}>
              <SortableContext items={topGroups} strategy={verticalListSortingStrategy}>
                {tree.map((group, index) => (
                  <SortableGroupRow
                    key={group.id}
                    group={group}
                    index={index}
                    color={GROUP_COLORS[index % GROUP_COLORS.length]}
                    collapsed={collapsedGroups.has(group.id)}
                    canManage={canManage}
                    onToggle={toggleGroup}
                    onEdit={(plan) => handleOpen(plan)}
                    onDelete={(plan) => setDeletingPlan(plan)}
                    onAddChild={(parentId) => handleOpen(null, parentId)}
                    onChildReorder={handleChildReorder}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        )}
      </CardContent>

      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open) { setIsFormOpen(false); setEditingPlan(null); }
        }}
      >
        <DialogContent onCloseAutoFocus={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editingPlan ? "Editar conta" : "Nova conta"}</DialogTitle>
            <DialogDescription>Defina nome, descrição e conta pai, se houver.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Despesas administrativas" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Conta pai</FormLabel>
                    <Select
                      value={field.value ?? "root"}
                      onValueChange={(value) => field.onChange(value === "root" ? null : value)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a conta pai" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="root">Nenhuma</SelectItem>
                        {plans
                          .filter((plan) => plan.id !== editingPlan?.id)
                          .map((plan) => (
                            <SelectItem key={plan.id} value={plan.id}>
                              {plan.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Contexto opcional da conta" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingPlan} onOpenChange={(open) => !open && setDeletingPlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir plano de contas?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação remove o plano <strong>{deletingPlan?.name}</strong>. Verifique antes se ele não está em uso em despesas já lançadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
