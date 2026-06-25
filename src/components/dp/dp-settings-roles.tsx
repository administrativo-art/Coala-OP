"use client";

import React from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Briefcase, ChevronDown, ChevronRight, MoreHorizontal, Pencil, Plus, PlusCircle, Search, ShieldCheck, Users2, Workflow } from "lucide-react";

import type { JobDepartment, JobFunction, JobRole } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { useProfiles } from "@/hooks/use-profiles";
import { useHrBootstrap } from "@/hooks/use-hr-bootstrap";
import {
  createHrDepartment,
  createHrFunction,
  createHrRole,
  syncHrRoleProfile,
  updateHrDepartment,
  updateHrFunction,
  updateHrRole,
} from "@/features/hr/lib/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { MultiSelect } from "@/components/ui/multi-select";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const roleSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do cargo."),
  departmentId: z.string().optional(),
  parentId: z.string().optional(),
  reportsTo: z.string().optional(),
  defaultProfileId: z.string().optional(),
  loginRestricted: z.boolean().default(false),
  isActive: z.boolean().default(true),
  description: z.string().trim().optional(),
});

type RoleFormValues = z.infer<typeof roleSchema>;

const functionSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da função."),
  departmentId: z.string().optional(),
  parentId: z.string().optional(),
  compatibleRoleIds: z.array(z.string()).default([]),
  defaultProfileId: z.string().optional(),
  isActive: z.boolean().default(true),
  description: z.string().trim().optional(),
});

type FunctionFormValues = z.infer<typeof functionSchema>;

const departmentSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do departamento."),
  parentId: z.string().optional(),
  description: z.string().trim().optional(),
  isActive: z.boolean().default(true),
});

type DepartmentFormValues = z.infer<typeof departmentSchema>;

type HrTreeItem = {
  id: string;
  name: string;
  parentId?: string | null;
  reportsTo?: string | null;
  departmentName?: string | null;
  isActive?: boolean;
  order?: number;
};

type HrTreeNode<T extends HrTreeItem> = T & { children: Array<HrTreeNode<T>> };

const TREE_TONES = [
  { dot: "bg-pink-600", soft: "bg-pink-50 text-pink-700" },
  { dot: "bg-amber-600", soft: "bg-amber-50 text-amber-700" },
  { dot: "bg-emerald-600", soft: "bg-emerald-50 text-emerald-700" },
  { dot: "bg-violet-600", soft: "bg-violet-50 text-violet-700" },
  { dot: "bg-sky-600", soft: "bg-sky-50 text-sky-700" },
];

function getTreeParentId(item: HrTreeItem) {
  return item.parentId ?? item.reportsTo ?? null;
}

function buildHrTree<T extends HrTreeItem>(items: T[], parentId: string | null = null): Array<HrTreeNode<T>> {
  return items
    .filter((item) => getTreeParentId(item) === parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
    .map((item) => ({ ...item, children: buildHrTree(items, item.id) }));
}

function HrTreeSection<T extends HrTreeItem>({
  title,
  description,
  icon,
  items,
  emptyLabel,
  addRootLabel,
  addChildLabel,
  canManage,
  meta,
  onAddRoot,
  onAddChild,
  onEdit,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  items: T[];
  emptyLabel: string;
  addRootLabel: string;
  addChildLabel: string;
  canManage: boolean;
  meta?: (item: T) => React.ReactNode;
  onAddRoot: () => void;
  onAddChild: (parentId: string) => void;
  onEdit: (item: T) => void;
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const tree = React.useMemo(() => buildHrTree(items), [items]);

  React.useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      tree.forEach((node) => next.add(node.id));
      return next;
    });
  }, [tree]);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNode(node: HrTreeNode<T>, depth: number, number: string) {
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.id);
    const tone = TREE_TONES[Math.min(depth, TREE_TONES.length - 1)];

    return (
      <div key={node.id}>
        <div
          className={cn(
            "group flex min-h-14 items-center gap-3 border-b border-slate-100 px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-slate-50/70",
            node.isActive === false && "opacity-60"
          )}
          style={{ paddingLeft: `${16 + depth * 28}px` }}
        >
          <button
            type="button"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={() => hasChildren && toggle(node.id)}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
            ) : (
              <span className="h-4 w-4" />
            )}
          </button>
          <span className="w-8 shrink-0 text-right font-mono text-[11px] text-slate-400">{number}</span>
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn("truncate text-slate-950", depth === 0 ? "font-bold" : "font-medium")}>{node.name}</span>
              {node.isActive === false && <StatusBadge active={false} />}
            </div>
            {depth > 0 && node.departmentName ? <p className="mt-0.5 truncate text-xs text-slate-400">{node.departmentName}</p> : null}
          </div>
          {meta ? <div className="hidden max-w-[48%] flex-wrap items-center justify-end gap-1.5 text-xs text-slate-400 md:flex">{meta(node)}</div> : null}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-950">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="max-w-52 truncate text-xs font-normal text-muted-foreground">
                  {node.name}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onAddChild(node.id)}>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  {addChildLabel}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(node)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div>
            {node.children.map((child, index) => renderNode(child, depth + 1, `${number}.${index + 1}`))}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-50 text-slate-700">
              {icon}
            </span>
            <h3 className="truncate text-xl font-bold text-slate-950">{title}</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        {canManage && (
          <Button
            type="button"
            onClick={onAddRoot}
            className="h-10 shrink-0 rounded-xl bg-pink-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-pink-500"
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            {addRootLabel}
          </Button>
        )}
      </div>
      {tree.length === 0 ? (
        <div className="m-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
          {emptyLabel}
        </div>
      ) : (
        <div>{tree.map((node, index) => renderNode(node, 0, String(index + 1)))}</div>
      )}
    </section>
  );
}

