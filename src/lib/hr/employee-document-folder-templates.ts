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
    id: "clt", version: 2, label: "Colaborador CLT",
    folders: [
      { id: "clt-personal", category: "personal", path: ["Documentos pessoais"], employeeVisible: visible },
      { id: "clt-bank", category: "personal", path: ["Dados bancários"], employeeVisible: visible },
      { id: "clt-dependents", category: "personal", path: ["Dependentes"], employeeVisible: visible },
      { id: "clt-admission-registration", category: "admission", path: ["Cadastro e registro"], employeeVisible: visible },
      { id: "clt-admission-contract", category: "admission", path: ["Contrato", "Contrato principal"], employeeVisible: visible },
      { id: "clt-admission-probation", category: "admission", path: ["Contrato", "Experiência e prorrogações"], employeeVisible: visible },
      { id: "clt-admission-declarations", category: "admission", path: ["Declarações"], employeeVisible: visible },
      { id: "clt-admission-terms", category: "admission", path: ["Termos e consentimentos"], employeeVisible: visible },
      { id: "clt-time-records", category: "work_schedule", path: ["Espelhos de ponto"], employeeVisible: visible },
      { id: "clt-time-adjustments", category: "work_schedule", path: ["Ajustes de ponto"], employeeVisible: visible },
      { id: "clt-time-bank", category: "work_schedule", path: ["Banco de horas"], employeeVisible: visible },
      { id: "clt-payslips", category: "remuneration", path: ["Contracheques"], employeeVisible: visible },
      { id: "clt-payments", category: "remuneration", path: ["Pagamentos e recibos"], employeeVisible: visible },
      { id: "clt-benefits", category: "benefits", path: ["Benefícios"], employeeVisible: visible },
      { id: "clt-health-asos", category: "occupational_health", path: ["ASOs"], employeeVisible: visible },
      { id: "clt-health-exams", category: "occupational_health", path: ["Exames complementares"], employeeVisible: visible },
      { id: "clt-vacations", category: "vacations", path: ["Férias"], employeeVisible: visible },
      { id: "clt-leaves", category: "leaves", path: ["Afastamentos e licenças"], employeeVisible: visible },
      { id: "clt-uniforms", category: "uniforms", path: ["Entregas, trocas e devoluções"], employeeVisible: visible },
      { id: "clt-training", category: "training", path: ["Treinamentos e certificados"], employeeVisible: visible },
      { id: "clt-discipline", category: "warnings", path: ["Ocorrências e medidas disciplinares"], employeeVisible: visible },
      { id: "clt-termination", category: "termination", path: ["Desligamento"], employeeVisible: visible },
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
