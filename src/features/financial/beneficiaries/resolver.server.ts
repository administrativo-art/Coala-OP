import { paymentRequestError } from "../payment-requests/business-error";
import { createHash } from "node:crypto";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { matchesPersonWorkspace } from "@/features/privacy/person-workspace";
import { decryptPaymentDestination } from "./security.server";
import {
  inferPixKeyType,
  maskBrazilianDocument,
  maskPaymentDestination,
  normalizeBrazilianDocument,
  normalizeValidatedPixKey,
  validBrazilianTaxId,
  pixDocumentKeyMatchesHolder,
  resolvePixKeyType,
  toIsoString,
} from "./normalization";
import { paymentBeneficiaryReferenceSchema } from "./schemas";
import type {
  BeneficiarySnapshot,
  PaymentBeneficiaryReference,
  ResolvedPaymentBeneficiary,
} from "./types";

function fieldText(data: FirebaseFirestore.DocumentData | undefined) {
  return typeof data?.value_text === "string" ? data.value_text.trim() : "";
}

async function resolveEmployee(sourceId: string): Promise<ResolvedPaymentBeneficiary> {
  const employeeRef = hrDbAdmin.collection("employees").doc(sourceId);
  const [employee, cpf, pix, pixType] = await Promise.all([
    employeeRef.get(),
    employeeRef.collection("field_values").doc("employee.cpf").get(),
    employeeRef.collection("field_values").doc("employee.pix_key").get(),
    employeeRef.collection("field_values").doc("employee.pix_key_type").get(),
  ]);
  if (!employee.exists) throw paymentRequestError("Colaborador favorecido não encontrado.");
  if (employee.get("status") !== "active") throw paymentRequestError("O colaborador favorecido está inativo.");
  const document = normalizeBrazilianDocument(fieldText(cpf.data()));
  const pixKey = fieldText(pix.data());
  if (document.length !== 11) throw paymentRequestError("O CPF do colaborador está incompleto.");
  if (!pixKey) throw paymentRequestError("O colaborador não possui chave Pix cadastrada.");
  const pixKeyType = resolvePixKeyType(pixKey, fieldText(pixType.data()));
  if (!pixDocumentKeyMatchesHolder({ pixKey, pixKeyType, holderDocument: document })) {
    throw paymentRequestError("A chave Pix documental não pertence ao CPF do colaborador.");
  }
  const sourceUpdatedAt = [
    toIsoString(pix.get("updated_at")),
    toIsoString(pixType.get("updated_at")),
    toIsoString(employee.get("synced_at")),
  ].filter((value): value is string => Boolean(value)).sort().at(-1) ?? new Date(0).toISOString();
  return {
    sourceType: "employee",
    sourceId,
    name: String(employee.get("name") ?? employee.get("email") ?? "Colaborador"),
    document,
    paymentMethod: "pix_key",
    pixKeyType,
    pixKey,
    validated: true,
    sourceUpdatedAt,
  };
}

