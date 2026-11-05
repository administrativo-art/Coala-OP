import type { EmployeeDocumentCategoryId } from "@/lib/hr/employee-document-options";

export type EmployeeDossierTemplateId = "clt" | "pj" | "internship";

export type EmployeeDossierFolder = {
  id: string;
  category: EmployeeDocumentCategoryId;
  path: string[];
  employeeVisible: boolean;
};

export type EmployeeDossierTemplate = {
  id: EmployeeDossierTemplateId;
  version: number;
  label: string;
  folders: EmployeeDossierFolder[];
};

const visible = true;

const TEMPLATES: Record<EmployeeDossierTemplateId, EmployeeDossierTemplate> = {
  pj: {
    id: "pj", version: 2, label: "Prestadora PJ",
    folders: [
      { id: "pj-registration-identity", category: "personal", path: ["Cadastro da prestadora", "Identificação e representação"], employeeVisible: visible },
      { id: "pj-registration-company", category: "personal", path: ["Cadastro da prestadora", "Documentos societários e fiscais"], employeeVisible: visible },
      { id: "pj-registration-bank", category: "personal", path: ["Cadastro da prestadora", "Dados bancários"], employeeVisible: visible },
      { id: "pj-contract-main", category: "contracts", path: ["Prestação de serviços PJ", "Contrato principal"], employeeVisible: visible },
      { id: "pj-contract-addenda", category: "contracts", path: ["Prestação de serviços PJ", "Aditivos"], employeeVisible: visible },
      { id: "pj-fiscal-invoices", category: "remuneration", path: ["Fiscal e pagamentos", "Notas fiscais"], employeeVisible: visible },
      { id: "pj-fiscal-payments", category: "remuneration", path: ["Fiscal e pagamentos", "Comprovantes de pagamento"], employeeVisible: visible },
      { id: "pj-compliance-privacy", category: "training", path: ["Compliance", "Confidencialidade e LGPD"], employeeVisible: visible },
      { id: "pj-compliance-certificates", category: "training", path: ["Compliance", "Certidões e licenças"], employeeVisible: visible },
      { id: "pj-termination", category: "termination", path: ["Encerramento contratual", "Distrato e comunicações"], employeeVisible: visible },
      { id: "pj-termination-payments", category: "termination", path: ["Encerramento contratual", "Quitações e comprovantes"], employeeVisible: visible },
    ],
  },
  clt: {
    id: "clt", version: 4, label: "Colaborador CLT",
    folders: [
      { id: "clt-personal", category: "personal", path: [], employeeVisible: visible },
      { id: "clt-admission", category: "admission", path: [], employeeVisible: visible },
      { id: "clt-monthly-closing", category: "work_schedule", path: [], employeeVisible: visible },
      { id: "clt-benefits", category: "benefits", path: [], employeeVisible: visible },
      { id: "clt-health-asos", category: "occupational_health", path: ["ASOs"], employeeVisible: visible },
      { id: "clt-health-exams", category: "occupational_health", path: ["Exames complementares"], employeeVisible: visible },
      { id: "clt-vacations", category: "vacations", path: [], employeeVisible: visible },
      { id: "clt-leaves", category: "leaves", path: [], employeeVisible: visible },
      { id: "clt-uniforms", category: "uniforms", path: [], employeeVisible: visible },
      { id: "clt-training", category: "training", path: [], employeeVisible: visible },
      { id: "clt-discipline", category: "warnings", path: [], employeeVisible: visible },
      { id: "clt-termination", category: "termination", path: [], employeeVisible: visible },
    ],
  },
  internship: {
    id: "internship", version: 1, label: "Estagiário",
    folders: [
      { id: "intern-registration-identity", category: "personal", path: ["Cadastro do estagiário", "Identificação"], employeeVisible: visible },
      { id: "intern-registration-bank", category: "personal", path: ["Cadastro do estagiário", "Dados bancários"], employeeVisible: visible },
      { id: "intern-contract-main", category: "contracts", path: ["Estágio", "Termo de compromisso"], employeeVisible: visible },
      { id: "intern-contract-addenda", category: "contracts", path: ["Estágio", "Aditivos"], employeeVisible: visible },
      { id: "intern-school", category: "contracts", path: ["Estágio", "Instituição de ensino e agente integrador"], employeeVisible: visible },
      { id: "intern-schedule", category: "work_schedule", path: ["Jornada", "Controle de frequência"], employeeVisible: visible },
      { id: "intern-payments", category: "remuneration", path: ["Bolsa e pagamentos", "Comprovantes"], employeeVisible: visible },
      { id: "intern-benefits", category: "benefits", path: ["Bolsa e benefícios", "Auxílios"], employeeVisible: visible },
      { id: "intern-health", category: "occupational_health", path: ["Saúde e segurança", "Documentos aplicáveis"], employeeVisible: visible },
      { id: "intern-reports", category: "training", path: ["Acompanhamento", "Relatórios de estágio"], employeeVisible: visible },
      { id: "intern-evaluations", category: "training", path: ["Acompanhamento", "Avaliações"], employeeVisible: visible },
      { id: "intern-recess", category: "vacations", path: ["Recesso"], employeeVisible: visible },
      { id: "intern-termination", category: "termination", path: ["Encerramento", "Termo e comprovantes"], employeeVisible: visible },
    ],
  },
};

export function employeeDossierTemplateId(relationship: unknown): EmployeeDossierTemplateId | null {
  if (relationship === "pj") return "pj";
  if (relationship === "internship") return "internship";
  if (relationship === "clt" || relationship === "apprenticeship") return "clt";
  return null;
}

export function employeeDossierTemplate(relationship: unknown): EmployeeDossierTemplate | null {
  const id = employeeDossierTemplateId(relationship);
  return id ? structuredClone(TEMPLATES[id]) : null;
}
