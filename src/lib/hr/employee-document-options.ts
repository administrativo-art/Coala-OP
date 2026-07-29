export const EMPLOYEE_DOCUMENT_CATEGORIES = [
  { id: "personal", label: "Identificação" },
  { id: "admission", label: "Admissão" },
  { id: "contracts", label: "Contratos" },
  { id: "work_schedule", label: "Jornada e ponto" },
  { id: "remuneration", label: "Remuneração" },
  { id: "benefits", label: "Benefícios" },
  { id: "occupational_health", label: "Saúde ocupacional" },
  { id: "vacations", label: "Férias" },
  { id: "leaves", label: "Afastamentos" },
  { id: "uniforms", label: "Uniformes e EPIs" },
  { id: "training", label: "Treinamentos" },
  { id: "warnings", label: "Disciplina" },
  { id: "termination", label: "Desligamento" },
  { id: "pending_classification", label: "A classificar" },
] as const;

export type EmployeeDocumentCategoryId = (typeof EMPLOYEE_DOCUMENT_CATEGORIES)[number]["id"];

// `contracts` permanece aceito para documentos legados, mas a navegação e os
// novos arquivamentos o consolidam em Admissão > Contrato.
export const EMPLOYEE_DOCUMENT_VISIBLE_CATEGORIES = EMPLOYEE_DOCUMENT_CATEGORIES.filter(
  (category) => category.id !== "contracts",
);

export function normalizeEmployeeDocumentCategory(category: EmployeeDocumentCategoryId): EmployeeDocumentCategoryId {
  return category === "contracts" ? "admission" : category;
}

// Taxonomia fixa por natureza. Processos como competência, férias e afastamentos
// são acrescentados pelo backend a partir dos metadados extraídos do documento.
export type EmployeeDocumentSubfolder = {
  id: string;
  label: string;
  typeCodes: readonly string[];
  typeLabels?: readonly string[];
};