async function resolveEntity(sourceId: string, requireValidated = false): Promise<ResolvedPaymentBeneficiary> {
  const [entity, profile] = await Promise.all([
    dbAdmin.collection("entities").doc(sourceId).get(),
    financialDbAdmin.collection("supplierPaymentProfiles").doc(sourceId).get(),
  ]);
  if (!entity.exists) throw paymentRequestError("Pessoa ou empresa favorecida não encontrada.");
  if (entity.get("status") === "inactive") throw paymentRequestError("A pessoa ou empresa favorecida está inativa.");
  if (!profile.exists) throw paymentRequestError("A pessoa ou empresa não possui chave Pix cadastrada.");
  const entityDocument = normalizeBrazilianDocument(entity.get("document") ?? entity.get("cnpj"));
  const isPerson = entityDocument.length === 11;
  const isCompany = entityDocument.length === 14;
  if (requireValidated && (profile.get("active") !== true || !profile.get("validatedAt")
    || profile.get("paymentMethod") !== "pix_key"
    || !validBrazilianTaxId(entityDocument)
    || (isPerson && entity.get("type") !== "pessoa_fisica")
    || (isCompany && entity.get("type") != null && entity.get("type") !== "pessoa_juridica")
    || !matchesPersonWorkspace(entity.data(), WORKSPACE_ID, isCompany)
    || !matchesPersonWorkspace(profile.data(), WORKSPACE_ID, true)
    || (isPerson ? profile.get("entityId") !== sourceId : profile.get("entityId") != null && profile.get("entityId") !== sourceId)
    || normalizeBrazilianDocument(profile.get("holderDocument")) !== entityDocument)) {
    throw paymentRequestError("O perfil de pagamento precisa estar ativo e validado para o CPF/CNPJ cadastrado.");
  }
  const paymentData = decryptPaymentDestination(String(profile.get("encryptedPaymentData") ?? ""));
  if (!paymentData.pixKey) {
    throw paymentRequestError("A pessoa ou empresa não possui chave Pix cadastrada.");
  }
  const pixKeyType = profile.get("pixKeyType") ?? inferPixKeyType(paymentData.pixKey);
  if (requireValidated && (!profile.get("pixKeyType")
    || !normalizeValidatedPixKey(paymentData.pixKey, pixKeyType, entityDocument))) {
    throw paymentRequestError("O tipo ou o valor da chave Pix validada é incompatível com o favorecido.");
  }
  if (!pixDocumentKeyMatchesHolder({ pixKey: paymentData.pixKey, pixKeyType, holderDocument: entityDocument })) {
    throw paymentRequestError("A chave Pix documental não pertence ao CPF/CNPJ do favorecido.");
  }
  return {
    sourceType: "entity",
    sourceId,
    name: String(entity.get("name") ?? entity.get("razao_social") ?? "Favorecido"),
    document: entityDocument,
    paymentMethod: "pix_key",
    pixKeyType,
    pixKey: paymentData.pixKey,
    validated: true,
    sourceUpdatedAt: String(profile.get("updatedAt") ?? new Date(0).toISOString()),
  };
}

export function resolveValidatedEntityPixBeneficiary(sourceId: string) {
  return resolveEntity(sourceId, true);
}

export async function resolvePaymentBeneficiary(
  reference: PaymentBeneficiaryReference,
): Promise<ResolvedPaymentBeneficiary> {
  const parsed = paymentBeneficiaryReferenceSchema.parse(reference);
  return parsed.sourceType === "employee"
    ? resolveEmployee(parsed.sourceId)
    : resolveEntity(parsed.sourceId);
}

export function createBeneficiarySnapshot(
  resolved: ResolvedPaymentBeneficiary,
  resolvedAt = new Date().toISOString(),
): BeneficiarySnapshot {
  const destination = resolved.pixKey
    ? maskPaymentDestination(resolved.pixKey)
    : resolved.pixCopyPaste
      ? maskPaymentDestination(resolved.pixCopyPaste)
      : resolved.bankDetails
        ? `Banco ${resolved.bankDetails.bankCode} · conta ${maskPaymentDestination(resolved.bankDetails.account)}`
        : "Não configurado";
  return {
    sourceType: resolved.sourceType,
    sourceId: resolved.sourceId,
    name: resolved.name,
    document: maskBrazilianDocument(resolved.document),
    documentHash: createHash("sha256").update(normalizeBrazilianDocument(resolved.document)).digest("hex"),
    ...(resolved.paymentMethod === "pix_key" && resolved.pixKey && resolved.pixKeyType
      ? { destinationHash: createHash("sha256").update(`${resolved.pixKeyType}:${normalizeValidatedPixKey(resolved.pixKey, resolved.pixKeyType, resolved.document) ?? resolved.pixKey}`).digest("hex") }
      : {}),
    paymentMethod: resolved.paymentMethod,
    pixKeyType: resolved.pixKeyType,
    maskedPaymentDestination: destination,
    sourceUpdatedAt: resolved.sourceUpdatedAt,
    resolvedAt,
  };
}
