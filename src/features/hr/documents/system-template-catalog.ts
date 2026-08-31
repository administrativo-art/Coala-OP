import { UNIFORM_SYSTEM_TEMPLATES } from "@/features/uniforms/template-catalog";
import {
  PROBATION_CONTRACT_V4_FIELD_MAPPING,
  PROBATION_CONTRACT_V4_HASH,
  PROBATION_CONTRACT_V4_SOURCE,
  PROBATION_CONTRACT_V4_VARIABLES,
} from "@/features/hr/documents/probation-contract-template";
import {
  HOURS_BANK_V2_HASH,
  HOURS_BANK_V2_SOURCE,
  HOURS_BANK_V2_VARIABLES,
} from "@/features/hr/documents/hours-bank-template";
import type { TemplateFieldMapping } from "@/features/hr/documents/field-mapping";
import {
  RECEIPT_FORM_SCHEMA,
  type DocumentFormSchema,
} from "@/features/hr/documents/document-form-schema";

export type SystemDocumentTemplateKind = "system_pdf" | "reference_docx";
export type SystemDocumentTemplateRenderer = "letterhead" | "uniform" | "admission_docx";
export type SystemDocumentGenerationMode = "direct" | "contextual" | "reference";

export type SystemDocumentTemplate = {
  id: string;
  name: string;
  documentTitle?: string;
  shortName?: string;
  slug?: string;
  category: string;
  description: string;
  status: "published" | "draft";
  version: number;
  templateKind: SystemDocumentTemplateKind;
  renderer: SystemDocumentTemplateRenderer;
  /** Define onde o documento nasce; modelos contextuais não aparecem no gerador avulso. */
  generationMode: SystemDocumentGenerationMode;
  sourceModule?: "documents" | "uniforms" | "admission" | "termination";
  sourceModulePath?: string;
  variables: string[];
  fieldMapping?: TemplateFieldMapping;
  formSchema?: DocumentFormSchema;
  letterheadVersion: "coala-letterhead-v2";
  signatureScope: "none" | "bundle" | "independent";
  postAdmissionSignatureScope?: "none" | "independent";
  retentionPolicyId: string;
  contentHash?: string;
  sourcePath?: string;
  sourceFormat: "pdf" | "docx";
  isSystem: true;
  previewUrl: string;
  downloadUrl?: string;
  updatedAt: string;
};

const UPDATED_AT = "2026-07-28T00:00:00.000Z";
const ADMISSION_PUBLISHED_AT = "2026-08-30T00:00:00.000Z";
const ADMISSION_BASE = "docs/modelos-documentos/admissionais";

const baseTemplates: SystemDocumentTemplate[] = [
  {
    id: "system-letterhead-blank",
    name: "Papel timbrado Coala Shakes - em branco",
    category: "Base institucional",
    description: "Página A4 oficial com faixa superior sem margem e marca institucional no canto inferior direito.",
    status: "published",
    version: 2,
    templateKind: "system_pdf",
    renderer: "letterhead",
    generationMode: "reference",
    sourceModule: "documents",
    variables: [],
    letterheadVersion: "coala-letterhead-v2",
    signatureScope: "none",
    retentionPolicyId: "institutional_active_version",
    sourceFormat: "pdf",
    isSystem: true,
    previewUrl: "/api/documents/templates/system-letterhead-blank/preview",
    updatedAt: UPDATED_AT,
  },
  {
    id: "system-receipt-standard",
    name: "Recibo de pagamento",
    category: "Financeiro e recibos",
    description: "Recibo guiado por schema, com partes livres, itens repetíveis, total automático e pagamento condicional.",
    status: "published",
    version: 3,
    templateKind: "reference_docx",
    renderer: "admission_docx",
    generationMode: "direct",
    sourceModule: "documents",
    variables: [
      "description",
      "name",
      "receipt.city",
      "receipt.direction",
      "receipt.issueDate",
      "receipt.issuer.snapshot.document",
      "receipt.issuer.snapshot.name",
      "receipt.items",
      "receipt.number",
      "receipt.state",
      "receipt.payment.account",
      "receipt.payment.agency",
      "receipt.payment.bank",
      "receipt.payment.method",
      "receipt.payment.methodLabel",
      "receipt.payment.pixKey",
      "receipt.recipient.snapshot.document",
      "receipt.recipient.snapshot.name",
      "receipt.total",
      "receipt.totalWithWords",
      "value",
    ],
    formSchema: RECEIPT_FORM_SCHEMA,
    letterheadVersion: "coala-letterhead-v2",
    signatureScope: "independent",
    retentionPolicyId: "fiscal_generation_date_pending",
    contentHash: "d461b8bf57b5860b73f57f431742bae1e0e35a79ffcddfa066ef41eebd430da7",
    sourcePath: "docs/modelos-documentos/recibos/recibo-v3.docx",
    sourceFormat: "docx",
    isSystem: true,
    previewUrl: "/api/documents/templates/system-receipt-standard/preview",
    downloadUrl: "/api/documents/templates/system-receipt-standard/source",
    updatedAt: UPDATED_AT,
  },
];