export const EMPLOYEE_DOCUMENT_SUBFOLDERS: Partial<Record<EmployeeDocumentCategoryId, readonly EmployeeDocumentSubfolder[]>> = {
  personal: [
    { id: "personal_docs", label: "Documentos pessoais", typeCodes: ["PERSONAL_ID", "PROFILE_PHOTO", "ADDRESS_PROOF", "CIVIL_CERTIFICATE", "WORK_CARD", "PIS_PASEP"], typeLabels: ["CPF", "CNH", "Título de eleitor", "Carteira de trabalho", "PIS/PASEP", "Outro documento pessoal"] },
    { id: "bank_data", label: "Dados bancários", typeCodes: ["BANK_ACCOUNT_PROOF"] },
    { id: "dependents", label: "Dependentes", typeCodes: ["DEPENDENT_DOCUMENT"] },
  ],
  admission: [
    { id: "registration", label: "Cadastro e registro", typeCodes: ["EMPLOYEE_REGISTRATION"], typeLabels: ["Ficha cadastral", "Ficha de registro"] },
    { id: "contract", label: "Contrato", typeCodes: ["EMPLOYMENT_CONTRACT", "PROBATION_CONTRACT", "PROBATION_EXTENSION"], typeLabels: ["Contrato de trabalho", "Contrato de experiência", "Prorrogação de contrato", "Aditivo contratual", "Termo de confidencialidade", "Outro contrato"] },
    { id: "declarations", label: "Declarações", typeCodes: [], typeLabels: ["Declaração de dependentes"] },
    { id: "terms", label: "Termos e consentimentos", typeCodes: [], typeLabels: ["Termo de ciência/LGPD", "Outro documento de admissão"] },
  ],
  contracts: [
    { id: "contract", label: "Contrato", typeCodes: ["EMPLOYMENT_CONTRACT"] },
    { id: "probation", label: "Experiência e prorrogações", typeCodes: ["PROBATION_CONTRACT", "PROBATION_EXTENSION"] },
    { id: "contract_terms", label: "Aditivos e termos", typeCodes: [], typeLabels: ["Aditivo contratual", "Termo de confidencialidade", "Outro contrato"] },
  ],
  work_schedule: [
    { id: "time_records", label: "Espelhos de ponto", typeCodes: [], typeLabels: ["Espelho de ponto", "Escala de trabalho", "Horas extras"] },
    { id: "time_adjustments", label: "Ajustes de ponto", typeCodes: [], typeLabels: ["Ajuste de ponto"] },
    { id: "time_bank", label: "Banco de horas", typeCodes: [], typeLabels: ["Banco de horas"] },
    { id: "other_schedule", label: "Outros documentos de jornada", typeCodes: [], typeLabels: ["Outro documento de jornada"] },
  ],
  remuneration: [
    { id: "payslips", label: "Contracheques", typeCodes: ["PAYSLIP"], typeLabels: ["Comissão/bonificação"] },
    { id: "payments", label: "Pagamentos e recibos", typeCodes: [], typeLabels: ["Comprovante de pagamento", "Recibo", "Adiantamento", "Informe de rendimentos"] },
    { id: "other_remuneration", label: "Outros documentos de remuneração", typeCodes: [], typeLabels: ["Outro documento de remuneração"] },
  ],
  benefits: [
    { id: "transport", label: "Vale-transporte", typeCodes: ["TRANSPORT_REQUEST"], typeLabels: ["Termo de opção de vale-transporte", "Declaração de trajeto", "Recibo de cartão", "Suspensão/cancelamento de vale-transporte"] },
    { id: "food", label: "Alimentação", typeCodes: [] },
    { id: "health_plan", label: "Saúde e odontológico", typeCodes: [], typeLabels: ["Plano de saúde"] },
    { id: "life_insurance", label: "Seguro de vida", typeCodes: [], typeLabels: ["Seguro de vida"] },
    { id: "family_salary", label: "Salário-família", typeCodes: ["FAMILY_SALARY_TERM", "VACCINATION_RECORD", "SCHOOL_ATTENDANCE"], typeLabels: ["Salário-família"] },
    { id: "other_benefits", label: "Outros benefícios", typeCodes: [], typeLabels: ["Termo de benefícios", "Declaração de benefício", "Outro documento de benefício"] },
  ],
  occupational_health: [
    { id: "asos", label: "ASOs", typeCodes: ["ASO_ADMISSION", "ASO_PERIODIC", "ASO_RETURN", "ASO_RISK_CHANGE", "ASO_DISMISSAL"] },
    { id: "complementary_exams", label: "Exames complementares", typeCodes: [], typeLabels: ["Exames complementares"] },
    { id: "other_occupational", label: "Outros documentos ocupacionais", typeCodes: [], typeLabels: ["Outro documento ocupacional"] },
  ],
  vacations: [
    { id: "vacation_notice", label: "Avisos", typeCodes: ["VACATION_NOTICE"], typeLabels: ["Solicitação de férias"] },
    { id: "vacation_receipt_payment", label: "Recibos e pagamentos", typeCodes: ["VACATION_RECEIPT", "VACATION_PAYMENT"] },
    { id: "vacation_changes", label: "Alterações", typeCodes: [], typeLabels: ["Abono pecuniário", "Alteração/cancelamento de férias", "Outro documento de férias"] },
  ],
  leaves: [
    { id: "medical", label: "Atestados", typeCodes: ["MEDICAL_CERTIFICATE"] },
    { id: "attendance", label: "Declarações", typeCodes: [], typeLabels: ["Declaração de comparecimento"] },
    { id: "licenses", label: "Licenças", typeCodes: [], typeLabels: ["Licença maternidade", "Licença paternidade"] },
    { id: "social_security", label: "Previdenciário", typeCodes: [], typeLabels: ["Afastamento previdenciário"] },
    { id: "return_to_work", label: "Retorno ao trabalho", typeCodes: [], typeLabels: ["Documento de retorno ao trabalho", "Outro documento de afastamento"] },
  ],
  uniforms: [
    { id: "deliveries", label: "Entregas", typeCodes: ["UNIFORM_DELIVERY"], typeLabels: ["Termo de entrega de equipamento"] },
    { id: "exchanges", label: "Trocas", typeCodes: ["UNIFORM_EXCHANGE"], typeLabels: ["Controle de troca"] },
    { id: "returns", label: "Devoluções", typeCodes: ["UNIFORM_RETURN"], typeLabels: ["Termo de devolução de uniforme", "Termo de devolução de equipamento"] },
    { id: "responsibility_terms", label: "Termos de responsabilidade", typeCodes: [], typeLabels: ["Termo de responsabilidade"] },
    { id: "damage", label: "Danos e ocorrências", typeCodes: [], typeLabels: ["Registro de dano ou avaria", "Outro documento de uniforme"] },
  ],
  training: [
    { id: "training_certificates", label: "Treinamentos e certificados", typeCodes: [], typeLabels: ["Certificado de treinamento"] },
    { id: "reviews_feedback", label: "Avaliações e feedbacks", typeCodes: [], typeLabels: ["Avaliação", "Feedback formal"] },
    { id: "communications", label: "Comunicados e políticas", typeCodes: [], typeLabels: ["Comunicado", "Ciência de política", "Registro de reunião"] },
    { id: "development", label: "Desenvolvimento", typeCodes: [], typeLabels: ["Plano de desenvolvimento", "Outro documento de treinamento"] },
  ],
  warnings: [
    { id: "warnings", label: "Advertências", typeCodes: ["DISCIPLINARY_WARNING"] },
    { id: "suspensions", label: "Suspensões", typeCodes: [], typeLabels: ["Suspensão disciplinar"] },
    { id: "employee_statement", label: "Manifestação do colaborador", typeCodes: [], typeLabels: ["Manifestação do colaborador"] },
    { id: "investigation", label: "Apuração e relatórios", typeCodes: [], typeLabels: ["Relatório de ocorrência", "Apuração interna", "Outro documento disciplinar"] },
  ],
  termination: [
    { id: "request_notice", label: "Pedido ou aviso", typeCodes: ["RESIGNATION_REQUEST", "TERMINATION_NOTICE"] },
    { id: "termination_terms", label: "Rescisão", typeCodes: ["TERMINATION_TERM"] },
    { id: "termination_payments", label: "Pagamentos", typeCodes: ["TERMINATION_PAYMENT"], typeLabels: ["Quitação/recibo"] },
    { id: "fgts_unemployment", label: "FGTS e seguro-desemprego", typeCodes: [], typeLabels: ["GRRF/FGTS", "Seguro-desemprego"] },
    { id: "dismissal_aso", label: "ASO demissional", typeCodes: ["ASO_DISMISSAL"] },
    { id: "asset_return", label: "Devolução de bens", typeCodes: [], typeLabels: ["Termo de devolução de bens", "Outro documento de desligamento"] },
  ],
};