function DepartmentDialog({
  open,
  onOpenChange,
  department,
  departments,
  defaultParentId,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  department: JobDepartment | null;
  departments: JobDepartment[];
  defaultParentId: string | null;
  onSubmit: (values: DepartmentFormValues, currentDepartment: JobDepartment | null) => Promise<void>;
}) {
  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: "", parentId: "", description: "", isActive: true },
  });

  React.useEffect(() => {
    if (!open) return;
    form.reset({
      name: department?.name ?? "",
      parentId: department?.parentId ?? defaultParentId ?? "",
      description: department?.description ?? "",
      isActive: department?.isActive ?? true,
    });
  }, [defaultParentId, department, form, open]);

  const parentOptions = departments.filter((item) => item.id !== department?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{department ? "Editar departamento" : "Novo departamento"}</DialogTitle>
          <DialogDescription>Crie níveis livres para organizar áreas, subáreas e times.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(async (values) => {
              await onSubmit(values, department);
              onOpenChange(false);
            })}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl><Input placeholder="Ex: Operacional" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="parentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Departamento pai</FormLabel>
                  <Select value={field.value || "__none__"} onValueChange={(value) => field.onChange(value === "__none__" ? "" : value)}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Sem pai" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Sem pai</SelectItem>
                      {parentOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
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
                  <FormControl><Textarea rows={3} placeholder="Descrição interna opcional." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <FormLabel>Ativo</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>{department ? "Salvar" : "Criar"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({
  open,
  onOpenChange,
  role,
  roles,
  departments,
  defaultParentId,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  role: JobRole | null;
  roles: JobRole[];
  departments: JobDepartment[];
  defaultParentId: string | null;
  onSubmit: (values: RoleFormValues, currentRole: JobRole | null) => Promise<void>;
}) {
  const { profiles } = useProfiles();
  const form = useForm<RoleFormValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: {
      name: "",
      departmentId: "",
      parentId: "",
      reportsTo: "",
      defaultProfileId: "",
      loginRestricted: false,
      isActive: true,
      description: "",
    },
  });

  React.useEffect(() => {
    if (!open) return;
    form.reset({
      name: role?.name ?? "",
      departmentId: role?.departmentId ?? "",
      parentId: role?.parentId ?? role?.reportsTo ?? defaultParentId ?? "",
      reportsTo: role?.reportsTo ?? role?.parentId ?? defaultParentId ?? "",
      defaultProfileId: role?.defaultProfileId ?? "",
      loginRestricted: role?.loginRestricted ?? false,
      isActive: role?.isActive ?? true,
      description: role?.description ?? "",
    });
  }, [defaultParentId, form, open, role]);

  const reportsToOptions = roles.filter((item) => item.id !== role?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{role ? "Editar cargo" : "Novo cargo"}</DialogTitle>
          <DialogDescription>
            O cargo organiza a hierarquia do RH e pode apontar para um perfil padrão, sem substituir a estrutura atual de permissões.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(async (values) => {
              await onSubmit(values, role);
              onOpenChange(false);
            })}
            className="space-y-4 max-h-[80vh] overflow-y-auto pr-1"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome interno</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Líder de unidade" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Departamento</FormLabel>
                    <Select
                      value={field.value || "__none__"}
                      onValueChange={(value) =>
                        field.onChange(value === "__none__" ? "" : value)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sem departamento" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Sem departamento</SelectItem>
                        {departments.filter((department) => department.isActive !== false).map((department) => (
                          <SelectItem key={department.id} value={department.id}>
                            {department.name}
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
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cargo pai</FormLabel>
                    <Select
                      value={field.value || "__none__"}
                      onValueChange={(value) =>
                        field.onChange(value === "__none__" ? "" : value)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sem cargo pai" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Sem cargo pai</SelectItem>
                        {reportsToOptions.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
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
                name="defaultProfileId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Perfil padrão</FormLabel>
                    <Select
                      value={field.value || "__none__"}
                      onValueChange={(value) =>
                        field.onChange(value === "__none__" ? "" : value)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sem perfil padrão" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Sem perfil padrão</SelectItem>
                        {profiles.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição interna</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={4}
                        placeholder="Escopo e responsabilidades internas do cargo."
                        {...field}
                      />
                    </FormControl>
                  <FormMessage />
                </FormItem>
              )}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="loginRestricted"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-1">
                      <FormLabel>Login restrito por escala</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Marca o cargo para futura validação de acesso por horário.
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-1">
                      <FormLabel>Cargo ativo</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Cargos inativos ficam preservados para histórico.
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function FunctionDialog({
  open,
  onOpenChange,
  item,
  roles,
  departments,
  functions,
  defaultParentId,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  item: JobFunction | null;
  roles: JobRole[];
  departments: JobDepartment[];
  functions: JobFunction[];
  defaultParentId: string | null;
  onSubmit: (
    values: FunctionFormValues,
    currentFunction: JobFunction | null
  ) => Promise<void>;
}) {
  const { profiles } = useProfiles();
  const form = useForm<FunctionFormValues>({
    resolver: zodResolver(functionSchema),
    defaultValues: {
      name: "",
      departmentId: "",
      parentId: "",
      compatibleRoleIds: [],
      defaultProfileId: "",
      isActive: true,
      description: "",
    },
  });

  React.useEffect(() => {
    if (!open) return;
    form.reset({
      name: item?.name ?? "",
      departmentId: item?.departmentId ?? "",
      parentId: item?.parentId ?? defaultParentId ?? "",
      compatibleRoleIds: item?.compatibleRoleIds ?? [],
      defaultProfileId: item?.defaultProfileId ?? "",
      isActive: item?.isActive ?? true,
      description: item?.description ?? "",
    });
  }, [defaultParentId, form, item, open]);

  const roleOptions = roles.map((role) => ({ value: role.id, label: role.name }));
  const parentOptions = functions.filter((functionItem) => functionItem.id !== item?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? "Editar função" : "Nova função"}</DialogTitle>
          <DialogDescription>
            Funções refinam a atuação do colaborador sem trocar a estrutura atual de acesso.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(async (values) => {
              await onSubmit(values, item);
              onOpenChange(false);
            })}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome interno</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Caixa" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Departamento</FormLabel>
                    <Select
                      value={field.value || "__none__"}
                      onValueChange={(value) =>
                        field.onChange(value === "__none__" ? "" : value)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sem departamento" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Sem departamento</SelectItem>
                        {departments.filter((department) => department.isActive !== false).map((department) => (
                          <SelectItem key={department.id} value={department.id}>
                            {department.name}
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
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Função pai</FormLabel>
                    <Select
                      value={field.value || "__none__"}
                      onValueChange={(value) =>
                        field.onChange(value === "__none__" ? "" : value)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sem função pai" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Sem função pai</SelectItem>
                        {parentOptions.map((functionItem) => (
                          <SelectItem key={functionItem.id} value={functionItem.id}>
                            {functionItem.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="compatibleRoleIds"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cargos compatíveis</FormLabel>
                  <FormControl>
                    <MultiSelect
                      options={roleOptions}
                      selected={field.value ?? []}
                      onChange={field.onChange}
                      placeholder="Selecione os cargos que podem usar essa função"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultProfileId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Perfil padrão da função</FormLabel>
                  <Select
                    value={field.value || "__none__"}
                    onValueChange={(value) =>
                      field.onChange(value === "__none__" ? "" : value)
                    }
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sem perfil padrão" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Sem perfil padrão</SelectItem>
                      {profiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição interna</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={4}
                        placeholder="Escopo interno da função."
                        {...field}
                      />
                    </FormControl>
                  <FormMessage />
                </FormItem>
              )}
              />
            </div>

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-1">
                    <FormLabel>Função ativa</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Funções inativas saem da operação mas permanecem no histórico.
                    </p>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-100 text-slate-600"
      )}
    >
      {active ? "Ativo" : "Inativo"}
    </Badge>
  );
}

function CatalogMetricCard({
  label,
  value,
  description,
  tone = "slate",
}: {
  label: string;
  value: number;
  description: string;
  tone?: "slate" | "pink" | "emerald";
}) {
  const valueClass = {
    slate: "text-slate-950",
    pink: "text-pink-600",
    emerald: "text-emerald-600",
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn("mt-1 text-3xl font-bold leading-none", valueClass)}>{value}</p>
      <p className="mt-2 text-[11px] text-slate-400">{description}</p>
    </div>
  );
}

function CatalogSearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-xl border-slate-200 bg-white pl-9 text-sm shadow-sm placeholder:text-slate-400 focus-visible:ring-pink-200"
      />
    </div>
  );
}

export function DPSettingsRoles() {
  const { firebaseUser, activeUsers } = useAuth();
  const { departments, roles, functions, loading, error, refresh, access } = useHrBootstrap();
  const { profiles } = useProfiles();
  const { toast } = useToast();

  const [roleDialogOpen, setRoleDialogOpen] = React.useState(false);
  const [functionDialogOpen, setFunctionDialogOpen] = React.useState(false);
  const [departmentDialogOpen, setDepartmentDialogOpen] = React.useState(false);
  const [editingRole, setEditingRole] = React.useState<JobRole | null>(null);
  const [editingFunction, setEditingFunction] = React.useState<JobFunction | null>(null);
  const [editingDepartment, setEditingDepartment] = React.useState<JobDepartment | null>(null);
  const [defaultRoleParentId, setDefaultRoleParentId] = React.useState<string | null>(null);
  const [defaultFunctionParentId, setDefaultFunctionParentId] = React.useState<string | null>(null);
  const [defaultDepartmentParentId, setDefaultDepartmentParentId] = React.useState<string | null>(null);
  const [syncRole, setSyncRole] = React.useState<JobRole | null>(null);
  const [syncingRoleId, setSyncingRoleId] = React.useState<string | null>(null);
  const [roleQuery, setRoleQuery] = React.useState("");
  const [functionQuery, setFunctionQuery] = React.useState("");
  const [departmentQuery, setDepartmentQuery] = React.useState("");

  const filteredRoles = React.useMemo(() => {
    const normalized = roleQuery.trim().toLowerCase();
    if (!normalized) return roles;
    return roles.filter((role) =>
      [role.name, role.publicTitle, role.slug, role.departmentName]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized))
    );
  }, [roleQuery, roles]);

  const filteredDepartments = React.useMemo(() => {
    const normalized = departmentQuery.trim().toLowerCase();
    if (!normalized) return departments;
    return departments.filter((department) =>
      [department.name, department.slug, department.description]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized))
    );
  }, [departmentQuery, departments]);

  const filteredFunctions = React.useMemo(() => {
    const normalized = functionQuery.trim().toLowerCase();
    if (!normalized) return functions;
    return functions.filter((item) =>
      [item.name, item.publicTitle, item.slug, item.departmentName]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized))
    );
  }, [functionQuery, functions]);

  const profileNameById = React.useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile.name])),
    [profiles]
  );

  const roleNameById = React.useMemo(
    () => new Map(roles.map((role) => [role.id, role.name])),
    [roles]
  );

  const departmentNameById = React.useMemo(
    () => new Map(departments.map((department) => [department.id, department.name])),
    [departments]
  );

  const roleSyncSummary = React.useMemo(() => {
    const summary = new Map<string, { assigned: number; mismatched: number }>();

    for (const role of roles) {
      summary.set(role.id, { assigned: 0, mismatched: 0 });
    }

    for (const user of activeUsers) {
      if (!user.jobRoleId) continue;

      const bucket = summary.get(user.jobRoleId);
      if (!bucket) continue;

      bucket.assigned += 1;
      const role = roles.find((item) => item.id === user.jobRoleId);
      if (role?.defaultProfileId && user.profileId !== role.defaultProfileId) {
        bucket.mismatched += 1;
      }
    }

    return summary;
  }, [activeUsers, roles]);

  async function handleRoleSubmit(values: RoleFormValues, role: JobRole | null) {
    if (!firebaseUser) return;

    const payload = {
      name: values.name,
      departmentId: values.departmentId || null,
      departmentName: values.departmentId ? departmentNameById.get(values.departmentId) ?? null : null,
      parentId: values.parentId || null,
      reportsTo: values.parentId || null,
      defaultProfileId: values.defaultProfileId || undefined,
      loginRestricted: values.loginRestricted,
      isActive: values.isActive,
      description: values.description || undefined,
    };

    try {
      if (role) {
        await updateHrRole(firebaseUser, role.id, payload);
        toast({ title: "Cargo atualizado." });
      } else {
        await createHrRole(firebaseUser, payload);
        toast({ title: "Cargo criado." });
      }
      setEditingRole(null);
      await refresh();
    } catch (submitError) {
      toast({
        title:
          submitError instanceof Error
            ? submitError.message
            : "Erro ao salvar cargo.",
        variant: "destructive",
      });
      throw submitError;
    }
  }

  async function handleFunctionSubmit(
    values: FunctionFormValues,
    item: JobFunction | null
  ) {
    if (!firebaseUser) return;

    const payload = {
      name: values.name,
      departmentId: values.departmentId || null,
      departmentName: values.departmentId ? departmentNameById.get(values.departmentId) ?? null : null,
      parentId: values.parentId || null,
      compatibleRoleIds: values.compatibleRoleIds,
      defaultProfileId: values.defaultProfileId || undefined,
      isActive: values.isActive,
      description: values.description || undefined,
    };

    try {
      if (item) {
        await updateHrFunction(firebaseUser, item.id, payload);
        toast({ title: "Função atualizada." });
      } else {
        await createHrFunction(firebaseUser, payload);
        toast({ title: "Função criada." });
      }
      setEditingFunction(null);
      await refresh();
    } catch (submitError) {
      toast({
        title:
          submitError instanceof Error
            ? submitError.message
            : "Erro ao salvar função.",
        variant: "destructive",
      });
      throw submitError;
    }
  }

  async function handleDepartmentSubmit(values: DepartmentFormValues, department: JobDepartment | null) {
    if (!firebaseUser) return;
    const name = values.name.trim();
    if (!name) return;

    try {
      const payload = {
        name,
        parentId: values.parentId || null,
        description: values.description || undefined,
        isActive: values.isActive,
      };

      if (department) {
        await updateHrDepartment(firebaseUser, department.id, payload);
        toast({ title: "Departamento atualizado." });
      } else {
        await createHrDepartment(firebaseUser, payload);
        toast({ title: "Departamento criado." });
      }
      setEditingDepartment(null);
      await refresh();
    } catch (departmentError) {
      toast({
        title:
          departmentError instanceof Error
            ? departmentError.message
            : "Erro ao criar departamento.",
        variant: "destructive",
      });
      throw departmentError;
    }
  }

  async function handleRoleProfileSync(role: JobRole) {
    if (!firebaseUser) return;

    try {
      setSyncingRoleId(role.id);
      const result = await syncHrRoleProfile(firebaseUser, role.id);

      toast({
        title:
          result.updatedUsers.length > 0
            ? `Perfil aplicado a ${result.updatedUsers.length} colaborador${result.updatedUsers.length === 1 ? "" : "es"}.`
            : "Nenhum colaborador precisava de atualização.",
        description:
          result.targetProfileName
            ? `Cargo sincronizado com o perfil padrão ${result.targetProfileName}.`
            : undefined,
      });

      setSyncRole(null);
      await refresh();
    } catch (syncError) {
      toast({
        title:
          syncError instanceof Error
            ? syncError.message
            : "Erro ao aplicar perfil padrão.",
        variant: "destructive",
      });
    } finally {
      setSyncingRoleId(null);
    }
  }

  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-56 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-56 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Catálogo de RH indisponível</CardTitle>
          <CardDescription>
            Não foi possível carregar cargos e funções neste momento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => void refresh()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!access.canView) {
    return (
      <p className="rounded-lg border p-6 text-sm text-muted-foreground">
        Sem permissão para acessar o catálogo de cargos e funções.
      </p>
    );
  }

  const activeDepartmentCount = departments.filter((department) => department.isActive !== false).length;
  const rootDepartmentCount = departments.filter((department) => department.isActive !== false && !department.parentId).length;
  const subdepartmentCount = departments.filter((department) => department.isActive !== false && !!department.parentId).length;
  const activeRoleCount = roles.filter((role) => role.isActive).length;
  const activeFunctionCount = functions.filter((item) => item.isActive).length;
  const peopleWithRoles = activeUsers.filter((user) => !!user.jobRoleId).length;
  const configuredFunctions = functions.filter((item) => (item.compatibleRoleIds ?? []).length > 0).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <CatalogMetricCard
          label="Departamentos ativos"
          value={activeDepartmentCount}
          description={`${rootDepartmentCount} raiz · ${subdepartmentCount} subdepts.`}
        />
        <CatalogMetricCard
          label="Cargos ativos"
          value={activeRoleCount}
          description={`${peopleWithRoles} pessoas cadastradas`}
          tone="pink"
        />
        <CatalogMetricCard
          label="Funções ativas"
          value={activeFunctionCount}
          description={`${configuredFunctions} de ${functions.length} configuradas`}
          tone="emerald"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <CatalogSearchInput value={departmentQuery} onChange={setDepartmentQuery} placeholder="Buscar departamento" />
        <CatalogSearchInput value={roleQuery} onChange={setRoleQuery} placeholder="Buscar cargo" />
        <CatalogSearchInput value={functionQuery} onChange={setFunctionQuery} placeholder="Buscar função" />
      </div>

      <HrTreeSection
        title="Departamentos"
        description="Estruture áreas e subáreas com níveis livres."
        icon={<Workflow className="h-5 w-5" />}
        items={filteredDepartments}
        emptyLabel="Nenhum departamento cadastrado."
        addRootLabel="Novo departamento"
        addChildLabel="Adicionar subdepartamento"
        canManage={access.canManageCatalog}
        meta={(department) => department.description ? <span>{department.description}</span> : <span>{department.parentId ? "Subdepartamento" : "Raiz"}</span>}
        onAddRoot={() => {
          setEditingDepartment(null);
          setDefaultDepartmentParentId(null);
          setDepartmentDialogOpen(true);
        }}
        onAddChild={(parentId) => {
          setEditingDepartment(null);
          setDefaultDepartmentParentId(parentId);
          setDepartmentDialogOpen(true);
        }}
        onEdit={(department) => {
          setEditingDepartment(department);
          setDefaultDepartmentParentId(null);
          setDepartmentDialogOpen(true);
        }}
      />

      <HrTreeSection
        title="Cargos"
        description="Base do organograma. Crie níveis de cargo como no plano de contas."
        icon={<Briefcase className="h-5 w-5" />}
        items={filteredRoles}
        emptyLabel="Nenhum cargo cadastrado."
        addRootLabel="Novo cargo"
        addChildLabel="Adicionar subcargo"
        canManage={access.canManageCatalog}
        meta={(role) => (
          <>
            {role.departmentId ? <Badge variant="outline">{departmentNameById.get(role.departmentId) ?? role.departmentName ?? "Departamento removido"}</Badge> : <span>Sem departamento</span>}
            {role.defaultProfileId ? <Badge variant="secondary"><ShieldCheck className="mr-1 h-3.5 w-3.5" />{profileNameById.get(role.defaultProfileId) ?? role.defaultProfileId}</Badge> : null}
            {role.loginRestricted ? <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Login restrito por escala</Badge> : null}
            {access.canManageCatalog && role.defaultProfileId && (roleSyncSummary.get(role.id)?.mismatched ?? 0) > 0 ? (
              <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" disabled={syncingRoleId === role.id} onClick={() => setSyncRole(role)}>
                {syncingRoleId === role.id ? "Aplicando..." : "Aplicar perfil"}
              </Button>
            ) : null}
          </>
        )}
        onAddRoot={() => {
          setEditingRole(null);
          setDefaultRoleParentId(null);
          setRoleDialogOpen(true);
        }}
        onAddChild={(parentId) => {
          setEditingRole(null);
          setDefaultRoleParentId(parentId);
          setRoleDialogOpen(true);
        }}
        onEdit={(role) => {
          setEditingRole(role);
          setDefaultRoleParentId(null);
          setRoleDialogOpen(true);
        }}
      />

      <HrTreeSection
        title="Funções"
        description="Atribuições complementares, compatíveis com um ou mais cargos."
        icon={<Users2 className="h-5 w-5" />}
        items={filteredFunctions}
        emptyLabel="Nenhuma função cadastrada."
        addRootLabel="Nova função"
        addChildLabel="Adicionar subfunção"
        canManage={access.canManageCatalog}
        meta={(item) => (
          <>
            {item.departmentId ? <Badge variant="outline">{departmentNameById.get(item.departmentId) ?? item.departmentName ?? "Departamento removido"}</Badge> : <span>Sem departamento</span>}
            {(item.compatibleRoleIds ?? []).length > 0 ? item.compatibleRoleIds?.map((roleId) => <Badge key={roleId} variant="secondary">{roleNameById.get(roleId) ?? roleId}</Badge>) : <span>Sem restrição de cargo</span>}
            {item.defaultProfileId ? <Badge variant="secondary"><ShieldCheck className="mr-1 h-3.5 w-3.5" />{profileNameById.get(item.defaultProfileId) ?? item.defaultProfileId}</Badge> : null}
          </>
        )}
        onAddRoot={() => {
          setEditingFunction(null);
          setDefaultFunctionParentId(null);
          setFunctionDialogOpen(true);
        }}
        onAddChild={(parentId) => {
          setEditingFunction(null);
          setDefaultFunctionParentId(parentId);
          setFunctionDialogOpen(true);
        }}
        onEdit={(item) => {
          setEditingFunction(item);
          setDefaultFunctionParentId(null);
          setFunctionDialogOpen(true);
        }}
      />

      <DepartmentDialog
        open={departmentDialogOpen}
        onOpenChange={setDepartmentDialogOpen}
        department={editingDepartment}
        departments={departments}
        defaultParentId={defaultDepartmentParentId}
        onSubmit={handleDepartmentSubmit}
      />
      <RoleDialog
        open={roleDialogOpen}
        onOpenChange={setRoleDialogOpen}
        role={editingRole}
        roles={roles}
        departments={departments}
        defaultParentId={defaultRoleParentId}
        onSubmit={handleRoleSubmit}
      />

      <FunctionDialog
        open={functionDialogOpen}
        onOpenChange={setFunctionDialogOpen}
        item={editingFunction}
        roles={roles}
        departments={departments}
        functions={functions}
        defaultParentId={defaultFunctionParentId}
        onSubmit={handleFunctionSubmit}
      />

      <AlertDialog open={!!syncRole} onOpenChange={(open) => !open && setSyncRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar perfil padrão do cargo</AlertDialogTitle>
            <AlertDialogDescription>
              {syncRole ? (
                <>
                  O cargo <strong>{syncRole.name}</strong> vai aplicar o perfil{" "}
                  <strong>
                    {syncRole.defaultProfileId
                      ? profileNameById.get(syncRole.defaultProfileId) ?? syncRole.defaultProfileId
                      : "não configurado"}
                  </strong>{" "}
                  aos colaboradores ativos vinculados a ele.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {syncRole ? (
            <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
              {(() => {
                const syncSummary = roleSyncSummary.get(syncRole.id) ?? {
                  assigned: 0,
                  mismatched: 0,
                };

                return (
                  <>
                    {syncSummary.assigned} colaborador(es) ativo(s) vinculados.
                    {" "}
                    {syncSummary.mismatched} colaborador(es) com perfil diferente do padrão.
                    {" "}
                    Os demais permanecerão como estão.
                  </>
                );
              })()}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={syncRole ? syncingRoleId === syncRole.id : false}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                !syncRole ||
                syncingRoleId === syncRole.id ||
                !syncRole.defaultProfileId
              }
              onClick={(event) => {
                event.preventDefault();
                if (!syncRole) return;
                void handleRoleProfileSync(syncRole);
              }}
            >
              {syncRole && syncingRoleId === syncRole.id ? "Aplicando..." : "Confirmar sincronização"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
