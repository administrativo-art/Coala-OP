import "server-only";

import { dbAdmin } from "@/lib/firebase-admin";

export type CompanyEmailPurpose = "onboarding" | "termination" | "aso";

export type CompanyProcessContact = {
  entityId: string;
  companyName: string;
  department: string;
  email: string;
  purpose: CompanyEmailPurpose;
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

export async function resolveCompanyProcessContact(purpose: CompanyEmailPurpose): Promise<CompanyProcessContact | null> {
  const snapshot = await dbAdmin.collection("entities").get();
  const matches = snapshot.docs.flatMap((document) => {
    if (document.get("status") === "inactive") return [];
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
      } satisfies CompanyProcessContact];
    });
  });

  if (matches.length > 1) {
    throw new Error(`Há mais de um e-mail de empresa marcado para ${purpose}. Revise os cadastros antes de continuar.`);
  }
  return matches[0] ?? null;
}
