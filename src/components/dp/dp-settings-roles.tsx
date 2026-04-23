"use client";

import React from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Briefcase, Pencil, ShieldCheck, Users2, Workflow } from "lucide-react";

import type { JobFunction, JobRole } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { useProfiles } from "@/hooks/use-profiles";
import { useHrBootstrap } from "@/hooks/use-hr-bootstrap";
import {
  createHrFunction,
  createHrRole,
  syncHrRoleProfile,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const roleSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do cargo."),
  publicTitle: z.string().trim().optional(),
  reportsTo: z.string().optional(),
  defaultProfileId: z.string().optional(),
  loginRestricted: z.boolean().default(false),
  isActive: z.boolean().default(true),
  description: z.string().trim().optional(),
  publicDescription: z.string().trim().optional(),
});

type RoleFormValues = z.infer<typeof roleSchema>;

const functionSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da função."),
  publicTitle: z.string().trim().optional(),
  compatibleRoleIds: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  description: z.string().trim().optional(),
  publicDescription: z.string().trim().optional(),
});

type FunctionFormValues = z.infer<typeof functionSchema>;

function RoleDialog({
  open,
  onOpenChange,
  role,
  roles,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  role: JobRole | null;
  roles: JobRole[];
  onSubmit: (values: RoleFormValues, currentRole: JobRole | null) => Promise<void>;
}) {
  const { profiles } = useProfiles();
  const form = useForm<RoleFormValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: {
      name: "",
      publicTitle: "",
      reportsTo: "",
      defaultProfileId: "",
      loginRestricted: false,
      isActive: true,
      description: "",
      publicDescription: "",
    },
  });

  React.useEffect(() => {
    if (!open) return;
    form.reset({
      name: role?.name ?? "",
      publicTitle: role?.publicTitle ?? "",
      reportsTo: role?.reportsTo ?? "",
      defaultProfileId: role?.defaultProfileId ?? "",
      loginRestricted: role?.loginRestricted ?? false,
      isActive: role?.isActive ?? true,
      description: role?.description ?? "",
      publicDescription: role?.publicDescription ?? "",
    });
  }, [form, open, role]);

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
            className="space-y-4"
          >
            <div className="grid gap-4 md:grid-cols-2">
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
              <FormField
                control={form.control}
                name="publicTitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Título público</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Atendente" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="reportsTo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reporta para</FormLabel>
                    <Select
                      value={field.value || "__none__"}
                      onValueChange={(value) =>
                        field.onChange(value === "__none__" ? "" : value)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sem superior direto" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Sem superior direto</SelectItem>
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

            <div className="grid gap-4 md:grid-cols-2">
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
              <FormField
                control={form.control}
                name="publicDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição pública</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={4}
                        placeholder="Texto usado futuramente em vagas."
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
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  item: JobFunction | null;
  roles: JobRole[];
  onSubmit: (
    values: FunctionFormValues,
    currentFunction: JobFunction | null
  ) => Promise<void>;
}) {
  const form = useForm<FunctionFormValues>({
    resolver: zodResolver(functionSchema),
    defaultValues: {
      name: "",
      publicTitle: "",
      compatibleRoleIds: [],
      isActive: true,
      description: "",
      publicDescription: "",
    },
  });

  React.useEffect(() => {
    if (!open) return;
    form.reset({
      name: item?.name ?? "",
      publicTitle: item?.publicTitle ?? "",
      compatibleRoleIds: item?.compatibleRoleIds ?? [],
      isActive: item?.isActive ?? true,
      description: item?.description ?? "",
      publicDescription: item?.publicDescription ?? "",
    });
  }, [form, item, open]);

  const roleOptions = roles.map((role) => ({ value: role.id, label: role.name }));

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
            <div className="grid gap-4 md:grid-cols-2">
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
              <FormField
                control={form.control}
                name="publicTitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Título público</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Operador de caixa" {...field} />
                    </FormControl>
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

            <div className="grid gap-4 md:grid-cols-2">
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
              <FormField
                control={form.control}
                name="publicDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição pública</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={4}
                        placeholder="Texto reaproveitável em vagas."
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

export function DPSettingsRoles() {
  const { firebaseUser, activeUsers } = useAuth();
  const { roles, functions, loading, error, refresh, access } = useHrBootstrap();
  const { profiles } = useProfiles();
  const { toast } = useToast();

  const [roleDialogOpen, setRoleDialogOpen] = React.useState(false);
  const [functionDialogOpen, setFunctionDialogOpen] = React.useState(false);
  const [editingRole, setEditingRole] = React.useState<JobRole | null>(null);
  const [editingFunction, setEditingFunction] = React.useState<JobFunction | null>(null);
  const [syncRole, setSyncRole] = React.useState<JobRole | null>(null);
  const [syncingRoleId, setSyncingRoleId] = React.useState<string | null>(null);
  const [roleQuery, setRoleQuery] = React.useState("");
  const [functionQuery, setFunctionQuery] = React.useState("");

  const filteredRoles = React.useMemo(() => {
    const normalized = roleQuery.trim().toLowerCase();
    if (!normalized) return roles;
    return roles.filter((role) =>
      [role.name, role.publicTitle, role.slug]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized))
    );
  }, [roleQuery, roles]);

  const filteredFunctions = React.useMemo(() => {
    const normalized = functionQuery.trim().toLowerCase();
    if (!normalized) return functions;
    return functions.filter((item) =>
      [item.name, item.publicTitle, item.slug]
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
      publicTitle: values.publicTitle || undefined,
      reportsTo: values.reportsTo || null,
      defaultProfileId: values.defaultProfileId || undefined,
      loginRestricted: values.loginRestricted,
      isActive: values.isActive,
      description: values.description || undefined,
      publicDescription: values.publicDescription || undefined,
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
      publicTitle: values.publicTitle || undefined,
      compatibleRoleIds: values.compatibleRoleIds,
      isActive: values.isActive,
      description: values.description || undefined,
      publicDescription: values.publicDescription || undefined,
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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Briefcase className="h-5 w-5" />
              Cargos
            </CardTitle>
            <CardDescription>
              Base do organograma. Cada cargo pode apontar para um perfil padrão sem trocar o modelo atual de acesso.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={roleQuery}
                onChange={(event) => setRoleQuery(event.target.value)}
                placeholder="Buscar cargo por nome, título público ou slug"
              />
              {access.canManageCatalog && (
                <Button
                  onClick={() => {
                    setEditingRole(null);
                    setRoleDialogOpen(true);
                  }}
                >
                  Novo cargo
                </Button>
              )}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Hierarquia</TableHead>
                  <TableHead>Perfil padrão</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRoles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Nenhum cargo cadastrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRoles.map((role) => (
                    <TableRow key={role.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">{role.name}</div>
                          <div className="text-xs text-muted-foreground">
                            Público: {role.publicTitle}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1 text-sm">
                          <div>
                            Reporta para:{" "}
                            <span className="text-muted-foreground">
                              {role.reportsTo ? roleNameById.get(role.reportsTo) ?? "Cargo removido" : "Topo da estrutura"}
                            </span>
                          </div>
                          {role.loginRestricted && (
                            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                              Login restrito por escala
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          {role.defaultProfileId ? (
                            <Badge variant="secondary">
                              <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                              {profileNameById.get(role.defaultProfileId) ?? role.defaultProfileId}
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">Sem perfil padrão</span>
                          )}
                          <div className="text-xs text-muted-foreground">
                            {(() => {
                              const syncSummary = roleSyncSummary.get(role.id) ?? { assigned: 0, mismatched: 0 };

                              if (syncSummary.assigned === 0) {
                                return "Nenhum colaborador ativo vinculado a este cargo.";
                              }

                              if (!role.defaultProfileId) {
                                return `${syncSummary.assigned} colaborador(es) ativo(s) sem perfil padrão para sincronizar.`;
                              }

                              if (syncSummary.mismatched === 0) {
                                return `${syncSummary.assigned} colaborador(es) já seguem o perfil padrão.`;
                              }

                              return `${syncSummary.mismatched} de ${syncSummary.assigned} colaborador(es) estão fora do perfil padrão.`;
                            })()}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge active={role.isActive} />
                      </TableCell>
                      <TableCell className="text-right">
                        {access.canManageCatalog && (
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                syncingRoleId === role.id ||
                                !role.defaultProfileId ||
                                (roleSyncSummary.get(role.id)?.assigned ?? 0) === 0 ||
                                (roleSyncSummary.get(role.id)?.mismatched ?? 0) === 0
                              }
                              onClick={() => setSyncRole(role)}
                            >
                              {syncingRoleId === role.id ? "Aplicando..." : "Aplicar perfil"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingRole(role);
                                setRoleDialogOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Workflow className="h-5 w-5" />
              Resumo
            </CardTitle>
            <CardDescription>
              Camada nova e paralela. Nada aqui substitui o `profileId` atual.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">Cargos ativos</div>
              <div className="mt-1 text-3xl font-semibold">
                {roles.filter((role) => role.isActive).length}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">Funções ativas</div>
              <div className="mt-1 text-3xl font-semibold">
                {functions.filter((item) => item.isActive).length}
              </div>
            </div>
            <div className="rounded-lg border p-4 text-sm text-muted-foreground">
              O perfil padrão do cargo agora pode ser aplicado manualmente aos colaboradores vinculados, sem substituir a autoridade atual de `profileId`.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Users2 className="h-5 w-5" />
            Funções
          </CardTitle>
          <CardDescription>
            Funções operacionais compatíveis com cargos específicos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={functionQuery}
              onChange={(event) => setFunctionQuery(event.target.value)}
              placeholder="Buscar função por nome, título público ou slug"
            />
            {access.canManageCatalog && (
              <Button
                onClick={() => {
                  setEditingFunction(null);
                  setFunctionDialogOpen(true);
                }}
              >
                Nova função
              </Button>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Função</TableHead>
                <TableHead>Cargos compatíveis</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFunctions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    Nenhuma função cadastrada.
                  </TableCell>
                </TableRow>
              ) : (
                filteredFunctions.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Público: {item.publicTitle}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {(item.compatibleRoleIds ?? []).length > 0 ? (
                          item.compatibleRoleIds?.map((roleId) => (
                            <Badge key={roleId} variant="secondary">
                              {roleNameById.get(roleId) ?? roleId}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            Sem restrição cadastrada
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge active={item.isActive} />
                    </TableCell>
                    <TableCell className="text-right">
                      {access.canManageCatalog && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditingFunction(item);
                            setFunctionDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RoleDialog
        open={roleDialogOpen}
        onOpenChange={setRoleDialogOpen}
        role={editingRole}
        roles={roles}
        onSubmit={handleRoleSubmit}
      />

      <FunctionDialog
        open={functionDialogOpen}
        onOpenChange={setFunctionDialogOpen}
        item={editingFunction}
        roles={roles}
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
