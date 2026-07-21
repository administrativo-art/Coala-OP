import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { decryptPaymentDestination } from "./security.server";
import {
  inferPixKeyType,
  maskBrazilianDocument,
  maskPaymentDestination,
  normalizeBrazilianDocument,
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
  const [employee, cpf, pix] = await Promise.all([
    employeeRef.get(),
    employeeRef.collection("field_values").doc("employee.cpf").get(),
    employeeRef.collection("field_values").doc("employee.pix_key").get(),
  ]);
  if (!employee.exists) throw new Error("Colaborador favorecido não encontrado.");
  if (employee.get("status") !== "active") throw new Error("O colaborador favorecido está inativo.");
  const document = normalizeBrazilianDocument(fieldText(cpf.data()));
  const pixKey = fieldText(pix.data());
  if (document.length !== 11) throw new Error("O CPF do colaborador está incompleto.");
  if (!pixKey) throw new Error("O colaborador não possui chave Pix cadastrada.");
  return {
    sourceType: "employee",
    sourceId,
    name: String(employee.get("name") ?? employee.get("email") ?? "Colaborador"),
    document,
    paymentMethod: "pix_key",
    pixKeyType: inferPixKeyType(pixKey),
    pixKey,
    validated: true,
    sourceUpdatedAt: toIsoString(pix.get("updated_at") ?? employee.get("synced_at")) ?? new Date(0).toISOString(),
  };
}

async function resolveEntity(sourceId: string): Promise<ResolvedPaymentBeneficiary> {
  const [entity, profile] = await Promise.all([
    dbAdmin.collection("entities").doc(sourceId).get(),
    financialDbAdmin.collection("supplierPaymentProfiles").doc(sourceId).get(),
  ]);
  if (!entity.exists) throw new Error("Pessoa ou empresa favorecida não encontrada.");
  if (entity.get("status") === "inactive") throw new Error("A pessoa ou empresa favorecida está inativa.");
  if (!profile.exists || profile.get("active") === false) throw new Error("O perfil de pagamento do favorecido está ausente ou inativo.");
  if (!profile.get("validatedAt")) throw new Error("Os dados de pagamento do favorecido ainda não foram validados.");
  const entityDocument = normalizeBrazilianDocument(entity.get("document") ?? entity.get("cnpj"));
  const holderDocument = normalizeBrazilianDocument(profile.get("holderDocument"));
  if (![11, 14].includes(entityDocument.length) || holderDocument !== entityDocument) {
    throw new Error("O CPF/CNPJ do titular não corresponde ao cadastro do favorecido.");
  }
  const paymentData = decryptPaymentDestination(String(profile.get("encryptedPaymentData") ?? ""));
  const paymentMethod = profile.get("paymentMethod") as ResolvedPaymentBeneficiary["paymentMethod"];
  return {
    sourceType: "entity",
    sourceId,
    name: String(entity.get("name") ?? entity.get("razao_social") ?? "Favorecido"),
    document: entityDocument,
    paymentMethod,
    pixKeyType: profile.get("pixKeyType") ?? undefined,
    pixKey: paymentData.pixKey,
    pixCopyPaste: paymentData.pixCopyPaste,
    bankDetails: paymentData.bankDetails,
    validated: true,
    sourceUpdatedAt: String(profile.get("updatedAt") ?? new Date(0).toISOString()),
  };
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
    paymentMethod: resolved.paymentMethod,
    pixKeyType: resolved.pixKeyType,
    maskedPaymentDestination: destination,
    sourceUpdatedAt: resolved.sourceUpdatedAt,
    resolvedAt,
  };
}
