"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDoc, deleteDoc, setDoc } from "firebase/firestore";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, MoreHorizontal, PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useKiosks } from "@/hooks/use-kiosks";
import { auth } from "@/lib/firebase";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import {
  resultCenterFormSchema,
  type ResultCenterFormValues,
} from "@/features/financial/lib/schemas";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type ResultCenter = ResultCenterFormValues & { id: string };

export default function ResultCentersManagement({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const [resultCenters, setResultCenters] = useState<ResultCenter[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingResultCenter, setEditingResultCenter] = useState<ResultCenter | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!auth.currentUser) {
      setError(new Error("Usuário não autenticado."));
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetchWithTimeout("/api/financial/data?path=resultCenters", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Falha ao carregar os centros de resultado.");
      }

      setResultCenters((payload.docs ?? []) as ResultCenter[]);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError
          : new Error("Falha ao carregar os centros de resultado.")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const availableUnits = useMemo(
    () => [...kiosks].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [kiosks]
  );
  const unitNameById = useMemo(
    () => Object.fromEntries(availableUnits.map((unit) => [unit.id, unit.name])),
    [availableUnits]
  );

  const form = useForm<ResultCenterFormValues>({
    resolver: zodResolver(resultCenterFormSchema),
    defaultValues: { name: "", description: "", unitIds: [] },
  });

  function handleDialogOpen(resultCenter: ResultCenter | null = null) {
    setEditingResultCenter(resultCenter);
    form.reset(
      resultCenter
        ? {
            name: resultCenter.name,
            description: resultCenter.description ?? "",
            unitIds: resultCenter.unitIds ?? [],
          }
        : { name: "", description: "", unitIds: [] }
    );
    setIsFormOpen(true);
  }

  async function onSubmit(values: ResultCenterFormValues) {
    setIsSaving(true);
    try {
      const payload = {
        ...values,
        unitIds: Array.from(new Set(values.unitIds ?? [])),
      };

      if (editingResultCenter) {
        await setDoc(financialDoc("resultCenters", editingResultCenter.id), payload);
        toast({ title: "Centro de resultado atualizado!" });
      } else {
        await addDoc(financialCollection("resultCenters"), payload);
        toast({ title: "Centro de resultado criado!" });
      }
      refresh();
      setIsFormOpen(false);
      setEditingResultCenter(null);
    } catch {
      toast({ variant: "destructive", title: "Erro ao salvar o centro de resultado." });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingId) return;
    try {
      await deleteDoc(financialDoc("resultCenters", deletingId));
      toast({ title: "Centro de resultado removido." });
      refresh();
    } catch {
      toast({ variant: "destructive", title: "Erro ao remover o centro de resultado." });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Centros de resultado</CardTitle>
            <CardDescription>Defina os centros usados no rateio e na análise por unidade de resultado.</CardDescription>
          </div>
          {canManage && (
            <Button onClick={() => handleDialogOpen()}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Novo centro
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Falha ao carregar os centros de resultado.</p>
                <p>{error.message}</p>
              </div>
            </div>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Unidades vinculadas</TableHead>
              <TableHead>Descrição</TableHead>
              {canManage && <TableHead className="w-16" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={canManage ? 4 : 3} className="h-24 text-center">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                </TableCell>
              </TableRow>
            ) : !resultCenters?.length ? (
              <TableRow>
                <TableCell colSpan={canManage ? 4 : 3} className="h-24 text-center text-muted-foreground">
                  Nenhum centro de resultado cadastrado.
                </TableCell>
              </TableRow>
            ) : (
              resultCenters.map((resultCenter) => (
                <TableRow key={resultCenter.id}>
                  <TableCell className="font-medium">{resultCenter.name}</TableCell>
                  <TableCell>
                    {resultCenter.unitIds?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {resultCenter.unitIds.map((unitId) => (
                          <Badge key={unitId} variant="secondary">
                            {unitNameById[unitId] ?? unitId}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Sem vínculo</span>
                    )}
                  </TableCell>
                  <TableCell>{resultCenter.description || "—"}</TableCell>
                  {canManage && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button aria-haspopup="true" size="icon" variant="ghost">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Toggle menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                          <DropdownMenuLabel>Ações</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => handleDialogOpen(resultCenter)}>Editar</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDeletingId(resultCenter.id)}>Excluir</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsFormOpen(false);
            setEditingResultCenter(null);
          }
        }}
      >
        <DialogContent onCloseAutoFocus={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editingResultCenter ? "Editar centro" : "Novo centro de resultado"}</DialogTitle>
            <DialogDescription>Use centros de resultado para distribuir despesas e analisar desempenho.</DialogDescription>
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
                      <Input placeholder="Ex: Operação São Luís" {...field} />
                    </FormControl>
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
                      <Textarea placeholder="Contexto opcional" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="unitIds"
                render={({ field }) => {
                  const selectedUnitIds = field.value ?? [];

                  return (
                    <FormItem>
                      <FormLabel>Unidades vinculadas</FormLabel>
                      <div className="space-y-3 rounded-lg border p-3">
                        <p className="text-sm text-muted-foreground">
                          Deixe sem marcar para usar o centro sem vínculo com unidade específica.
                        </p>
                        {kiosksLoading ? (
                          <div className="flex h-16 items-center justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          </div>
                        ) : !availableUnits.length ? (
                          <p className="text-sm text-muted-foreground">
                            Nenhuma unidade cadastrada no OP.
                          </p>
                        ) : (
                          <div className="grid gap-3 md:grid-cols-2">
                            {availableUnits.map((unit) => {
                              const checked = selectedUnitIds.includes(unit.id);
                              return (
                                <label
                                  key={unit.id}
                                  className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/30"
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(nextChecked) => {
                                      const nextIds = nextChecked
                                        ? [...selectedUnitIds, unit.id]
                                        : selectedUnitIds.filter((unitId) => unitId !== unit.id);
                                      field.onChange(nextIds);
                                    }}
                                  />
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium leading-none">{unit.name}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">{unit.id}</p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <FormMessage />
                    </FormItem>
                  );
                }}
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

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir centro de resultado?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação remove o centro selecionado. Confirme se ele não está sendo usado em despesas ativas.
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
