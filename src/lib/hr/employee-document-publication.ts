/**
 * Publicação de documentos para o colaborador (decisão do programador, 20/10/2026).
 *
 * Duas macros, ambas vistas sobre o mesmo registro (nunca cópia de arquivo):
 * - 01 Documentos da empresa: pastas da empresa e a pasta Colaboradores, com tudo de cada pessoa. Só o DP autorizado.
 * - 02 Documentos dos colaboradores: uma pasta por pessoa, só com o que foi PUBLICADO para ela. Só o titular.
 *
 * Publicar marca o próprio documento; retirar mantém o arquivo e o histórico. A política por tipo decide se a publicação
 * é automática (ao validar ou ao assinar), manual ou nunca. Puro, sem Firestore.
 */

export type DocumentPublicationMode = 'automatic' | 'manual' | 'never';
export type DocumentPublicationTrigger = 'validated' | 'signed';
export type DocumentPublicationPolicy = { mode: DocumentPublicationMode; trigger: DocumentPublicationTrigger };
export type DocumentPublication = {
  status: 'published' | 'withdrawn';
  at: string;
  by: string;
  source: 'policy' | 'manual';
  reason?: string | null;
};

const automaticOnSign: DocumentPublicationPolicy = { mode: 'automatic', trigger: 'signed' };
const automaticOnValidate: DocumentPublicationPolicy = { mode: 'automatic', trigger: 'validated' };
const manual: DocumentPublicationPolicy = { mode: 'manual', trigger: 'validated' };
const never: DocumentPublicationPolicy = { mode: 'never', trigger: 'validated' };

/**
 * Política aprovada pelo programador em 20/10/2026. Tipo sem entrada aqui (inclusive os novos) não é publicado até
 * ganhar política própria ao ser catalogado.
 */
export const DEFAULT_DOCUMENT_PUBLICATION_POLICY: Record<string, DocumentPublicationPolicy> = {
  // Fechamento do mês: o contracheque vai dentro do pacote assinado; o avulso não é publicado para não ir duas vezes.
  TIME_CLOSING_PACKAGE: automaticOnSign,
  PAYSLIP: never,
  // Férias: aviso e recibo assinados; o comprovante de pagamento o colaborador consulta no banco.
  VACATION_NOTICE: automaticOnSign,
  VACATION_RECEIPT: automaticOnSign,
  VACATION_PAYMENT: never,
  // Admissão: o pacote admissional é um documento só (ficha, contratos, salário-família, uniforme, ASO admissional).
  ADMISSION_PACKAGE: automaticOnSign,
  EMPLOYEE_REGISTRATION: never,
  EMPLOYMENT_CONTRACT: never,
  SERVICE_PROVIDER_CONTRACT_PJ: manual,
  SERVICE_PROVIDER_CONTRACT_ADDENDUM: manual,
  SERVICE_PROVIDER_CONTRACT_PF: manual,
  PROBATION_CONTRACT: never,
  FAMILY_SALARY_TERM: never,
  ADMISSION_DATA_FORM: never,
  ASO_REQUEST: never,
  // Aditivo de prorrogação, quando houver.
  PROBATION_EXTENSION: automaticOnSign,
  // Pessoais e dependentes: restritos.
  PERSONAL_ID: never,
  PROFILE_PHOTO: never,
  ADDRESS_PROOF: never,
  CIVIL_CERTIFICATE: never,
  WORK_CARD: never,
  PIS_PASEP: never,
  DEPENDENT_DOCUMENT: never,
  VACCINATION_RECORD: never,
  SCHOOL_ATTENDANCE: never,
  // Benefícios: só o vale-transporte.
  TRANSPORT_REQUEST: automaticOnSign,
  // Uniformes depois da admissão: entrega, troca e devolução avulsas.
  UNIFORM_DELIVERY: automaticOnSign,
  UNIFORM_EXCHANGE: automaticOnSign,
  UNIFORM_RETURN: automaticOnSign,
  ASSET_CUSTODY_TERM: automaticOnSign,
  // Saúde: os ASOs fora da admissão; atestado restrito.
  ASO_ADMISSION: never,
  ASO_PERIODIC: automaticOnValidate,
  ASO_RETURN: automaticOnValidate,
  ASO_RISK_CHANGE: automaticOnValidate,
  ASO_DISMISSAL: automaticOnValidate,
  MEDICAL_CERTIFICATE: never,
  // Disciplinar: restrito.
  DISCIPLINARY_WARNING: never,
  // Rescisão: a via do empregado, no fim, assinada; o comprovante de pagamento também.
  RESIGNATION_REQUEST: automaticOnSign,
  TERMINATION_NOTICE: automaticOnSign,
  TERMINATION_TERM: automaticOnSign,
  TERMINATION_PAYMENT: automaticOnValidate,
  // Não identificado nunca é publicado; precisa ser classificado antes.
  UNKNOWN_DOCUMENT: never,
};

/** Política vigente do tipo: a configurada no RH, senão a padrão aprovada, senão "nunca". */
export function resolvePublicationPolicy(documentTypeCode: string | null | undefined, overrides?: Record<string, DocumentPublicationPolicy> | null): DocumentPublicationPolicy {
  if (!documentTypeCode || documentTypeCode === 'UNKNOWN_DOCUMENT') return never;
  return overrides?.[documentTypeCode] ?? DEFAULT_DOCUMENT_PUBLICATION_POLICY[documentTypeCode] ?? never;
}

export function isPublishedToEmployee(doc: { publication?: DocumentPublication | null; documentTypeCode?: string | null; deletedAt?: unknown }) {
  return doc.publication?.status === 'published' && Boolean(doc.documentTypeCode) && doc.documentTypeCode !== 'UNKNOWN_DOCUMENT' && !doc.deletedAt;
}

/**
 * Publicação automática no momento certo: só quando a política do tipo é automática e o gatilho aconteceu. Documento
 * que exige assinatura só é publicado assinado; tipo "nunca" e "manual" não publicam sozinhos.
 */
export function shouldAutoPublish(policy: DocumentPublicationPolicy, event: DocumentPublicationTrigger, doc: { signatureRequired?: boolean; signatureStatus?: string | null }) {
  if (policy.mode !== 'automatic') return false;
  if (doc.signatureRequired && doc.signatureStatus !== 'signed') return false;
  return policy.trigger === event || (policy.trigger === 'validated' && event === 'signed');
}

/** Pode publicar manualmente: nunca para tipo "nunca", não identificado ou documento com assinatura pendente. */
export function canPublishManually(policy: DocumentPublicationPolicy, doc: { documentTypeCode?: string | null; signatureRequired?: boolean; signatureStatus?: string | null; employeeId?: string | null }) {
  if (!doc.employeeId || !doc.documentTypeCode || doc.documentTypeCode === 'UNKNOWN_DOCUMENT') return false;
  if (policy.mode === 'never') return false;
  return !doc.signatureRequired || doc.signatureStatus === 'signed';
}
