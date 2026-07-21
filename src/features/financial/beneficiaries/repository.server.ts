import type { z } from "zod";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import {
  inferPixKeyType,
  maskBrazilianDocument,
  maskPaymentDestination,
  normalizeBrazilianDocument,
  toIsoString,
} from "./normalization";
import { encryptPaymentDestination } from "./security.server";
import { supplierPaymentProfileInputSchema } from "./schemas";
import type {
  BeneficiaryListItem,
  ProtectedPaymentDestination,
  SupplierPaymentProfile,
} from "./types";

const PROFILE_COLLECTION = "supplierPaymentProfiles";

type ProfileInput = z.infer<typeof supplierPaymentProfileInputSchema>;
type Actor = { uid: string; name?: string | null; email?: string | null };

function valueText(data: FirebaseFirestore.DocumentData | undefined) {
  return typeof data?.value_text === "string" ? data.value_text.trim() : "";
}

function profileForList(
  id: string,
  entity: FirebaseFirestore.DocumentData,
  profile?: FirebaseFirestore.DocumentData,
): BeneficiaryListItem {
  const active = entity.status !== "inactive" && profile?.active !== false;
  return {
    reference: { sourceType: "entity", sourceId: id },
    name: String(entity.name ?? entity.razao_social ?? entity.fantasyName ?? "Pessoa/empresa sem nome"),
    documentMasked: maskBrazilianDocument(entity.document ?? entity.cnpj),
    active,
    paymentMethod: profile?.paymentMethod,
    pixKeyType: profile?.pixKeyType,
    maskedPaymentDestination: profile?.maskedPaymentDestination,
    configured: Boolean(profile?.encryptedPaymentData),
    validated: Boolean(profile?.validatedAt),
    sourceUpdatedAt: toIsoString(profile?.updatedAt ?? entity.updatedAt ?? entity.createdAt),
  };
}

async function employeeBeneficiaries(): Promise<BeneficiaryListItem[]> {
  const employees = await hrDbAdmin.collection("employees").get();
  const result: BeneficiaryListItem[] = [];

  for (let offset = 0; offset < employees.docs.length; offset += 150) {
    const group = employees.docs.slice(offset, offset + 150);
    const references = group.flatMap((employee) => [
      employee.ref.collection("field_values").doc("employee.cpf"),
      employee.ref.collection("field_values").doc("employee.pix_key"),
    ]);
    const values = references.length ? await hrDbAdmin.getAll(...references) : [];

    group.forEach((employee, index) => {
      const data = employee.data();
      const cpf = valueText(values[index * 2]?.data());
      const pixKey = valueText(values[index * 2 + 1]?.data());
      const status = String(data.status ?? "active");
      result.push({
        reference: { sourceType: "employee", sourceId: employee.id },
        name: String(data.name ?? data.email ?? "Colaborador sem nome"),
        documentMasked: maskBrazilianDocument(cpf),
        active: status === "active",
        paymentMethod: pixKey ? "pix_key" : undefined,
        pixKeyType: pixKey ? inferPixKeyType(pixKey) : undefined,
        maskedPaymentDestination: pixKey ? maskPaymentDestination(pixKey) : undefined,
        configured: Boolean(pixKey),
        validated: Boolean(pixKey && normalizeBrazilianDocument(cpf).length === 11),
        sourceUpdatedAt: toIsoString(values[index * 2 + 1]?.data()?.updated_at ?? data.synced_at),
      });
    });
  }

  return result;
}

export async function listPaymentBeneficiaries(params?: { includeEmployees?: boolean }) {
  const [entities, profiles, employees] = await Promise.all([
    dbAdmin.collection("entities").get(),
    financialDbAdmin.collection(PROFILE_COLLECTION).get(),
    params?.includeEmployees === false ? Promise.resolve([]) : employeeBeneficiaries(),
  ]);
  const profilesById = new Map(profiles.docs.map((document) => [document.id, document.data()]));
  const entityItems = entities.docs.map((document) =>
    profileForList(document.id, document.data(), profilesById.get(document.id)),
  );
  return [...employees, ...entityItems].sort((left, right) =>
    left.name.localeCompare(right.name, "pt-BR"),
  );
}

export async function getEntityPaymentProfile(entityId: string) {
  const [entity, profile] = await Promise.all([
    dbAdmin.collection("entities").doc(entityId).get(),
    financialDbAdmin.collection(PROFILE_COLLECTION).doc(entityId).get(),
  ]);
  if (!entity.exists) throw new Error("Pessoa ou empresa não encontrada.");
  return {
    beneficiary: profileForList(entityId, entity.data() ?? {}, profile.data()),
    profile: profile.exists
      ? {
          entityId,
          active: profile.get("active") !== false,
          paymentMethod: profile.get("paymentMethod"),
          pixKeyType: profile.get("pixKeyType") ?? null,
          maskedPaymentDestination: profile.get("maskedPaymentDestination") ?? null,
          holderName: profile.get("holderName") ?? "",
          holderDocumentMasked: maskBrazilianDocument(profile.get("holderDocument")),
          validated: Boolean(profile.get("validatedAt")),
          validatedAt: profile.get("validatedAt") ?? null,
          updatedAt: profile.get("updatedAt") ?? null,
          updatedBy: profile.get("updatedBy") ?? null,
        }
      : null,
  };
}

