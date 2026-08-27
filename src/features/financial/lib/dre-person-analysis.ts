import { expenseAccountAllocationsForResultCenter } from "./expense-account-allocations";
import { expensePersonAllocations, type PersonAllocationAnalysisType } from "./expense-person-allocations";
import { expenseValueForResultCenter, type ResultCenterNameMap } from "./expense-rateio";
import { toDate } from "./utils";

export type DrePersonAccountMeta = {
  name: string;
  drePosition: string | null;
  isDreAccount: boolean;
};

export type DrePersonRubric = {
  accountPlanId: string;
  accountPlanName: string;
  analysisType: PersonAllocationAnalysisType;
  amount: number;
  resultCenters: string[];
  countsInDre: boolean;
};

export type DrePersonRow = {
  employeeId: string;
  employeeName: string;
  resultCenters: string[];
  employerCost: number;
  employeeDeductions: number;
  informational: number;
  salary: number;
  bonuses: number;
  fgts: number;
  otherEmployerCosts: number;
  inssDeduction: number;
  payrollLoans: number;
  otherDeductions: number;
  rubrics: DrePersonRubric[];
};

export type DrePersonAnalysis = {
  people: DrePersonRow[];
  employerCost: number;
  employeeDeductions: number;
  informational: number;
};

type BuildDrePersonAnalysisInput = {
  expenses: any[];
  accounts: Record<string, DrePersonAccountMeta>;
  monthKey: string;
  resultCenter?: string | null;
  resultCenterNames?: ResultCenterNameMap;
};

const EXCLUDED_STATUSES = new Set(["draft", "cancelled", "reconciled"]);
const DIRECT_PAYROLL_DESCRIPTION = /^(sal[aá]rio|rescis[aã]o|f[eé]rias|13\s*[ºoª]?\s*sal[aá]rio)\b/i;

function cents(value: unknown) {
  return Math.round((Number(value) || 0) * 100);
}

function money(valueInCents: number) {
  return valueInCents / 100;
}

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function monthKey(value: unknown) {
  const date = toDate(value);
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function expenseMonth(expense: any) {
  return monthKey(expense.competenceDate) || monthKey(expense.dueDate) || monthKey(expense.paidAt);
}

function resolveResultCenter(value: unknown, names: ResultCenterNameMap) {
  const stored = String(value ?? "").trim();
  return names[stored] || stored;
}

function directEmployee(expense: any) {
  const description = String(expense.description ?? "").trim();
  if (!DIRECT_PAYROLL_DESCRIPTION.test(description)) return null;

  const descriptionName = description.includes("|")
    ? description.split("|").at(-1)?.trim()
    : description.split(/\s+[—–]\s+/).at(-1)?.trim();
  const employeeName = descriptionName || String(expense.supplier ?? "").trim();
  if (!employeeName) return null;

  const stableName = normalized(employeeName).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    employeeId: String(expense.employeeId || expense.supplierId || `payroll:${stableName}`),
    employeeName,
  };
}

function rubricBucket(name: string, analysisType: PersonAllocationAnalysisType) {
  const key = normalized(name);
  if (analysisType === "employer_cost") {
    if (key.includes("fgts")) return "fgts" as const;
    if (key.includes("bonific") || key.includes("gratific") || key.includes("premia")) return "bonuses" as const;
    if (key.includes("salario") || key.includes("folha de pagamento") || key.includes("13º")) return "salary" as const;
    return "otherEmployerCosts" as const;
  }
  if (analysisType === "employee_deduction") {
    if (key.includes("inss")) return "inssDeduction" as const;
    if (key.includes("consign") || key.includes("emprestimo")) return "payrollLoans" as const;
    return "otherDeductions" as const;
  }
  return null;
}

type MutablePerson = {
  employeeId: string;
  employeeName: string;
  resultCenters: Set<string>;
  employerCost: number;
  employeeDeductions: number;
  informational: number;
  salary: number;
  bonuses: number;
  fgts: number;
  otherEmployerCosts: number;
  inssDeduction: number;
  payrollLoans: number;
  otherDeductions: number;
  rubrics: Map<string, DrePersonRubric & { resultCenterSet: Set<string>; amountInCents: number }>;
};

function createMutablePerson(employeeId: string, employeeName: string): MutablePerson {
  return {
    employeeId,
    employeeName,
    resultCenters: new Set(),
    employerCost: 0,
    employeeDeductions: 0,
    informational: 0,
    salary: 0,
    bonuses: 0,
    fgts: 0,
    otherEmployerCosts: 0,
    inssDeduction: 0,
    payrollLoans: 0,
    otherDeductions: 0,
    rubrics: new Map(),
  };
}

