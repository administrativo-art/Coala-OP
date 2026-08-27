import "server-only";

import { dbAdmin } from "@/lib/firebase-admin";

export type CompanyDocumentSignatory = {
  entityId: string;
  userId: string | null;
  name: string;
  email: string;
  scope: "entity" | "cnpj_root";
};

function text(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function companyCnpjRoot(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 14 ? digits.slice(0, 8) : "";
}

function entityCnpj(data: FirebaseFirestore.DocumentData) {
  return text(data.cnpj, data.document);
}

async function signatoryFromEntity(
  entity: FirebaseFirestore.DocumentSnapshot,
): Promise<CompanyDocumentSignatory | null> {
  if (!entity.exists) return null;
  const userId = text(entity.get("documentSignatoryUserId")) || null;
  const user = userId
    ? await dbAdmin.collection("users").doc(userId).get()
    : null;
  const name = text(
    user?.get("documentSignatureName"),
    entity.get("documentSignatoryName"),
    user?.get("username"),
    user?.get("name"),
  );
  const email = text(
    user?.get("documentSignatureEmail"),
    entity.get("documentSignatoryEmail"),
    user?.get("email"),
  ).toLocaleLowerCase("pt-BR");
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return {
    entityId: entity.id,
    userId,
    name,
    email,
    scope: entity.get("documentSignatoryScope") === "cnpj_root"
      ? "cnpj_root"
      : "entity",
  };
}

export async function resolveCompanyDocumentSignatory(params: {
  entityId?: unknown;
  cnpj?: unknown;
}) {
  const entityId = text(params.entityId);
  if (entityId) {
    const exact = await dbAdmin.collection("entities").doc(entityId).get();
    const resolved = await signatoryFromEntity(exact);
    if (resolved) return resolved;
  }

  const digits = String(params.cnpj ?? "").replace(/\D/g, "");
  if (digits.length !== 14) return null;
  const root = companyCnpjRoot(digits);
  const candidates = await dbAdmin.collection("entities")
    .where("cnpjRoot", "==", root)
    .get();
  for (const candidate of candidates.docs) {
    if (
      candidate.get("documentSignatoryScope") === "cnpj_root"
      || entityCnpj(candidate.data()).replace(/\D/g, "") === digits
    ) {
      const resolved = await signatoryFromEntity(candidate);
      if (resolved) return resolved;
    }
  }

  // Compatibilidade com cadastros anteriores ao campo cnpjRoot.
  const legacy = await dbAdmin.collection("entities").get();
  for (const candidate of legacy.docs) {
    const candidateDigits = entityCnpj(candidate.data()).replace(/\D/g, "");
    if (
      candidateDigits === digits
      || (
        candidate.get("documentSignatoryScope") === "cnpj_root"
        && companyCnpjRoot(candidateDigits) === root
      )
    ) {
      const resolved = await signatoryFromEntity(candidate);
      if (resolved) return resolved;
    }
  }
  return null;
}
