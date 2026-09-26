"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Hammer, Loader2, Plus, Search } from "lucide-react";
import { budgetRequest as request } from "./budget-api";
import { financialDateKey } from "@/features/financial/lib/financial-dates";
import { formatCurrency } from "@/features/financial/lib/utils";
import type { FinancialBudgetProject, FinancialBudgetProjectSummary, ProjectCashPlan } from "@/features/financial/budgets/types";
import { createBudgetProjectSchema } from "@/features/financial/budgets/schemas";
import { materializeProjectCashPlan, projectDateRange } from "@/features/financial/budgets/project-cash-plan";
import { ProjectCashPlanEditor, projectDateLabel } from "./project-cash-plan-editor";
import { ProjectCashStages } from "./project-cash-stages";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";

type AccountOption = { id: string; name: string };
type Candidate = { id: string; description: string; amountCents: number };
const monthNow = () => financialDateKey(new Date())!.slice(0, 7);

export default function BudgetProjectsManagement({ canManage, accounts }: { canManage: boolean; accounts: AccountOption[] }) {
  const { toast } = useToast();
  const [projects, setProjects] = useState<FinancialBudgetProject[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [detail, setDetail] = useState<FinancialBudgetProjectSummary | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateMonth, setCandidateMonth] = useState(monthNow);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [accountPlanIds, setAccountPlanIds] = useState<string[]>([]);
  const [startMonth, setStartMonth] = useState(monthNow);
  const [periodMode, setPeriodMode] = useState<"competence" | "date_range">("competence");
  const [startDate, setStartDate] = useState(() => `${monthNow()}-01`);
  const [endDate, setEndDate] = useState(() => projectDateRange({ startMonth: monthNow(), endMonth: monthNow() }).endDate);
  const [cashPlan, setCashPlan] = useState<ProjectCashPlan>({ mode: "uniform", stages: [] });
  const [revisedPlan, setRevisedPlan] = useState<ProjectCashPlan>({ mode: "uniform", stages: [] });
  const [linkStages, setLinkStages] = useState<Record<string, string>>({});
  const detailVersion = useRef(0);
  const [amount, setAmount] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [revisedAmount, setRevisedAmount] = useState("");
  const [revisionReason, setRevisionReason] = useState("");
  const period = { startMonth: periodMode === "competence" ? startMonth : startDate.slice(0, 7),
    endMonth: periodMode === "competence" ? startMonth : endDate.slice(0, 7),
    ...(periodMode === "date_range" ? { startDate, endDate } : {}), budgetedAmountCents: Math.round(Number(amount) * 100) };

  const refresh = useCallback(async () => {
    try {
      const result = await request<{ projects: FinancialBudgetProject[] }>("/api/financial/budget-projects");
      setProjects(result.projects);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar projetos."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const refreshDetail = useCallback(async () => {
    if (selectedIdRef.current !== selectedId) return;
    const version = ++detailVersion.current;
    if (!selectedId) { setDetail(null); return; }
    try {
      const result = await request<{ project: FinancialBudgetProjectSummary }>(`/api/financial/budget-projects/${encodeURIComponent(selectedId)}`);
      if (version === detailVersion.current && selectedIdRef.current === selectedId) { setDetail(result.project); setError(null); }
    } catch (cause) { if (version === detailVersion.current && selectedIdRef.current === selectedId) { setDetail(null); setError(cause instanceof Error ? cause.message : "Falha ao carregar projeto."); } }
  }, [selectedId]);
  useEffect(() => { setDetail(null); setReviewing(false); setLinkStages({}); void refreshDetail(); return () => { detailVersion.current += 1; }; }, [refreshDetail]);

  async function createProject() {
    if (!name.trim() || !accountPlanIds.length || amount.trim() === "" || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
      toast({ variant: "destructive", title: "Informe nome, contas e limite do projeto." }); return;
    }
    setSaving(true);
    try {
      const parsed = createBudgetProjectSchema.safeParse({ name, accountPlanIds, periodMode, ...period, cashPlan });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Confira o período e o cronograma.");
      materializeProjectCashPlan(parsed.data, parsed.data.cashPlan!);
      const result = await request<{ id: string }>("/api/financial/budget-projects", "POST", parsed.data);
      toast({ title: "Projeto criado. Vincule as despesas abaixo." });
      setFormOpen(false); setName(""); setAccountPlanIds([]); setAmount(""); setCashPlan({ mode: "uniform", stages: [] });
      await refresh(); setSelectedId(result.id);
    } catch (cause) { toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Falha ao criar projeto." }); }
    finally { setSaving(false); }
  }

  async function searchCandidates() {
    if (!selectedId) return;
    setSaving(true);
    try {
      const result = await request<{ expenses: Candidate[] }>(`/api/financial/budget-projects/${encodeURIComponent(selectedId)}/candidates?month=${candidateMonth}&search=${encodeURIComponent(candidateSearch)}`);
      setCandidates(result.expenses);
    } catch (cause) { toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Falha ao buscar despesas." }); }
    finally { setSaving(false); }
  }

  async function changeLink(expenseId: string, linked: boolean) {
    if (!selectedId) return;
    setSaving(true);
    try {
      const path = `/api/financial/budget-projects/${encodeURIComponent(selectedId)}/expenses`;
      const stageId = linkStages[expenseId] ?? detail?.expenseStageIds?.[expenseId];
      if (!linked && detail?.cashPlan && !stageId) throw new Error("Escolha a etapa que esta despesa substitui.");
      await request(linked ? `${path}?expenseId=${encodeURIComponent(expenseId)}` : path, linked ? "DELETE" : "POST",
        linked ? undefined : { expenseId, stageId });
      setCandidates((current) => current.filter((item) => item.id !== expenseId));
      await refreshDetail(); await refresh();
    } catch (cause) { toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Falha ao alterar o vínculo." }); }
    finally { setSaving(false); }
  }

  async function toggleProject() {
    if (!detail) return;
    setSaving(true);
    try {
      await request(`/api/financial/budget-projects/${encodeURIComponent(detail.id)}`, "PATCH", { active: !detail.active });
      await refreshDetail(); await refresh();
    } catch (cause) { toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Falha ao alterar projeto." }); }
    finally { setSaving(false); }
  }

  async function reviseProject() {
    if (!detail || !Number.isFinite(Number(revisedAmount)) || Number(revisedAmount) < 0 || revisionReason.trim().length < 5) {
      toast({ variant: "destructive", title: "Informe o novo limite e o motivo da revisão." }); return;
    }
    setSaving(true);
    try {
      await request(`/api/financial/budget-projects/${encodeURIComponent(detail.id)}`, "PATCH", {
        budgetedAmountCents: Math.round(Number(revisedAmount) * 100), reason: revisionReason, cashPlan: revisedPlan,
      });
      setReviewing(false); setRevisionReason(""); await refreshDetail(); await refresh();
    } catch (cause) { toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Falha ao revisar o projeto." }); }
    finally { setSaving(false); }
  }

  function stagePicker(expenseId: string) {
    if (!detail?.cashPlan) return null;
    return <Select disabled={saving} value={linkStages[expenseId] ?? detail.expenseStageIds?.[expenseId] ?? ""} onValueChange={(id) => setLinkStages((current) => ({ ...current, [expenseId]: id }))}>
      <SelectTrigger className="w-full sm:w-64" aria-label={`Etapa da despesa ${expenseId}`}><SelectValue placeholder="Qual etapa esta despesa cobre?" /></SelectTrigger>
      <SelectContent>{detail.cashPlan.stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectContent>
    </Select>;
  }

  return <Card className="rounded-2xl border-[#e2ded4] shadow-sm"><CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div><CardTitle className="flex items-center gap-2"><Hammer className="h-5 w-5 text-primary" />Orçamento de projeto</CardTitle>
      <CardDescription>Para reforma ou outra iniciativa com várias despesas, possivelmente em meses diferentes. Você escolhe quais despesas pertencem ao projeto.</CardDescription></div>
    {canManage && <Button variant="outline" onClick={() => setFormOpen(!formOpen)}><Plus className="mr-2 h-4 w-4" />{formOpen ? "Fechar" : "Novo projeto"}</Button>}
  </CardHeader><CardContent className="space-y-5">
    {formOpen && canManage && <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="project-name">Nome do projeto</Label><Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Reforma do quiosque" /></div>
        <div className="space-y-2"><Label htmlFor="project-value">Limite total (R$)</Label><CurrencyInput id="project-value" value={amount === "" ? "" : Number(amount)} onChange={(value) => setAmount(String(value))} /></div>
        <div className="space-y-2"><Label htmlFor="project-period-mode">Como definir o período?</Label><Select value={periodMode} onValueChange={(value) => setPeriodMode(value as typeof periodMode)}><SelectTrigger id="project-period-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="competence">Mês de competência</SelectItem><SelectItem value="date_range">Período personalizado</SelectItem></SelectContent></Select></div>
        {periodMode === "competence" ? <div className="space-y-2"><Label htmlFor="project-start">Mês de competência</Label><Input id="project-start" type="month" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} /></div>
          : <><div className="space-y-2"><Label htmlFor="project-start">Início do período</Label><Input id="project-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="project-end">Fim do período</Label><Input id="project-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div></>}
        </div>
        <ProjectCashPlanEditor value={cashPlan} onChange={setCashPlan} period={period} disabled={saving} />
      <div className="space-y-2"><Label>Contas permitidas para despesas do projeto</Label><div className="grid max-h-36 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{accounts.map((account) => <label key={account.id} className="flex items-center gap-2 rounded-lg bg-background p-2 text-sm">
        <Checkbox checked={accountPlanIds.includes(account.id)} onCheckedChange={(checked) => setAccountPlanIds(checked ? [...accountPlanIds, account.id] : accountPlanIds.filter((id) => id !== account.id))} />{account.name}
      </label>)}</div></div>
      <p className="text-xs text-muted-foreground">Criar o projeto não lança uma despesa. Depois, pesquise e vincule os lançamentos que fazem parte dele.</p>
      <Button onClick={createProject} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar projeto</Button>
    </div>}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : projects.length === 0
      ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum projeto cadastrado.</p>
      : <div className="flex flex-wrap gap-2">{projects.map((project) => <Button key={project.id} variant={selectedId === project.id ? "default" : "outline"} size="sm" onClick={() => { setSelectedId(project.id); setCandidates([]); }}>
        {project.name} {!project.active && "· inativo"}
      </Button>)}</div>}
    {detail && <div className="space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{detail.name}</h3><p className="text-xs text-muted-foreground">{projectDateLabel(projectDateRange(detail).startDate)} a {projectDateLabel(projectDateRange(detail).endDate)} · {detail.accountPlanIds.map((id) => accounts.find((account) => account.id === id)?.name ?? id).join(" · ")}</p></div>
        <div className="flex items-center gap-2"><Badge variant={detail.active ? "secondary" : "outline"}>{detail.active ? "Ativo" : "Inativo"}</Badge>{canManage && <Button variant="ghost" size="sm" onClick={toggleProject} disabled={saving}>{detail.active ? "Inativar" : "Reativar"}</Button>}</div></div>
      <div className="grid gap-3 sm:grid-cols-3">{[["Limite total", detail.budgetedAmountCents], ["Comprometido", detail.consumedAmountCents], ["Disponível", detail.balanceAmountCents]].map(([label, cents]) => <div key={label} className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="font-mono text-lg font-bold">{formatCurrency(Number(cents) / 100)}</p></div>)}</div>
      {canManage && <><Button variant="outline" size="sm" onClick={() => { setReviewing(!reviewing); setRevisedAmount((detail.budgetedAmountCents / 100).toFixed(2)); setRevisedPlan(detail.cashPlan?.mode === "custom" ? detail.cashPlan : { mode: "uniform", stages: [] }); setRevisionReason(""); }}>{detail.cashPlan ? "Revisar limite e cronograma" : "Configurar cronograma"}</Button>
        {reviewing && <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1"><Label htmlFor="project-revised-amount">Novo limite (R$)</Label><CurrencyInput id="project-revised-amount" value={revisedAmount === "" ? "" : Number(revisedAmount)} onChange={(value) => setRevisedAmount(String(value))} /></div>
          <div className="space-y-1"><Label htmlFor="project-revision-reason">Motivo da revisão</Label><Input id="project-revision-reason" value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} /></div>
          <Button disabled={saving} onClick={reviseProject}>Salvar revisão</Button>
          <div className="sm:col-span-3"><ProjectCashPlanEditor value={revisedPlan} onChange={setRevisedPlan} period={{ ...detail, budgetedAmountCents: Math.round(Number(revisedAmount) * 100) }} disabled={saving} /></div>
        </div>}</>}
      <p className="text-xs text-muted-foreground">O limite do projeto é acompanhado separadamente dos orçamentos mensais. Uma despesa vinculada pode aparecer nas duas visões; não some os dois limites.</p>
      {detail.issues.length > 0 && <p className="text-xs text-amber-700">{detail.issues.join(" ")}</p>}
      <ProjectCashStages key={detail.id} project={detail} canManage={canManage} onSaved={refreshDetail} />
      <div className="space-y-2"><h4 className="text-sm font-semibold">Despesas do projeto</h4>
        {detail.expenseIds.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma despesa vinculada.</p> : detail.expenseIds.map((id) => detail.expenses.find((expense) => expense.id === id) ?? { id, description: `Vínculo a conferir: ${id}`, competenceMonth: "não apurada", amountCents: 0 }).map((expense) => <div key={expense.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm"><span>{expense.description} · {expense.competenceMonth}</span><span className="font-mono">{formatCurrency(expense.amountCents / 100)}</span>
          {canManage && <>{stagePicker(expense.id)}{detail.cashPlan && <Button variant="outline" size="sm" disabled={saving || !linkStages[expense.id]} onClick={() => void changeLink(expense.id, false)}>Salvar etapa</Button>}<Button variant="ghost" size="sm" disabled={saving} onClick={() => void changeLink(expense.id, true)}>Desvincular</Button></>}</div>)}
      </div>
      {canManage && detail.active && <div className="space-y-3 border-t pt-4"><h4 className="text-sm font-semibold">Vincular uma despesa existente</h4>
        <div className="flex flex-wrap gap-2"><Input aria-label="Competência da despesa" type="month" className="w-44" value={candidateMonth} onChange={(event) => setCandidateMonth(event.target.value)} />
          <Input aria-label="Buscar descrição da despesa" className="min-w-48 flex-1" placeholder="Fornecedor ou descrição" value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} />
          <Button variant="outline" onClick={searchCandidates} disabled={saving}><Search className="mr-2 h-4 w-4" />Buscar despesas</Button></div>
        {candidates.map((candidate) => <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm"><span>{candidate.description}</span><span className="font-mono">{formatCurrency(candidate.amountCents / 100)}</span>
          {stagePicker(candidate.id)}<Button size="sm" disabled={saving} onClick={() => void changeLink(candidate.id, false)}>Vincular</Button></div>)}
      </div>}
    </div>}
  </CardContent></Card>;
}
