export type EmployeeDocumentExtractionGuide = {
  documentTypes: string[];
  fields: Array<{
    field: string;
    meaning: string;
    where: string;
    rule?: string;
  }>;
};

/**
 * Compact, auditable routing guide sent to the document copilot.
 * It tells the model where evidence normally appears without allowing it to
 * infer a value that is not printed in the document.
 */
export const EMPLOYEE_DOCUMENT_EXTRACTION_GUIDE: EmployeeDocumentExtractionGuide[] = [
  {
    documentTypes: ["RG", "CIN", "BIRTH_CERTIFICATE", "MARRIAGE_CERTIFICATE"],
    fields: [
      { field: "employeeName", meaning: "nome completo do colaborador", where: "campo Nome/Nome completo ou identificação do titular" },
      { field: "cpf", meaning: "CPF do titular", where: "campo CPF" },
      { field: "birthDate", meaning: "data de nascimento", where: "campo Data de nascimento/Nascimento" },
      { field: "motherName", meaning: "nome da mãe", where: "seção Filiação, linha identificada como mãe" },
      { field: "fatherName", meaning: "nome do pai", where: "seção Filiação, linha identificada como pai" },
      { field: "maritalStatus", meaning: "estado civil", where: "certidão ou campo Estado civil", rule: "não deduzir pelo sobrenome" },
    ],
  },
  {
    documentTypes: ["CTPS"],
    fields: [
      { field: "employeeName", meaning: "nome do trabalhador", where: "identificação do trabalhador" },
      { field: "cpf", meaning: "CPF usado pela CTPS Digital", where: "dados pessoais/identificação" },
      { field: "ctpsNumber", meaning: "número da CTPS física", where: "campo Número" },
      { field: "ctpsSeries", meaning: "série da CTPS física", where: "campo Série" },
      { field: "ctpsIssueDate", meaning: "data de emissão", where: "campo Data de emissão" },
    ],
  },
  {
    documentTypes: ["PIS_PASEP"],
    fields: [
      { field: "pisPasep", meaning: "PIS/PASEP/NIS/NIT", where: "campo identificado por PIS, PASEP, NIS ou NIT" },
      { field: "employeeName", meaning: "nome do titular", where: "cabeçalho ou identificação do beneficiário" },
    ],
  },
  {
    documentTypes: ["CNH"],
    fields: [
      { field: "employeeName", meaning: "nome do condutor", where: "campo Nome" },
      { field: "cpf", meaning: "CPF do condutor", where: "campo CPF" },
      { field: "cnhNumber", meaning: "número de registro", where: "campo Nº Registro/Registro" },
      { field: "cnhCategory", meaning: "categoria", where: "campo Cat. Hab./Categoria" },
      { field: "cnhExpiryDate", meaning: "validade", where: "campo Validade" },
      { field: "cnhFirstLicenseDate", meaning: "primeira habilitação", where: "campo 1ª Habilitação" },
    ],
  },
  {
    documentTypes: ["EMPLOYMENT_CONTRACT", "PROBATION_CONTRACT", "PROBATION_EXTENSION"],
    fields: [
      { field: "employeeName", meaning: "nome do empregado", where: "qualificação das partes e assinatura" },
      { field: "employer", meaning: "razão social do empregador", where: "qualificação da empregadora" },
      { field: "cnpj", meaning: "CNPJ do empregador", where: "qualificação da empregadora" },
      { field: "position", meaning: "cargo/função", where: "cláusula de admissão/função" },
      { field: "admissionDate", meaning: "data de admissão/início", where: "cláusula de prazo, expressão 'com início em'" },
      { field: "probationFirstEndDate", meaning: "fim do primeiro período de experiência", where: "cláusula de prazo, expressão 'término em'" },
      { field: "probationFinalEndDate", meaning: "fim após a prorrogação", where: "mesma cláusula, expressão 'finaliza em' ou término da prorrogação" },
      { field: "probationInitialDays", meaning: "dias do primeiro período", where: "cláusula de prazo" },
      { field: "probationExtensionDays", meaning: "dias da prorrogação", where: "cláusula de prorrogação", rule: "se disser apenas 'igual prazo', repetir probationInitialDays" },
      { field: "signatureDetected", meaning: "presença de assinatura", where: "bloco de assinaturas e/ou relatório de assinatura eletrônica" },
    ],
  },
  {
    documentTypes: ["ASO_ADMISSION", "ASO_PERIODIC", "ASO_RETURN", "ASO_RISK_CHANGE", "ASO_DISMISSAL"],
    fields: [
      { field: "employeeName", meaning: "nome do trabalhador", where: "identificação do trabalhador" },
      { field: "examDate", meaning: "data real do exame", where: "campo data do exame/avaliação médica", rule: "não usar upload, emissão administrativa ou agendamento" },
      { field: "asoType", meaning: "tipo do ASO", where: "marcação admissional/periódico/retorno/mudança/demissional" },
      { field: "fitnessStatus", meaning: "resultado apto/inapto", where: "conclusão do ASO", rule: "não extrair CID, diagnóstico ou detalhes clínicos" },
    ],
  },
  {
    documentTypes: ["DEPENDENT_DOCUMENT", "BIRTH_CERTIFICATE", "VACCINATION_RECORD", "SCHOOL_ATTENDANCE", "RESPONSIBILITY_TERM"],
    fields: [
      { field: "dependents", meaning: "lista de dependentes", where: "identificação de cada filho/dependente" },
      { field: "vaccinationRecordDetected", meaning: "carteira de vacinação comprovada", where: "título e registros de vacinação" },
      { field: "schoolAttendanceDetected", meaning: "frequência escolar comprovada", where: "declaração da instituição de ensino" },
      { field: "responsibilityTermDetected", meaning: "termo de responsabilidade comprovado", where: "título e conteúdo do termo" },
    ],
  },
  {
    documentTypes: ["TRANSPORT_REQUEST", "TRANSPORT_BENEFIT_TERM"],
    fields: [
      { field: "transportVoucherAuthorized", meaning: "opção pelo vale-transporte", where: "caixa/opção Sim ou declaração de solicitação" },
      { field: "transportVoucherDailyValue", meaning: "valor diário total", where: "campo tarifa diária/valor por dia", rule: "não confundir com valor de uma passagem" },
    ],
  },
];

export function extractionGuideForPrompt() {
  return EMPLOYEE_DOCUMENT_EXTRACTION_GUIDE.map((entry) => ({
    tipos: entry.documentTypes,
    campos: entry.fields.map((field) => ({
      campo: field.field,
      significado: field.meaning,
      procurar_em: field.where,
      ...(field.rule ? { regra: field.rule } : {}),
    })),
  }));
}