export function getEmployeeDocumentSubfolders(category: EmployeeDocumentCategoryId): readonly EmployeeDocumentSubfolder[] {
  return EMPLOYEE_DOCUMENT_SUBFOLDERS[category] ?? [];
}

const FALLBACK_SUBFOLDER: Partial<Record<EmployeeDocumentCategoryId, string>> = {
  personal: "personal_docs",
  admission: "terms",
  contracts: "contract_terms",
  work_schedule: "other_schedule",
  remuneration: "other_remuneration",
  benefits: "other_benefits",
  occupational_health: "other_occupational",
  vacations: "vacation_changes",
  leaves: "return_to_work",
  uniforms: "damage",
  training: "development",
  warnings: "investigation",
  termination: "asset_return",
};

export function resolveEmployeeDocumentSubfolder(
  category: EmployeeDocumentCategoryId,
  documentTypeCode?: string | null,
  documentTypeLabel?: string | null,
): string | null {
  const subs = EMPLOYEE_DOCUMENT_SUBFOLDERS[category];
  if (!subs || subs.length === 0) return null;
  if (documentTypeCode) {
    const match = subs.find((sub) => sub.typeCodes.includes(documentTypeCode));
    if (match) return match.id;
  }
  if (documentTypeLabel) {
    const normalized = documentTypeLabel.trim().toLocaleLowerCase("pt-BR");
    const match = subs.find((sub) => sub.typeLabels?.some((label) => label.toLocaleLowerCase("pt-BR") === normalized));
    if (match) return match.id;
  }
  return FALLBACK_SUBFOLDER[category] ?? subs[0]?.id ?? null;
}

