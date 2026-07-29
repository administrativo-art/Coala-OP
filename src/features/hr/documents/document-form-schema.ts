import { formatDocumentOutput } from "@/features/hr/documents/document-output-formatters";

export const DOCUMENT_FORM_SCHEMA_VERSION = 1 as const;

export type DocumentPartyType =
  | "employee"
  | "company"
  | "external_person"
  | "external_company";
export type DocumentPartyRole =
  | "issuer"
  | "recipient"
  | "payer"
  | "payee"
  | "contractor"
  | "contracted"
  | "witness";

export type DocumentFormCondition = {
  field: string;
  operator: "eq" | "neq" | "truthy";
  value?: string | number | boolean;
};

export type DocumentFormField = {
  key: string;
  label: string;
  kind:
    | "text"
    | "multiline"
    | "date"
    | "number"
    | "currency"
    | "boolean"
    | "select"
    | "party"
    | "repeatable"
    | "calculated";
  required?: boolean;
  helpText?: string;
  options?: string[];
  condition?: DocumentFormCondition;
  partyRole?: DocumentPartyRole;
  allowedPartyTypes?: DocumentPartyType[];
  itemFields?: Array<{
    key: string;
    label: string;
    kind: "text" | "number" | "currency" | "date";
    required?: boolean;
  }>;
  calculation?: {
    operation: "sum";
    source: string;
    field: string;
    formatter?: "none" | "currency_br" | "currency_br_with_words";
  };
};

export type DocumentFormStep = {
  id: string;
  title: string;
  description?: string;
  fields: DocumentFormField[];
};

export type DocumentFormSchema = {
  schemaVersion: typeof DOCUMENT_FORM_SCHEMA_VERSION;
  anchor: "employee" | "optional_employee" | "none";
  documentType?: "receipt" | "generic";
  protocolType?: string;
  protocolTarget?: string;
  steps: DocumentFormStep[];
};

export type DocumentPartySnapshot = {
  partyType: DocumentPartyType;
  role: DocumentPartyRole;
  ref: string | null;
  snapshot: {
    name: string;
    document: string | null;
    address?: string | null;
  };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function atPath(root: unknown, path: string) {
  return path.split(".").reduce<unknown>((current, key) => record(current)[key], root);
}

function setPath(root: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor = root;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value;
    else cursor = cursor[part] = record(cursor[part]);
  });
}

export function conditionMatches(condition: DocumentFormCondition | undefined, values: unknown) {
  if (!condition) return true;
  const actual = atPath(values, condition.field);
  if (condition.operator === "truthy") return Boolean(actual);
  if (condition.operator === "neq") return actual !== condition.value;
  return actual === condition.value;
}

export function resolveDocumentFormSchema(
  schema: DocumentFormSchema,
  values: Record<string, unknown>,
) {
  if (schema.schemaVersion !== DOCUMENT_FORM_SCHEMA_VERSION) {
    throw new Error("Versão de schema de formulário não suportada.");
  }
  const output = structuredClone(values);
  const missing: string[] = [];
  const parties: DocumentPartySnapshot[] = [];
  const repeatableFields: DocumentFormField[] = [];

  for (const step of schema.steps) {
    for (const field of step.fields) {
      if (!conditionMatches(field.condition, output)) continue;
      if (field.kind === "calculated") {
        const source = atPath(output, field.calculation?.source ?? "");
        const total = Array.isArray(source)
          ? source.reduce((sum, item) => {
              const value = Number(record(item)[field.calculation?.field ?? ""]);
              return sum + (Number.isFinite(value) ? value : 0);
            }, 0)
          : 0;
        const formatter = field.calculation?.formatter ?? "none";
        const calculated = formatter === "currency_br"
          ? formatDocumentOutput(total, "currency_br")
          : formatter === "currency_br_with_words"
            ? formatDocumentOutput(total, "currency_br_with_words")
            : total;
        setPath(output, field.key, calculated);
        continue;
      }
      const value = atPath(output, field.key);
      if (field.required && (
        value === undefined
        || value === null
        || value === ""
        || (Array.isArray(value) && value.length === 0)
      )) {
        missing.push(field.label);
      }
      if (field.kind === "party" && value) {
        const party = record(value);
        const snapshot = record(party.snapshot);
        const partyType = party.partyType as DocumentPartyType;
        if (!field.allowedPartyTypes?.includes(partyType)) {
          throw new Error(`Tipo de parte inválido em ${field.label}.`);
        }
        parties.push({
          partyType,
          role: field.partyRole!,
          ref: typeof party.ref === "string" ? party.ref : null,
          snapshot: {
            name: String(snapshot.name ?? "").trim(),
            document: typeof snapshot.document === "string" ? snapshot.document : null,
            address: typeof snapshot.address === "string" ? snapshot.address : null,
          },
        });
      }
      if (field.kind === "repeatable" && Array.isArray(value)) {
        repeatableFields.push(field);
        value.forEach((row, index) => {
          for (const itemField of field.itemFields ?? []) {
            const itemValue = record(row)[itemField.key];
            if (itemField.required && (itemValue === undefined || itemValue === null || itemValue === "")) {
              missing.push(`${field.label} ${index + 1}: ${itemField.label}`);
            }
          }
        });
      }
    }
  }
  for (const field of repeatableFields) {
    const rows = atPath(output, field.key);
    if (!Array.isArray(rows)) continue;
    setPath(output, field.key, rows.map((row) => {
      const item = { ...record(row) };
      for (const itemField of field.itemFields ?? []) {
        if (itemField.kind === "currency") {
          item[itemField.key] = formatDocumentOutput(item[itemField.key], "currency_br");
        }
      }
      return item;
    }));
  }
  return { values: output, missing, parties };
}

