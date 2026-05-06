"use client";

import { useMemo, useState } from "react";
import { addDoc, deleteDoc, Timestamp, updateDoc } from "firebase/firestore";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  expenseDescriptionFormSchema,
  type ExpenseDescriptionFormValues,
} from "@/features/financial/lib/schemas";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type ExpenseDescriptionRecord = ExpenseDescriptionFormValues & {
  id: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export default function ExpenseDescriptionsManagement({ canManage = true }: { canManage?: boolean }) {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const {
    data: descriptions,
    loading,
    refresh,
  } = useFinancialCollection<ExpenseDescriptionRecord>(financialCollection("expenseDescriptions"));
  const [open, setOpen] = useState(false);
  const [editingDescription, setEditingDescription] = useState<ExpenseDescriptionRecord | null>(null);
  const [deletingDescription, setDeletingDescription] = useState<ExpenseDescriptionRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<ExpenseDescriptionFormValues>({
    resolver: zodResolver(expenseDescriptionFormSchema),
    defaultValues: {
      label: "",
      active: true,
    },
  });

  const orderedDescriptions = useMemo(
    () =>
      [...(descriptions || [])].sort((left, right) =>
        left.label.localeCompare(right.label, "pt-BR", { sensitivity: "base" })
      ),
    [descriptions]
  );

  function openNew() {
    setEditingDescription(null);
    form.reset({ label: "", active: true });
    setOpen(true);
  }

  function openEdit(description: ExpenseDescriptionRecord) {
    setEditingDescription(description);
    form.reset({
      label: description.label,
      active: description.active ?? true,
    });
    setOpen(true);
  }

  async function onSubmit(values: ExpenseDescriptionFormValues) {
    if (!firebaseUser) return;

    setIsSaving(true);
    try {
      const payload = {
        label: values.label.trim(),
        active: values.active,
        updatedAt: Timestamp.now(),
        updatedBy: firebaseUser.uid,
      };

      if (editingDescription) {
        await updateDoc(financialDoc("expenseDescriptions", editingDescription.id), payload);
        toast({ title: "Descrição atualizada." });
      } else {
        await addDoc(financialCollection("expenseDescriptions"), {
          ...payload,
          createdAt: Timestamp.now(),
          createdBy: firebaseUser.uid,
        });
        toast({ title: "Descrição criada." });
      }

      await refresh();
      setOpen(false);
      setEditingDescription(null);
    } catch {
      toast({ variant: "destructive", title: "Erro ao salvar a descrição." });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingDescription) return;

    try {
      await deleteDoc(financialDoc("expenseDescriptions", deletingDescription.id));
      toast({ title: "Descrição removida." });
      await refresh();
    } catch {
      toast({ variant: "destructive", title: "Erro ao remover a descrição." });
    } finally {
      setDeletingDescription(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Descrições reutilizáveis
          </CardTitle>
          <CardDescription>
            Cadastre descrições habituais para acelerar o lançamento manual de despesas.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1.5 h-4 w-4" />
            Nova descrição
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="w-24 text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 3 : 2} className="h-24 text-center text-muted-foreground">
                    Carregando descrições...
                  </TableCell>
                </TableRow>
              ) : !orderedDescriptions.length ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 3 : 2} className="h-24 text-center text-muted-foreground">
                    Nenhuma descrição cadastrada.
                  </TableCell>
                </TableRow>
              ) : (
                orderedDescriptions.map((description) => (
                  <TableRow key={description.id}>
                    <TableCell className="font-medium">{description.label}</TableCell>
                    <TableCell>
                      <Badge variant={description.active ? "default" : "secondary"}>
                        {description.active ? "Ativa" : "Inativa"}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(description)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-rose-500 hover:text-rose-600"
                            onClick={() => setDeletingDescription(description)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setOpen(false);
            setEditingDescription(null);
          }
        }}
      >
        <DialogContent className="max-w-md" onCloseAutoFocus={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editingDescription ? "Editar descrição" : "Nova descrição"}</DialogTitle>
            <DialogDescription>
              Esse texto aparecerá como sugestão no lançamento manual de despesas.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Aluguel da unidade Nazaré" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel>Descrição ativa</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Desative para ocultar a sugestão sem perder o cadastro.
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSaving}>
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingDescription} onOpenChange={(nextOpen) => !nextOpen && setDeletingDescription(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir descrição?</AlertDialogTitle>
            <AlertDialogDescription>
              A sugestão <strong>{deletingDescription?.label}</strong> deixará de aparecer em novos lançamentos.
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