const uniformTemplates: SystemDocumentTemplate[] = UNIFORM_SYSTEM_TEMPLATES.map((template) => ({
  ...template,
  status: "published",
  version: 1,
  templateKind: "system_pdf",
  renderer: "uniform",
  generationMode: "contextual",
  sourceModule: "uniforms",
  sourceModulePath: "/dashboard/stock/uniforms",
  variables: [
    "collaborator.name",
    "collaborator.document",
    "movement.date",
    "movement.items",
    "movement.notes",
    "movement.signatures",
  ],
  letterheadVersion: "coala-letterhead-v2",
  signatureScope: "none",
  retentionPolicyId: "employment_plus_5y",
  sourceFormat: "pdf",
  isSystem: true,
  previewUrl: `/api/documents/templates/${template.id}/preview`,
  updatedAt: UPDATED_AT,
}));

const admissionTemplates: SystemDocumentTemplate[] = [
  {
    id: "system-admission-employment-probation-contract",
    name: "Contrato de Trabalho a Título de Experiência",
    documentTitle: "CONTRATO DE TRABALHO A TÍTULO DE EXPERIÊNCIA",
    shortName: "Contrato de experiência",
    slug: "contrato-experiencia",
    category: "Contratos",
    description: "Versão 4 no padrão documental CT Sorvetes, com qualificação destacada e área ampliada para assinatura.",
    sourcePath: PROBATION_CONTRACT_V4_SOURCE,
    contentHash: PROBATION_CONTRACT_V4_HASH,
    version: 4,
    variables: [...PROBATION_CONTRACT_V4_VARIABLES],
    fieldMapping: PROBATION_CONTRACT_V4_FIELD_MAPPING,
  },
  {
    id: "system-admission-hours-bank-agreement",
    name: "Acordo Individual de Banco de Horas",
    category: "Admissão",
    description: "Modelo parametrizado e homologado para uso no fluxo admissional.",
    sourcePath: HOURS_BANK_V2_SOURCE,
    contentHash: HOURS_BANK_V2_HASH,
    version: 2,
    variables: [...HOURS_BANK_V2_VARIABLES],
  },
  {
    id: "system-admission-lgpd-awareness-term",
    name: "Termo de Ciência sobre o Tratamento de Dados Pessoais",
    category: "Admissão",
    description: "Modelo parametrizado sem linha de vigência fixa, homologado para uso no fluxo admissional.",
    sourcePath: `${ADMISSION_BASE}/03-termo-lgpd-v4.docx`,
    contentHash: "c5bc23d9a942b57daeb94d6185187552c4520c82b30cc071f589a9c94d50e1a5",
    version: 4,
    variables: [
      "employee.cpf",
      "employee.name",
      "integration.employer_address",
      "integration.employer_cnpj",
      "integration.employer_name",
    ],
  },
  {
    id: "system-admission-image-voice-consent",
    name: "Termo de Consentimento para Uso de Imagem e Voz",
    category: "Admissão",
    description: "Modelo incluído no pacote admissional, com autorização facultativa e explicitamente assinalada.",
    sourcePath: `${ADMISSION_BASE}/04-imagem-voz-v4.docx`,
    contentHash: "a266bbf3ffa1e4e3fa06108b57f5755879151a1af4e99497ac099d27856d9a0a",
    version: 4,
    variables: [
      "employee.cpf",
      "employee.name",
      "integration.employer_address",
      "integration.employer_cnpj",
      "integration.employer_name",
      "integration.image_voice_authorized_mark",
    ],
    postAdmissionSignatureScope: "independent" as const,
  },
  {
    id: "system-admission-goals-awards-policy",
    name: "Regulamento de Metas e Prêmios por Desempenho",
    category: "Admissão",
    description: "Modelo parametrizado e homologado para uso no fluxo admissional.",
    sourcePath: `${ADMISSION_BASE}/05-metas-premios-v2.docx`,
    contentHash: "a5662e341eb06b40f01a6db049db18411b94d2bd1d0f74595909eb5ff6624745",
    version: 2,
    variables: [
      "employee.ctps_number",
      "employee.ctps_series",
      "employee.name",
      "integration.employer_address",
      "integration.employer_cnpj",
      "integration.employer_name",
    ],
  },
  {
    id: "system-admission-transportation-voucher-request",
    name: "Solicitação de Vale-Transporte",
    category: "Admissão",
    description: "Modelo de solicitação, separado da declaração de não utilização.",
    sourcePath: `${ADMISSION_BASE}/06-vale-transporte-solicitacao-v2.docx`,
    contentHash: "cd643a4caf7c088e98af1dc6908cac7d2005163a795f323df1fcd8450fca53bb",
    version: 2,
    variables: [
      "employee.address",
      "employee.ctps_number",
      "employee.ctps_series",
      "employee.name",
      "integration.employer_name",
      "transport_voucher_decision_text",
    ],
    postAdmissionSignatureScope: "independent" as const,
    fieldMapping: {
      transport_voucher_decision_text: {
        kind: "manual",
        label: "Decisão de vale-transporte",
        format: "text",
        required: true,
        defaultValue: "opto",
      },
    },
  },
  {
    id: "system-admission-transportation-voucher-waiver",
    name: "Declaração de Não Utilização de Vale-Transporte",
    category: "Admissão",
    description: "Modelo de não utilização/renúncia, versionado separadamente da solicitação.",
    sourcePath: `${ADMISSION_BASE}/06-vale-transporte-renuncia-v2.docx`,
    contentHash: "3ea7e9e3ddbfa2a4ffefe780efbd03677984131e4fdf3ca8437aa81fc3a1a6de",
    version: 2,
    variables: [
      "employee.address",
      "employee.ctps_number",
      "employee.ctps_series",
      "employee.name",
      "integration.employer_name",
      "transport_voucher_decision_text",
      "transport_voucher_document_title",
    ],
    postAdmissionSignatureScope: "independent" as const,
    fieldMapping: {
      transport_voucher_decision_text: {
        kind: "manual",
        label: "Decisão de vale-transporte",
        format: "text",
        required: true,
        defaultValue: "não opto",
      },
      transport_voucher_document_title: {
        kind: "manual",
        label: "Título da declaração",
        format: "text",
        required: true,
        defaultValue: "DECLARAÇÃO DE NÃO UTILIZAÇÃO DE VALE-TRANSPORTE",
      },
    },
  },
  {
    id: "system-admission-confidentiality-agreement",
    name: "Termo de Confidencialidade e Sigilo",
    category: "Admissão",
    description: "Modelo parametrizado e homologado para uso no fluxo admissional.",
    sourcePath: `${ADMISSION_BASE}/07-confidencialidade-v2.docx`,
    contentHash: "56306e646b241ab3b0bb93c804dc3cf549a833efb583bf990c9a18c8ba275f80",
    version: 2,
    variables: [
      "employee.ctps_number",
      "employee.ctps_series",
      "employee.name",
      "integration.employer_address",
      "integration.employer_cnpj",
      "integration.employer_name",
    ],
  },
  {
    id: "system-admission-bundle-closing-term",
    name: "Termo de Encerramento, Ciência e Assinatura",
    category: "Admissão",
    description: "Documento final obrigatório com lista dinâmica dos componentes reais do pacote.",
    sourcePath: `${ADMISSION_BASE}/09-termo-encerramento-v4.docx`,
    contentHash: "a98b162a2adfda8856a488870f8a462164a78f7e40ee29f63395f5d0f5e0221e",
    version: 4,
    variables: [
      "bundle_components_summary",
      "contract_start_long",
      "employee.name",
      "integration.employer_name",
    ],
    fieldMapping: {
      bundle_components_summary: {
        kind: "manual",
        label: "Componentes incluídos no pacote",
        format: "multiline",
        required: true,
      },
      contract_start_long: {
        kind: "system",
        key: "integration.expected_admission_date",
        formatter: "date_long_br",
      },
    },
  },
].map((template): SystemDocumentTemplate => ({
  ...template,
  status: "published",
  version: template.version ?? 1,
  templateKind: "reference_docx",
  renderer: "admission_docx",
  generationMode: "direct",
  sourceModule: "documents",
  variables: [...(template.variables ?? [])],
  fieldMapping: template.fieldMapping as TemplateFieldMapping | undefined,
  letterheadVersion: "coala-letterhead-v2",
  signatureScope: "bundle",
  retentionPolicyId: template.id === "system-admission-image-voice-consent"
    ? "consent_until_revoked_plus_5y"
    : "employment_plus_5y",
  sourceFormat: "docx",
  isSystem: true,
  previewUrl: `/api/documents/templates/${template.id}/preview`,
  downloadUrl: `/api/documents/templates/${template.id}/source`,
  updatedAt: ADMISSION_PUBLISHED_AT,
}));

export const SYSTEM_DOCUMENT_TEMPLATES: readonly SystemDocumentTemplate[] = [
  ...baseTemplates,
  ...uniformTemplates,
  ...admissionTemplates,
];

export function systemDocumentTemplateById(id: string) {
  return SYSTEM_DOCUMENT_TEMPLATES.find((template) => template.id === id) ?? null;
}

export function isSelectableAdmissionSignatureTemplate(template: Pick<
  SystemDocumentTemplate,
  "id" | "status" | "sourceFormat" | "category"
>) {
  return template.status === "published"
    && template.sourceFormat === "docx"
    && ["Admissão", "Contratos"].includes(template.category)
    && template.id !== "system-admission-bundle-closing-term";
}