const PROCESS_POSITION: Partial<Record<EmployeeDocumentCategoryId, "before" | "after" | "ignore">> = {
  admission: "ignore",
  contracts: "before",
  work_schedule: "after",
  remuneration: "before",
  occupational_health: "after",
  vacations: "before",
  leaves: "before",
  warnings: "before",
  termination: "before",
};

export function employeeDocumentProcessPosition(category: EmployeeDocumentCategoryId): "before" | "after" | "ignore" {
  return PROCESS_POSITION[category] ?? "ignore";
}

function reliableProcessSegments(destinationTrail?: readonly string[] | null): string[] {
  if (!destinationTrail || destinationTrail.length < 3) return [];
  return destinationTrail.slice(1, -1).filter((segment) => {
    const normalized = segment.trim().toLocaleLowerCase("pt-BR");
    return normalized.length > 0
      && !normalized.startsWith("sem ")
      && normalized !== "afastamento"
      && normalized !== "admissão"
      && normalized !== "exame";
  });
}

/** Caminho exibido dentro de uma categoria: processo confiável + natureza fixa. */
export function resolveEmployeeDocumentFolderPath(input: {
  category: EmployeeDocumentCategoryId;
  documentTypeCode?: string | null;
  documentTypeLabel?: string | null;
  destinationTrail?: readonly string[] | null;
}): string[] {
  if (input.category === "pending_classification") return [];
  const definitions = getEmployeeDocumentSubfolders(input.category);
  const subfolderId = resolveEmployeeDocumentSubfolder(input.category, input.documentTypeCode, input.documentTypeLabel);
  const fixedLabel = definitions.find((definition) => definition.id === subfolderId)?.label;
  const process = reliableProcessSegments(input.destinationTrail);
  const position = PROCESS_POSITION[input.category] ?? "ignore";
  if (position === "before") return [...process, ...(fixedLabel ? [fixedLabel] : [])];
  if (position === "after") return [...(fixedLabel ? [fixedLabel] : []), ...process];
  return fixedLabel ? [fixedLabel] : [];
}
export type EmployeeDocumentAccessLevelId = (typeof EMPLOYEE_DOCUMENT_ACCESS_LEVELS)[number]["id"];

export const EMPLOYEE_DOCUMENT_TYPES_BY_CATEGORY: Record<EmployeeDocumentCategoryId, readonly string[]> = {
  personal: [
    "Documento de identificação",
    "CPF",
    "CNH",
    "Comprovante de residência",
    "Título de eleitor",
    "Certidão de nascimento/casamento",
    "Dados bancários",
    "Documento de dependente",
    "Foto 3x4",
    "Carteira de trabalho",
    "PIS/PASEP",
    "Outro documento pessoal",
  ],
  admission: [
    "Ficha cadastral",
    "Ficha de registro",
    "Contrato de experiência",
    "Contrato de trabalho",
    "Prorrogação de contrato",
    "Aditivo contratual",
    "Termo de confidencialidade",
    "Declaração de dependentes",
    "Termo de ciência/LGPD",
    "Outro documento de admissão",
  ],
  contracts: [
    "Contrato de experiência",
    "Contrato de trabalho",
    "Prorrogação de contrato",
    "Aditivo contratual",
    "Termo de confidencialidade",
    "Outro contrato",
  ],
  work_schedule: [
    "Espelho de ponto",
    "Ajuste de ponto",
    "Banco de horas",
    "Outro documento de jornada",
  ],
  remuneration: [
    "Contracheque",
    "Comprovante de pagamento",
    "Recibo",
    "Adiantamento",
    "Informe de rendimentos",
    "Outro documento de remuneração",
  ],
  occupational_health: [
    "ASO admissional",
    "ASO periódico",
    "ASO de retorno ao trabalho",
    "ASO de mudança de risco/função",
    "ASO demissional",
    "Exames complementares",
    "Outro documento ocupacional",
  ],
  benefits: [
    "Solicitação de vale-transporte",
    "Termo de opção de vale-transporte",
    "Declaração de trajeto",
    "Recibo de cartão",
    "Suspensão/cancelamento de vale-transporte",
    "Termo de benefícios",
    "Plano de saúde",
    "Seguro de vida",
    "Salário-família",
    "Declaração de benefício",
    "Outro documento de benefício",
  ],
  uniforms: [
    "Termo de entrega de uniforme",
    "Termo de devolução de uniforme",
    "Termo de entrega de equipamento",
    "Termo de devolução de equipamento",
    "Controle de troca",
    "Termo de responsabilidade",
    "Registro de dano ou avaria",
    "Outro documento de uniforme",
  ],
  vacations: [
    "Aviso de férias",
    "Recibo de férias",
    "Solicitação de férias",
    "Abono pecuniário",
    "Alteração/cancelamento de férias",
    "Comprovante de pagamento de férias",
    "Outro documento de férias",
  ],
  leaves: [
    "Atestado médico",
    "Declaração de comparecimento",
    "Licença maternidade",
    "Licença paternidade",
    "Afastamento previdenciário",
    "Documento de retorno ao trabalho",
    "Outro documento de afastamento",
  ],
  warnings: [
    "Advertência",
    "Suspensão disciplinar",
    "Manifestação do colaborador",
    "Relatório de ocorrência",
    "Apuração interna",
    "Outro documento disciplinar",
  ],
  training: [
    "Certificado de treinamento",
    "Avaliação",
    "Feedback formal",
    "Comunicado",
    "Ciência de política",
    "Registro de reunião",
    "Plano de desenvolvimento",
    "Outro documento de treinamento",
  ],
  termination: [
    "Pedido de demissão",
    "Aviso prévio",
    "Termo de rescisão",
    "GRRF/FGTS",
    "Seguro-desemprego",
    "ASO demissional",
    "Termo de devolução de bens",
    "Quitação/recibo",
    "Comprovante de pagamento rescisório",
    "Outro documento de desligamento",
  ],
  pending_classification: [
    "Documento não identificado",
    "Declaração",
    "Comprovante",
    "Documento complementar",
    "Outro documento",
  ],
};