export function isDocumentFormSchema(value: unknown): value is DocumentFormSchema {
  const schema = record(value);
  if (schema.schemaVersion !== DOCUMENT_FORM_SCHEMA_VERSION) return false;
  if (!["employee", "optional_employee", "none"].includes(String(schema.anchor))) return false;
  if (!Array.isArray(schema.steps) || !schema.steps.length) return false;
  return schema.steps.every((step) => {
    const item = record(step);
    return typeof item.id === "string"
      && typeof item.title === "string"
      && Array.isArray(item.fields);
  });
}

export const RECEIPT_FORM_SCHEMA: DocumentFormSchema = {
  schemaVersion: 1,
  anchor: "none",
  documentType: "receipt",
  protocolType: "REC",
  protocolTarget: "receipt.number",
  steps: [
    {
      id: "parties",
      title: "Partes",
      fields: [
        {
          key: "receipt.direction",
          label: "Direção do recibo",
          kind: "select",
          required: true,
          options: ["Recebemos de", "Pagamos a"],
        },
        {
          key: "receipt.issuer",
          label: "Empresa emitente",
          kind: "party",
          required: true,
          partyRole: "issuer",
          allowedPartyTypes: ["company", "external_company"],
        },
        {
          key: "receipt.recipient",
          label: "Quem recebeu",
          kind: "party",
          required: true,
          partyRole: "recipient",
          allowedPartyTypes: ["employee", "company", "external_person", "external_company"],
        },
      ],
    },
    {
      id: "items",
      title: "Itens",
      fields: [
        {
          key: "receipt.items",
          label: "Itens do recibo",
          kind: "repeatable",
          required: true,
          itemFields: [
            { key: "description", label: "Descrição", kind: "text", required: true },
            { key: "value", label: "Valor", kind: "currency", required: true },
          ],
        },
        {
          key: "receipt.total",
          label: "Total",
          kind: "calculated",
          calculation: {
            operation: "sum",
            source: "receipt.items",
            field: "value",
            formatter: "currency_br",
          },
        },
        {
          key: "receipt.totalWithWords",
          label: "Total por extenso",
          kind: "calculated",
          calculation: {
            operation: "sum",
            source: "receipt.items",
            field: "value",
            formatter: "currency_br_with_words",
          },
        },
      ],
    },
    {
      id: "payment",
      title: "Pagamento",
      fields: [
        {
          key: "receipt.payment.method",
          label: "Forma de pagamento",
          kind: "select",
          required: true,
          options: ["pix", "transfer", "cash"],
        },
        {
          key: "receipt.payment.bank",
          label: "Banco",
          kind: "text",
          required: true,
          condition: { field: "receipt.payment.method", operator: "eq", value: "transfer" },
        },
        {
          key: "receipt.payment.agency",
          label: "Agência",
          kind: "text",
          required: true,
          condition: { field: "receipt.payment.method", operator: "eq", value: "transfer" },
        },
        {
          key: "receipt.payment.account",
          label: "Conta",
          kind: "text",
          required: true,
          condition: { field: "receipt.payment.method", operator: "eq", value: "transfer" },
        },
        {
          key: "receipt.payment.pixKey",
          label: "Chave Pix",
          kind: "text",
          required: true,
          condition: { field: "receipt.payment.method", operator: "eq", value: "pix" },
        },
      ],
    },
    {
      id: "issue",
      title: "Emissão",
      fields: [
        {
          key: "receipt.city",
          label: "Cidade",
          kind: "text",
          required: true,
        },
        {
          key: "receipt.issueDate",
          label: "Data de emissão",
          kind: "date",
          required: true,
        },
      ],
    },
  ],
};
