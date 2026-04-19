"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { addDoc, Timestamp, updateDoc } from "firebase/firestore";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CheckCircle2,
  FileUp,
  Link2,
  Loader2,
  RotateCcw,
  Save,
  SkipForward,
  Sparkles,
  Upload,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { applyAliasesAndMatch, type PendingInstallment } from "@/features/financial/lib/import-matcher";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { parseCSV, CSV_BANK_PROFILES } from "@/features/financial/lib/parsers/csv";
import { parseOFX } from "@/features/financial/lib/parsers/ofx";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import type { ImportedTransaction, ParsedBankEntry } from "@/features/financial/types/import";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Textarea } from "@/components/ui/textarea";

export function FinancialImportPage() {
  const { firebaseUser, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const { data: aliasesData } = useFinancialCollection<any>(financialCollection("importAliases"));
  const { data: accountPlans } = useFinancialCollection<any>(financialCollection("accountPlans"));
  const { data: expensesData } = useFinancialCollection<any>(financialCollection("expenses"));
  const units = useMemo(
    () => [...kiosks].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [kiosks]
  );

  const aliases = aliasesData || [];
  const expenses = expensesData || [];
  const [fileType, setFileType] = useState<"ofx" | "csv">("ofx");
  const [bankProfile, setBankProfile] = useState("nubank");
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transactions, setTransactions] = useState<ImportedTransaction[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!permissions.financial?.expenses?.import) {
    return (
      <FinancialAccessGuard
        title="Importar extrato"
        description="Seu perfil não possui permissão para importar extratos e efetivar transações no financeiro."
        backHref={FINANCIAL_ROUTES.expenses}
      />
    );
  }

  const pendingInstallments = useMemo<PendingInstallment[]>(
    () =>
      expenses
        .filter((expense) => expense.status === "pending" && expense.totalValue)
        .map((expense) => ({
          expenseId: expense.id,
          expenseDescription: expense.description,
          installmentNumber: expense.installmentNumber,
          dueDate: toDate(expense.dueDate) || new Date(),
          value: expense.totalValue,
        })),
    [expenses]
  );

  const processFile = useCallback(
    async (file: File) => {
      setIsProcessing(true);
      try {
        const content = await file.text();
        let entries: ParsedBankEntry[] = [];
        if (file.name.toLowerCase().endsWith(".ofx") || fileType === "ofx") {
          entries = parseOFX(content);
        } else {
          const profile = CSV_BANK_PROFILES[bankProfile]?.config || CSV_BANK_PROFILES.custom.config;
          entries = parseCSV(content, profile);
        }

        if (entries.length === 0) {
          toast({ variant: "destructive", title: "Nenhuma transação encontrada no arquivo." });
          return;
        }

        setTransactions(applyAliasesAndMatch(entries, aliases, pendingInstallments));
      } catch (error) {
        console.error(error);
        toast({
          variant: "destructive",
          title: "Erro ao processar o arquivo",
          description: "Verifique se o formato do extrato está correto.",
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [aliases, bankProfile, fileType, pendingInstallments, toast]
  );

  function updateTransaction(tempId: string, patch: Partial<ImportedTransaction>) {
    setTransactions((previous) => previous.map((transaction) => (transaction.tempId === tempId ? { ...transaction, ...patch } : transaction)));
  }

  async function importConfirmed() {
    if (!firebaseUser) return;
    const confirmed = transactions.filter((transaction) => transaction.status === "confirmed");
    if (confirmed.length === 0) {
      toast({ variant: "destructive", title: "Confirme pelo menos uma transação antes de efetivar." });
      return;
    }

    setIsProcessing(true);
    try {
      const now = Timestamp.now();
      for (const transaction of confirmed) {
        await addDoc(financialCollection("transactions"), {
          type: transaction.amount >= 0 ? "revenue" : "expense_payment",
          direction: transaction.amount >= 0 ? "in" : "out",
          amount: Math.abs(transaction.amount),
          date: Timestamp.fromDate(transaction.date),
          description: transaction.description,
          accountPlanId: transaction.accountPlanId || null,
          accountPlanName: transaction.accountPlanName || null,
          resultCenterId: transaction.resultCenterId || null,
          resultCenterName: transaction.resultCenterName || null,
          supplier: transaction.supplier || null,
          importedFrom: "bank_statement",
          rawBankDescription: transaction.rawDescription,
          linkedExpenseId: transaction.linkedExpenseId || transaction.suggestedExpenseId || null,
          createdBy: firebaseUser.uid,
          createdAt: now,
        });

        if (transaction.linkedExpenseId || transaction.suggestedExpenseId) {
          await updateDoc(financialDoc("expenses", transaction.linkedExpenseId || transaction.suggestedExpenseId!), {
            status: "paid",
            paidAt: Timestamp.fromDate(transaction.date),
            paidByImport: true,
          });
        }
      }

      toast({ title: `${confirmed.length} transações importadas com sucesso!` });
      setTransactions([]);
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Erro ao efetivar a importação." });
    } finally {
      setIsProcessing(false);
    }
  }

  const stats = useMemo(() => {
    const confirmed = transactions.filter((transaction) => transaction.status === "confirmed").length;
    const skipped = transactions.filter((transaction) => transaction.status === "skipped").length;
    const pending = transactions.filter((transaction) => transaction.status === "pending").length;
    return { confirmed, skipped, pending, total: transactions.length };
  }, [transactions]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Importar extrato</h1>
        <p className="text-muted-foreground">Faça upload do extrato, revise a classificação e efetive no fluxo financeiro.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload do arquivo</CardTitle>
          <CardDescription>OFX é o formato recomendado. CSV requer selecionar o perfil do banco.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {(["ofx", "csv"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setFileType(type)}
                className={`flex-1 rounded-lg border py-3 text-sm font-medium transition-all ${
                  fileType === type ? "border-primary bg-primary/5 text-primary" : "border-muted text-muted-foreground hover:border-foreground/30"
                }`}
              >
                {type.toUpperCase()}
              </button>
            ))}
          </div>

          {fileType === "csv" && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-muted-foreground">Perfil do banco</label>
              <Select value={bankProfile} onValueChange={setBankProfile}>
                <SelectTrigger className="w-full md:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CSV_BANK_PROFILES).map(([value, profile]) => (
                    <SelectItem key={value} value={value}>
                      {profile.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void processFile(file);
            }}
            onClick={() => fileRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-all ${
              isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            {isProcessing ? (
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-medium">Arraste o arquivo aqui ou clique para selecionar</p>
                  <p className="mt-1 text-xs text-muted-foreground">Arquivos {fileType.toUpperCase()} · máximo 10 MB</p>
                </div>
              </>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept={fileType === "ofx" ? ".ofx" : ".csv,.txt"}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void processFile(file);
            }}
          />
        </CardContent>
      </Card>

      {transactions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Revisão</CardTitle>
                <CardDescription>Confirme ou ignore cada transação antes de efetivar.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{stats.total} transações</Badge>
                <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 bg-emerald-500/5">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> {stats.confirmed} confirmadas
                </Badge>
                <Badge variant="outline">{stats.pending} pendentes</Badge>
                <Badge variant="outline">{stats.skipped} ignoradas</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setTransactions((previous) =>
                    previous.map((transaction) =>
                      transaction.status === "pending" ? { ...transaction, status: "confirmed" } : transaction
                    )
                  )
                }
              >
                <Save className="mr-2 h-4 w-4" /> Confirmar pendentes
              </Button>
              <Button size="sm" onClick={importConfirmed} disabled={isProcessing || stats.confirmed === 0}>
                <FileUp className="mr-2 h-4 w-4" /> Efetivar {stats.confirmed > 0 ? `(${stats.confirmed})` : ""}
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={FINANCIAL_ROUTES.cashFlow}>Abrir fluxo de caixa</Link>
              </Button>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Plano de contas</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((transaction) => (
                    <TableRow key={transaction.tempId} className={transaction.status === "skipped" ? "opacity-50" : ""}>
                      <TableCell>{format(transaction.date, "dd/MM/yyyy", { locale: ptBR })}</TableCell>
                      <TableCell className="min-w-[240px]">
                        <div className="space-y-2">
                          <Input
                            value={transaction.description}
                            onChange={(event) => updateTransaction(transaction.tempId, { description: event.target.value })}
                            disabled={transaction.status === "skipped"}
                          />
                          <p className="break-all text-[11px] text-muted-foreground">{transaction.rawDescription}</p>
                          {transaction.matchedAliasId && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-indigo-500">
                              <Sparkles className="h-3 w-3" /> Alias aplicado
                            </span>
                          )}
                          {transaction.suggestedExpenseId && (
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-emerald-600">
                              <span className="inline-flex items-center gap-1">
                                <Link2 className="h-3 w-3" /> Sugestão: {transaction.suggestedExpenseDescription}
                              </span>
                              {!transaction.linkedExpenseId && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-[11px]"
                                  onClick={() => updateTransaction(transaction.tempId, { linkedExpenseId: transaction.suggestedExpenseId })}
                                >
                                  Vincular sugestão
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {transaction.amount < 0 ? "-" : "+"}
                        {formatCurrency(Math.abs(transaction.amount))}
                      </TableCell>
                      <TableCell className="min-w-[220px]">
                        <Select
                          value={transaction.accountPlanId || "none"}
                          onValueChange={(value) => {
                            const plan = accountPlans?.find((item) => item.id === value);
                            updateTransaction(transaction.tempId, {
                              accountPlanId: value === "none" ? "" : value,
                              accountPlanName: value === "none" ? "" : plan?.name || "",
                            });
                          }}
                          disabled={transaction.status === "skipped"}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="Plano de contas" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Nenhum</SelectItem>
                            {accountPlans?.map((plan) => (
                              <SelectItem key={plan.id} value={plan.id}>
                                {plan.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="min-w-[220px]">
                        <Select
                          value={transaction.resultCenterId || "none"}
                          onValueChange={(value) => {
                            const unit = units.find((item) => item.id === value);
                            updateTransaction(transaction.tempId, {
                              resultCenterId: value === "none" ? "" : value,
                              resultCenterName: value === "none" ? "" : unit?.name || "",
                            });
                          }}
                          disabled={transaction.status === "skipped"}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="Unidade" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Nenhum</SelectItem>
                            {units.map((unit) => (
                              <SelectItem key={unit.id} value={unit.id}>
                                {unit.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => updateTransaction(transaction.tempId, { status: "confirmed" })}
                            disabled={transaction.status === "skipped"}
                          >
                            <CheckCircle2 className="mr-1 h-4 w-4" /> OK
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              updateTransaction(transaction.tempId, {
                                status: transaction.status === "skipped" ? "pending" : "skipped",
                              })
                            }
                          >
                            {transaction.status === "skipped" ? <RotateCcw className="h-4 w-4" /> : <SkipForward className="h-4 w-4" />}
                          </Button>
                        </div>
                        {transaction.linkedExpenseId && (
                          <p className="mt-1 text-[11px] text-emerald-600">Despesa vinculada para quitação automática.</p>
                        )}
                        <Textarea
                          className="mt-2"
                          placeholder="Fornecedor opcional"
                          value={transaction.supplier}
                          onChange={(event) => updateTransaction(transaction.tempId, { supplier: event.target.value })}
                          disabled={transaction.status === "skipped"}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