export const EMPLOYEE_DOCUMENT_STATUSES = [
  { id: "pending", label: "Pendente" },
  { id: "received", label: "Recebido" },
  { id: "validated", label: "Validado" },
  { id: "rejected", label: "Recusado" },
] as const;

export const EMPLOYEE_DOCUMENT_ACCESS_LEVELS = [
  { id: "unrestricted", label: "Sem restrição" },
  { id: "partial", label: "Restrito parcial" },
  { id: "restricted", label: "Restrito total" },
  { id: "confidential", label: "Confidencial" },
] as const;

export type EmployeeDocumentTypeConfig = {
  code: string;
  label: string;
  category: EmployeeDocumentCategoryId;
  folderCode: string;
  defaultAccessLevel: EmployeeDocumentAccessLevelId;
  aliases: string[];
  classificationHints: string[];
};

export const EMPLOYEE_DOCUMENT_TYPE_CATALOG = [
  {
    code: "UNKNOWN_DOCUMENT",
    label: "Documento não identificado",
    category: "pending_classification",
    folderCode: "PENDING_CLASSIFICATION",
    defaultAccessLevel: "restricted",
    aliases: ["desconhecido", "não identificado"],
    classificationHints: ["Use quando nenhum tipo cadastrado for adequado."],
  },
  {
    code: "PERSONAL_ID",
    label: "Documento de identificação",
    category: "personal",
    folderCode: "REGISTRATION_IDENTIFICATION",
    defaultAccessLevel: "restricted",
    aliases: ["rg", "cin", "identidade", "cnh"],
    classificationHints: ["Documento oficial com foto ou identificação civil."],
  },
  {
    code: "PROFILE_PHOTO",
    label: "Foto 3x4",
    category: "personal",
    folderCode: "REGISTRATION_IDENTIFICATION",
    defaultAccessLevel: "restricted",
    aliases: ["foto para identificação", "foto de identificação", "foto 3x4", "retrato"],
    classificationHints: ["Foto atual do colaborador usada para identificação visual no cadastro."],
  },
  {
    code: "ADDRESS_PROOF",
    label: "Comprovante de residência",
    category: "personal",
    folderCode: "REGISTRATION_IDENTIFICATION",
    defaultAccessLevel: "restricted",
    aliases: ["conta de luz", "conta de água", "residência", "endereço"],
    classificationHints: ["Comprova endereço do colaborador."],
  },
  {
    code: "CIVIL_CERTIFICATE",
    label: "Certidão de nascimento/casamento",
    category: "personal",
    folderCode: "REGISTRATION_IDENTIFICATION",
    defaultAccessLevel: "restricted",
    aliases: ["certidão de nascimento", "certidao de nascimento", "certidão de casamento", "certidao de casamento"],
    classificationHints: ["Certidão civil usada na admissão para comprovar nascimento, casamento, nome e filiação."],
  },
  {
    code: "EMPLOYEE_REGISTRATION",
    label: "Ficha de registro",
    category: "admission",
    folderCode: "ADMISSION_REGISTRATION",
    defaultAccessLevel: "restricted",
    aliases: ["registro de empregado", "ficha funcional"],
    classificationHints: ["Ficha formal de registro/admissão do empregado."],
  },
  {
    code: "WORK_CARD",
    label: "Carteira de trabalho",
    category: "personal",
    folderCode: "REGISTRATION_IDENTIFICATION",
    defaultAccessLevel: "restricted",
    aliases: ["ctps", "carteira de trabalho", "carteira de trabalho digital"],
    classificationHints: ["Comprovante da CTPS digital ou páginas da carteira física com foto, dados pessoais, número, série ou CPF."],
  },
  {
    code: "PIS_PASEP",
    label: "PIS/PASEP",
    category: "personal",
    folderCode: "REGISTRATION_IDENTIFICATION",
    defaultAccessLevel: "restricted",
    aliases: ["pis", "pasep", "nis", "nit", "número do pis", "numero do pis"],
    classificationHints: ["Comprovante oficial que informa PIS, PASEP, NIS ou NIT do trabalhador."],
  },
  {
    code: "EMPLOYMENT_CONTRACT",
    label: "Contrato de trabalho",
    category: "admission",
    folderCode: "ADMISSION_REGISTRATION",
    defaultAccessLevel: "restricted",
    aliases: ["contrato inicial", "contrato empregado"],
    classificationHints: ["Contrato laboral sem foco exclusivo em experiência."],
  },
  {
    code: "PROBATION_CONTRACT",
    label: "Contrato de experiência",
    category: "admission",
    folderCode: "ADMISSION_REGISTRATION",
    defaultAccessLevel: "restricted",
    aliases: ["experiência", "contrato experimental"],
    classificationHints: ["Contrato com prazo de experiência."],
  },
  {
    code: "PROBATION_EXTENSION",
    label: "Prorrogação de contrato",
    category: "admission",
    folderCode: "ADMISSION_REGISTRATION",
    defaultAccessLevel: "restricted",
    aliases: ["prorrogação experiência", "aditivo de experiência"],
    classificationHints: ["Prorroga contrato de experiência."],
  },
  {
    code: "PAYSLIP",
    label: "Contracheque",
    category: "remuneration",
    folderCode: "REMUNERATION",
    defaultAccessLevel: "confidential",
    aliases: ["holerite", "demonstrativo de pagamento", "folha de pagamento"],
    classificationHints: ["Demonstra proventos, descontos, líquido e competência."],
  },
  {
    code: "TRANSPORT_REQUEST",
    label: "Solicitação de vale-transporte",
    category: "benefits",
    folderCode: "BENEFITS",
    defaultAccessLevel: "partial",
    aliases: ["vale transporte", "opção de vale-transporte", "declaração de trajeto"],
    classificationHints: ["Solicitação, opção ou declaração relacionada ao vale-transporte."],
  },
  {
    code: "DEPENDENT_DOCUMENT",
    label: "Documento de dependente",
    category: "personal",
    folderCode: "REGISTRATION_IDENTIFICATION",
    defaultAccessLevel: "restricted",
    aliases: ["certidão de nascimento", "nascimento do filho", "documento do dependente", "cpf do dependente"],
    classificationHints: ["Documento que comprova filho ou dependente equiparado para cadastro e salário-família."],
  },
  {
    code: "FAMILY_SALARY_TERM",
    label: "Termo de responsabilidade salário-família",
    category: "benefits",
    folderCode: "BENEFITS",
    defaultAccessLevel: "restricted",
    aliases: ["termo de responsabilidade", "salário família", "salario familia"],
    classificationHints: ["Termo, declaração ou requerimento usado para salário-família."],
  },
  {
    code: "VACCINATION_RECORD",
    label: "Caderneta de vacinação",
    category: "benefits",
    folderCode: "BENEFITS",
    defaultAccessLevel: "restricted",
    aliases: ["vacinação", "caderneta de vacina", "cartão de vacina", "cartao de vacina"],
    classificationHints: ["Comprovação de vacinação de dependente para salário-família."],
  },
  {
    code: "SCHOOL_ATTENDANCE",
    label: "Comprovante de frequência escolar",
    category: "benefits",
    folderCode: "BENEFITS",
    defaultAccessLevel: "restricted",
    aliases: ["frequência escolar", "frequencia escolar", "declaração escolar", "comprovante escolar"],
    classificationHints: ["Comprovação de frequência escolar de dependente para salário-família."],
  },
  {
    code: "ASO_ADMISSION",
    label: "ASO admissional",
    category: "occupational_health",
    folderCode: "OCCUPATIONAL_HEALTH_SAFETY",
    defaultAccessLevel: "confidential",
    aliases: ["atestado de saúde ocupacional admissional"],
    classificationHints: ["ASO com tipo de exame admissional."],
  },
  {
    code: "ASO_PERIODIC",
    label: "ASO periódico",
    category: "occupational_health",
    folderCode: "OCCUPATIONAL_HEALTH_SAFETY",
    defaultAccessLevel: "confidential",
    aliases: ["atestado de saúde ocupacional periódico"],
    classificationHints: ["ASO com tipo de exame periódico."],
  },
  {
    code: "ASO_RETURN",
    label: "ASO de retorno ao trabalho",
    category: "occupational_health",
    folderCode: "OCCUPATIONAL_HEALTH_SAFETY",
    defaultAccessLevel: "confidential",
    aliases: ["atestado de saúde ocupacional retorno", "aso retorno", "retorno ao trabalho"],
    classificationHints: ["ASO emitido antes do retorno ao trabalho após afastamento."],
  },
  {
    code: "ASO_RISK_CHANGE",
    label: "ASO de mudança de risco/função",
    category: "occupational_health",
    folderCode: "OCCUPATIONAL_HEALTH_SAFETY",
    defaultAccessLevel: "confidential",
    aliases: ["aso mudança de risco", "aso mudanca de risco", "mudança de função", "mudanca de função"],
    classificationHints: ["ASO emitido por mudança de risco ocupacional ou função."],
  },
  {
    code: "ASO_DISMISSAL",
    label: "ASO demissional",
    category: "occupational_health",
    folderCode: "OCCUPATIONAL_HEALTH_SAFETY",
    defaultAccessLevel: "confidential",
    aliases: ["atestado de saúde ocupacional demissional", "aso demissional"],
    classificationHints: ["ASO emitido no desligamento do colaborador."],
  },
  {
    code: "VACATION_NOTICE",
    label: "Aviso de férias",
    category: "vacations",
    folderCode: "VACATIONS",
    defaultAccessLevel: "restricted",
    aliases: ["comunicado de férias", "notificação de férias"],
    classificationHints: ["Comunica concessão, datas de gozo e período aquisitivo; não é recibo de valores."],
  },
  {
    code: "VACATION_RECEIPT",
    label: "Recibo de férias",
    category: "vacations",
    folderCode: "VACATIONS",
    defaultAccessLevel: "restricted",
    aliases: ["recibo férias", "demonstrativo férias"],
    classificationHints: ["Contém verbas, quitação ou recebimento de férias."],
  },
  {
    code: "VACATION_PAYMENT",
    label: "Comprovante de pagamento de férias",
    category: "vacations",
    folderCode: "VACATIONS",
    defaultAccessLevel: "confidential",
    aliases: ["pagamento de férias", "comprovante bancário férias"],
    classificationHints: ["Comprova transferência ou pagamento de férias."],
  },
  {
    code: "MEDICAL_CERTIFICATE",
    label: "Atestado médico",
    category: "leaves",
    folderCode: "LEAVES_LICENSES",
    defaultAccessLevel: "confidential",
    aliases: ["atestado", "declaração médica"],
    classificationHints: ["Afastamento ou comparecimento médico. Não extrair diagnóstico sem necessidade."],
  },
  {
    code: "UNIFORM_DELIVERY",
    label: "Termo de entrega de uniforme",
    category: "uniforms",
    folderCode: "UNIFORMS_EQUIPMENT_RESPONSIBILITIES",
    defaultAccessLevel: "partial",
    aliases: ["entrega de uniforme", "recibo de uniforme"],
    classificationHints: ["Entrega de uniforme, EPI ou item de responsabilidade."],
  },
  {
    code: "UNIFORM_EXCHANGE",
    label: "Termo de troca de uniforme",
    category: "uniforms",
    folderCode: "UNIFORMS_EQUIPMENT_RESPONSIBILITIES",
    defaultAccessLevel: "partial",
    aliases: ["troca de uniforme", "controle de troca"],
    classificationHints: ["Devolução de uma peça e entrega de outra na mesma movimentação."],
  },
  {
    code: "UNIFORM_RETURN",
    label: "Termo de devolução de uniforme",
    category: "uniforms",
    folderCode: "UNIFORMS_EQUIPMENT_RESPONSIBILITIES",
    defaultAccessLevel: "partial",
    aliases: ["devolução de uniforme", "retorno de uniforme"],
    classificationHints: ["Devolução de uniforme, EPI ou item de responsabilidade."],
  },
  {
    code: "DISCIPLINARY_WARNING",
    label: "Advertência",
    category: "warnings",
    folderCode: "DISCIPLINARY_MEASURES",
    defaultAccessLevel: "confidential",
    aliases: ["advertência disciplinar", "comunicação disciplinar"],
    classificationHints: ["Medida disciplinar por conduta ou descumprimento."],
  },
  {
    code: "RESIGNATION_REQUEST",
    label: "Pedido de demissão",
    category: "termination",
    folderCode: "TERMINATION",
    defaultAccessLevel: "confidential",
    aliases: ["carta de demissão", "solicitação de desligamento"],
    classificationHints: ["Pedido espontâneo do colaborador para encerrar vínculo."],
  },
  {
    code: "TERMINATION_NOTICE",
    label: "Aviso prévio",
    category: "termination",
    folderCode: "TERMINATION",
    defaultAccessLevel: "confidential",
    aliases: ["aviso-prévio", "comunicação de aviso"],
    classificationHints: ["Documento de aviso-prévio trabalhado ou indenizado."],
  },
  {
    code: "TERMINATION_TERM",
    label: "Termo de rescisão",
    category: "termination",
    folderCode: "TERMINATION",
    defaultAccessLevel: "confidential",
    aliases: ["trct", "rescisão contratual", "termo de rescisão do contrato de trabalho"],
    classificationHints: ["TRCT ou termo formal de rescisão."],
  },
  {
    code: "TERMINATION_PAYMENT",
    label: "Comprovante de pagamento rescisório",
    category: "termination",
    folderCode: "TERMINATION",
    defaultAccessLevel: "confidential",
    aliases: ["pagamento rescisório", "comprovante rescisão"],
    classificationHints: ["Comprova pagamento ligado à rescisão."],
  },
] as const satisfies readonly EmployeeDocumentTypeConfig[];

export function employeeDocumentTypeConfigByCode(code: string | null | undefined) {
  return EMPLOYEE_DOCUMENT_TYPE_CATALOG.find((item) => item.code === code) ?? EMPLOYEE_DOCUMENT_TYPE_CATALOG[0];
}

export function employeeDocumentTypeConfigByLabel(label: string | null | undefined) {
  return EMPLOYEE_DOCUMENT_TYPE_CATALOG.find((item) => item.label === label);
}

export function isEmployeeDocumentCategory(value: string): value is EmployeeDocumentCategoryId {
  return EMPLOYEE_DOCUMENT_CATEGORIES.some((category) => category.id === value);
}

export function isEmployeeDocumentType(category: EmployeeDocumentCategoryId, value: string) {
  return EMPLOYEE_DOCUMENT_TYPES_BY_CATEGORY[category].includes(value);
}