function protectedDestination(input: ProfileInput): ProtectedPaymentDestination | null {
  if (input.paymentMethod === "pix_key" && input.pixKey) return { pixKey: input.pixKey.trim() };
  if (input.paymentMethod === "pix_copy_paste" && input.pixCopyPaste) {
    return { pixCopyPaste: input.pixCopyPaste.trim() };
  }
  if (input.paymentMethod === "bank_details" && input.bankDetails) return { bankDetails: input.bankDetails };
  return null;
}

function destinationMask(input: ProfileInput, destination: ProtectedPaymentDestination | null) {
  if (input.paymentMethod === "pix_key") return maskPaymentDestination(destination?.pixKey);
  if (input.paymentMethod === "pix_copy_paste") return maskPaymentDestination(destination?.pixCopyPaste);
  if (destination?.bankDetails) {
    return `Banco ${destination.bankDetails.bankCode} · ag. ${maskPaymentDestination(destination.bankDetails.agency)} · conta ${maskPaymentDestination(destination.bankDetails.account)}`;
  }
  return "Destino bancário preservado";
}

export async function saveEntityPaymentProfile(entityId: string, input: ProfileInput, actor: Actor) {
  const normalizedHolderDocument = normalizeBrazilianDocument(input.holderDocument);
  if (![11, 14].includes(normalizedHolderDocument.length)) {
    throw new Error("CPF/CNPJ do titular inválido.");
  }

  const entityRef = dbAdmin.collection("entities").doc(entityId);
  const profileRef = financialDbAdmin.collection(PROFILE_COLLECTION).doc(entityId);
  const [entity, current] = await Promise.all([entityRef.get(), profileRef.get()]);
  if (!entity.exists) throw new Error("Pessoa ou empresa não encontrada.");
  if (entity.get("status") === "inactive") throw new Error("Não é possível configurar um cadastro inativo.");
  const entityDocument = normalizeBrazilianDocument(entity.get("document") ?? entity.get("cnpj"));
  if (entityDocument && entityDocument !== normalizedHolderDocument) {
    throw new Error("O CPF/CNPJ do titular deve corresponder ao cadastro da pessoa ou empresa.");
  }

  const destination = protectedDestination(input);
  if (!destination && (!input.keepExistingDestination || !current.exists)) {
    throw new Error("Informe o destino do pagamento.");
  }
  if (
    input.keepExistingDestination &&
    current.exists &&
    current.get("paymentMethod") !== input.paymentMethod
  ) {
    throw new Error("Informe novamente os dados ao alterar o meio de pagamento.");
  }

  const now = new Date().toISOString();
  const encryptedPaymentData = destination
    ? encryptPaymentDestination(destination)
    : String(current.get("encryptedPaymentData"));
  const maskedPaymentDestination = destination
    ? destinationMask(input, destination)
    : String(current.get("maskedPaymentDestination") ?? "Destino preservado");
  const validatedAt = input.validated ? now : null;
  const data: SupplierPaymentProfile = {
    entityId,
    active: input.active,
    paymentMethod: input.paymentMethod,
    ...(input.pixKeyType ? { pixKeyType: input.pixKeyType } : {}),
    encryptedPaymentData,
    maskedPaymentDestination,
    holderName: input.holderName,
    holderDocument: normalizedHolderDocument,
    validatedAt,
    validatedBy: input.validated ? actor.uid : null,
    createdAt: current.get("createdAt") ?? now,
    createdBy: current.get("createdBy") ?? actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  };

  await profileRef.set(data, { merge: false });
  await profileRef.collection("events").add({
    type: current.exists ? "payment_profile_updated" : "payment_profile_created",
    at: now,
    actorId: actor.uid,
    actorName: actor.name ?? null,
    actorEmail: actor.email ?? null,
    before: current.exists
      ? {
          active: current.get("active") !== false,
          paymentMethod: current.get("paymentMethod"),
          maskedPaymentDestination: current.get("maskedPaymentDestination"),
          validated: Boolean(current.get("validatedAt")),
        }
      : null,
    after: {
      active: data.active,
      paymentMethod: data.paymentMethod,
      maskedPaymentDestination: data.maskedPaymentDestination,
      validated: Boolean(data.validatedAt),
    },
  });
  return getEntityPaymentProfile(entityId);
}
