import { CircleAlert, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/features/financial/lib/utils";
import type { DrePersonAnalysis } from "@/features/financial/lib/dre-person-analysis";

type DrePeopleViewProps = {
  analysis: DrePersonAnalysis;
  drePersonnelTotal: number;
  loading: boolean;
  monthLabel: string;
  unitLabel: string;
};

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function natureLabel(type: "employer_cost" | "employee_deduction" | "informational") {
  if (type === "employer_cost") return "Custo da empresa";
  if (type === "employee_deduction") return "Desconto do colaborador";
  return "Informativo";
}

export function DrePeopleView({
  analysis,
  drePersonnelTotal,
  loading,
  monthLabel,
  unitLabel,
}: DrePeopleViewProps) {
  const difference = Number((drePersonnelTotal - analysis.employerCost).toFixed(2));
  const reconciled = Math.abs(difference) < 0.01;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        )) : (
          <>
            <Kpi label="Custo de pessoal na DRE" value={formatCurrency(drePersonnelTotal)} note="Somente custos da empresa" />
            <Kpi label="Custo individualizado" value={formatCurrency(analysis.employerCost)} note={`${analysis.people.length} colaborador${analysis.people.length === 1 ? "" : "es"}`} />
            <Kpi
              label={difference >= 0 ? "Custo sem vínculo" : "Diferença de classificação"}
              value={formatCurrency(Math.abs(difference))}
              note={reconciled ? "Individualização conciliada com a DRE" : "Requer vínculo ou revisão do plano de contas"}
            />
            <Kpi label="Descontos dos colaboradores" value={formatCurrency(analysis.employeeDeductions)} note="INSS/consignado: não aumenta a DRE" />
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Custo por colaborador — {monthLabel}</CardTitle>
          <CardDescription>{unitLabel}. Abra o nome para consultar todas as rubricas individualizadas.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-6">{Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div>
          ) : analysis.people.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-2 p-8 text-center">
              <Info className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm font-medium">Nenhuma despesa de pessoal individualizada nesta competência.</p>
              <p className="max-w-xl text-xs text-muted-foreground">Os vínculos serão exibidos quando salário, FGTS, INSS, consignados ou outras rubricas forem associados ao colaborador.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1180px] w-full text-sm">
                <thead>
                  <tr className="border-y bg-muted/40">
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Colaborador / unidade</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Salário</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gratificação</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">FGTS</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Outros custos</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Custo DRE</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">INSS descontado</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Consignado</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.people.map((person) => (
                    <tr key={person.employeeId} className="border-b align-top transition-colors hover:bg-muted/20">
                      <td className="px-5 py-3">
                        <details className="group">
                          <summary className="cursor-pointer list-none font-semibold marker:hidden">
                            <span className="inline-flex items-center gap-2">
                              <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
                              {person.employeeName}
                            </span>
                            <span className="mt-1 block pl-4 text-xs font-normal text-muted-foreground">
                              {person.resultCenters.length > 0 ? person.resultCenters.join(" · ") : "Unidade não informada"}
                            </span>
                          </summary>
                          <div className="mt-3 ml-4 min-w-[360px] overflow-hidden rounded-lg border bg-background">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-muted/40 text-muted-foreground">
                                  <th className="px-3 py-2 text-left font-medium">Rubrica</th>
                                  <th className="px-3 py-2 text-left font-medium">Natureza</th>
                                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                                </tr>
                              </thead>
                              <tbody>
                                {person.rubrics.map((rubric) => (
                                  <tr key={`${rubric.accountPlanId}-${rubric.analysisType}`} className="border-t">
                                    <td className="px-3 py-2">
                                      {rubric.accountPlanName}
                                      {rubric.resultCenters.length > 0 ? <span className="block text-[10px] text-muted-foreground">{rubric.resultCenters.join(" · ")}</span> : null}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                      {natureLabel(rubric.analysisType)}
                                      {!rubric.countsInDre ? <span className="block text-[10px]">Não compõe a DRE</span> : null}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono font-semibold">{formatCurrency(rubric.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(person.salary)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(person.bonuses)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(person.fgts)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(person.otherEmployerCosts)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-blue-700">{formatCurrency(person.employerCost)}</td>
                      <td className="px-4 py-3 text-right font-mono text-amber-700">{formatCurrency(person.inssDeduction)}</td>
                      <td className="px-4 py-3 text-right font-mono text-amber-700">{formatCurrency(person.payrollLoans)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/30 font-semibold">
                    <td className="px-5 py-3">Total individualizado</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(analysis.people.reduce((sum, person) => sum + person.salary, 0))}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(analysis.people.reduce((sum, person) => sum + person.bonuses, 0))}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(analysis.people.reduce((sum, person) => sum + person.fgts, 0))}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(analysis.people.reduce((sum, person) => sum + person.otherEmployerCosts, 0))}</td>
                    <td className="px-4 py-3 text-right font-mono text-blue-700">{formatCurrency(analysis.employerCost)}</td>
                    <td className="px-4 py-3 text-right font-mono text-amber-700">{formatCurrency(analysis.people.reduce((sum, person) => sum + person.inssDeduction, 0))}</td>
                    <td className="px-4 py-3 text-right font-mono text-amber-700">{formatCurrency(analysis.people.reduce((sum, person) => sum + person.payrollLoans, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {!loading && !reconciled ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            A linha “Pessoal” da DRE e os vínculos por colaborador diferem em {formatCurrency(Math.abs(difference))}.
            {difference > 0
              ? " Há custo de pessoal sem individualização; ele continua na DRE, mas ainda não aparece em um colaborador."
              : " Há vínculo classificado como custo da empresa que não está conciliando com a linha Pessoal."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