export function buildDrePersonAnalysis({
  expenses,
  accounts,
  monthKey: selectedMonth,
  resultCenter = null,
  resultCenterNames = {},
}: BuildDrePersonAnalysisInput): DrePersonAnalysis {
  const people = new Map<string, MutablePerson>();
  const accountNames = Object.fromEntries(Object.entries(accounts).map(([id, account]) => [id, account.name]));

  function addAllocation({
    employeeId,
    employeeName,
    accountPlanId,
    accountPlanName,
    analysisType,
    amount,
    allocationResultCenter,
  }: {
    employeeId: string;
    employeeName: string;
    accountPlanId: string;
    accountPlanName: string;
    analysisType: PersonAllocationAnalysisType;
    amount: number;
    allocationResultCenter?: string | null;
  }) {
    const amountInCents = cents(amount);
    if (amountInCents <= 0) return;

    const account = accounts[accountPlanId];
    const countsInDre = analysisType === "employer_cost"
      && account?.isDreAccount !== false
      && account?.drePosition === "pessoal";
    const key = employeeId || `payroll:${normalized(employeeName)}`;
    const person = people.get(key) || createMutablePerson(key, employeeName);
    if (employeeName) person.employeeName = employeeName;

    const resolvedCenter = resolveResultCenter(allocationResultCenter, resultCenterNames);
    if (resolvedCenter) person.resultCenters.add(resolvedCenter);

    if (countsInDre) person.employerCost += amountInCents;
    else if (analysisType === "employee_deduction") person.employeeDeductions += amountInCents;
    else if (analysisType === "informational") person.informational += amountInCents;

    const bucket = rubricBucket(accountPlanName, analysisType);
    if (bucket && (countsInDre || analysisType === "employee_deduction")) person[bucket] += amountInCents;

    const rubricKey = `${accountPlanId}:${analysisType}:${countsInDre ? "dre" : "off-dre"}`;
    const rubric = person.rubrics.get(rubricKey) || {
      accountPlanId,
      accountPlanName,
      analysisType,
      amount: 0,
      amountInCents: 0,
      resultCenters: [],
      resultCenterSet: new Set<string>(),
      countsInDre,
    };
    rubric.amountInCents += amountInCents;
    if (resolvedCenter) rubric.resultCenterSet.add(resolvedCenter);
    person.rubrics.set(rubricKey, rubric);
    people.set(key, person);
  }

  (expenses || []).forEach((expense) => {
    if (EXCLUDED_STATUSES.has(String(expense.status || ""))) return;
    if (expenseMonth(expense) !== selectedMonth) return;

    const storedPersonAllocations = expensePersonAllocations(expense, accountNames);
    if (storedPersonAllocations.length > 0) {
      storedPersonAllocations.forEach((allocation) => {
        const allocationCenter = resolveResultCenter(allocation.resultCenter, resultCenterNames);
        let amount = allocation.amount;
        if (resultCenter) {
          if (allocationCenter) {
            if (allocationCenter !== resultCenter) return;
          } else {
            amount = expenseValueForResultCenter(
              { ...expense, totalValue: allocation.amount, hasPersonAllocations: false, personAllocations: null },
              resultCenter,
              resultCenterNames,
            );
          }
        }
        addAllocation({
          employeeId: allocation.employeeId,
          employeeName: allocation.employeeName || allocation.employeeId,
          accountPlanId: allocation.accountPlanId,
          accountPlanName: allocation.accountPlanName || accounts[allocation.accountPlanId]?.name || allocation.accountPlanId,
          analysisType: allocation.analysisType,
          amount,
          allocationResultCenter: allocationCenter,
        });
      });
      return;
    }

    const employee = directEmployee(expense);
    if (!employee) return;
    expenseAccountAllocationsForResultCenter(expense, resultCenter, resultCenterNames, accountNames)
      .forEach((allocation) => {
        const account = accounts[allocation.accountPlanId];
        if (account?.isDreAccount === false || account?.drePosition !== "pessoal") return;
        addAllocation({
          ...employee,
          accountPlanId: allocation.accountPlanId,
          accountPlanName: allocation.accountPlanName || account.name || allocation.accountPlanId,
          analysisType: "employer_cost",
          amount: allocation.amount,
          allocationResultCenter: resultCenter || resolveResultCenter(expense.resultCenter, resultCenterNames),
        });
      });
  });

  const rows = Array.from(people.values())
    .map((person): DrePersonRow => ({
      employeeId: person.employeeId,
      employeeName: person.employeeName,
      resultCenters: Array.from(person.resultCenters).sort((a, b) => a.localeCompare(b, "pt-BR")),
      employerCost: money(person.employerCost),
      employeeDeductions: money(person.employeeDeductions),
      informational: money(person.informational),
      salary: money(person.salary),
      bonuses: money(person.bonuses),
      fgts: money(person.fgts),
      otherEmployerCosts: money(person.otherEmployerCosts),
      inssDeduction: money(person.inssDeduction),
      payrollLoans: money(person.payrollLoans),
      otherDeductions: money(person.otherDeductions),
      rubrics: Array.from(person.rubrics.values())
        .map(({ resultCenterSet, amountInCents, ...rubric }) => ({
          ...rubric,
          amount: money(amountInCents),
          resultCenters: Array.from(resultCenterSet).sort((a, b) => a.localeCompare(b, "pt-BR")),
        }))
        .sort((a, b) => a.accountPlanName.localeCompare(b.accountPlanName, "pt-BR")),
    }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR"));

  return {
    people: rows,
    employerCost: money(rows.reduce((sum, person) => sum + cents(person.employerCost), 0)),
    employeeDeductions: money(rows.reduce((sum, person) => sum + cents(person.employeeDeductions), 0)),
    informational: money(rows.reduce((sum, person) => sum + cents(person.informational), 0)),
  };
}
