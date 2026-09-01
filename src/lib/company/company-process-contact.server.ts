import "server-only";

import { dbAdmin } from "@/lib/firebase-admin";

export type CompanyEmailPurpose = "onboarding" | "termination" | "aso" | "vacation";

export type CompanyProcessContact = {
  entityId: string;
  companyName: string;
  department: string;
  email: string;
  purpose: CompanyEmailPurpose;
  companyCnpj?: string;
};

function validEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function contactsFromDocuments(
  documents: FirebaseFirestore.DocumentSnapshot[],
  purpose: CompanyEmailPurpose,
) {
  return documents.flatMap((document) => {
    if (!document.exists || document.get("status") === "inactive") return [];
    const contact = document.get("contact");
    const emails = contact && typeof contact === "object" && !Array.isArray(contact)
      ? records((contact as Record<string, unknown>).emails)
      : [];
    return emails.flatMap((entry) => {
      const purposes = Array.isArray(entry.purposes) ? entry.purposes.filter((value): value is string => typeof value === "string") : [];
      const email = validEmail(entry.email);
      if (!email || !purposes.includes(purpose)) return [];
      return [{
        entityId: document.id,
        companyName: String(document.get("fantasyName") ?? document.get("name") ?? "Empresa"),
        department: String(entry.department ?? "Contato"),
        email,
        purpose,
        companyCnpj: String(document.get("cnpj") ?? document.get("document") ?? "").replace(/\D/g, ""),
      } satisfies CompanyProcessContact];
    });
  });
}

export async function resolveCompanyProcessContact(
  purpose: CompanyEmailPurpose,
  company?: { entityId?: unknown; cnpj?: unknown } | null,
): Promise<CompanyProcessContact | null> {
  const entityId = typeof company?.entityId === "string" ? company.entityId.trim() : "";
  const cnpj = String(company?.cnpj ?? "").replace(/\D/g, "");
  let documents: FirebaseFirestore.DocumentSnapshot[];
  if (entityId) {
    documents = [await dbAdmin.collection("entities").doc(entityId).get()];
  } else if (cnpj.length === 14) {
    const [byCnpj, byDocument] = await Promise.all([
      dbAdmin.collection("entities").where("cnpj", "==", cnpj).limit(3).get(),
      dbAdmin.collection("entities").where("documentNormalized", "==", cnpj).limit(3).get(),
    ]);
    documents = [...new Map(
      [...byCnpj.docs, ...byDocument.docs].map((document) => [document.id, document]),
    ).values()];
  } else {
    const snapshot = await dbAdmin.collection("entities").limit(100).get();
    if (snapshot.size >= 100) {
      throw new Error(`Há muitas empresas para localizar o e-mail marcado para ${purpose}. Informe a empresa do processo.`);
    }
    documents = snapshot.docs;
  }
  const matches = contactsFromDocuments(documents, purpose);
  const scoped = matches.filter((match) => (
    (!entityId && cnpj.length !== 14)
    || (Boolean(entityId) && match.entityId === entityId)
    || (cnpj.length === 14 && match.companyCnpj === cnpj)
  ));
  if (scoped.length > 1) {
    throw new Error(`Há mais de um e-mail marcado para ${purpose} no CNPJ informado. Revise o cadastro da empresa.`);
  }
  if (scoped[0]) return scoped[0];
  if (entityId || cnpj.length === 14) return null;

  if (matches.length > 1) {
    throw new Error(`Há mais de um e-mail de empresa marcado para ${purpose}. Revise os cadastros antes de continuar.`);
  }
  return matches[0] ?? null;
}
