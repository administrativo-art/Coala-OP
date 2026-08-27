import "server-only";

import { createHash } from "node:crypto";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import {
  isValidCpf,
  normalizeCpf,
  normalizePersonName,
  type ExpectedEmployeeIdentity,
  type ExtractedIdentity,
} from "@/lib/hr/employee-document-match";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateText(s: FirebaseFirestore.DocumentSnapshot) {
  const value = s.get("value_date");
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
  }
  return asString(s.get("value_text"));
}

function cpfVariants(value: string): string[] {
  const cpf = normalizeCpf(value);
  const formatted = cpf.length === 11 ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : "";
  return Array.from(new Set([value.trim(), cpf, formatted].filter(Boolean))).slice(0, 10);
}

function registrationVariants(value?: string | null): string[] {
  const raw = value?.trim() ?? "";
  const digits = raw.replace(/\D/g, "");
  return Array.from(new Set([raw, digits].filter(Boolean))).slice(0, 10);
}

async function identityFromEmployeeSnap(emp: FirebaseFirestore.DocumentSnapshot): Promise<ExpectedEmployeeIdentity | null> {
  if (!emp.exists) return null;
  const [cpfSnap, birthSnap] = await Promise.all([
    emp.ref.collection("field_values").doc("employee.cpf").get(),
    emp.ref.collection("field_values").doc("employee.birth_date").get(),
  ]);
  const employeeId = asString(emp.get("auth_uid")) ?? emp.id;
  return {
    employeeId,
    cpf: cpfSnap.exists ? asString(cpfSnap.get("value_text")) : null,
    registrationNumber: asString(emp.get("bizneo_employee_id")),
    name: asString(emp.get("name")),
    birthDate: birthSnap.exists ? dateText(birthSnap) : null,
    admissionDate: null,
  };
}

/**
 * Identidade oficial do colaborador (CPF/matrícula/nome/nascimento) lida do RH.
 * É a base do match determinístico — a IA nunca é a fonte oficial do vínculo.
 * Retorna null quando o colaborador não está no RH.
 */
export async function loadExpectedIdentity(appUserId: string): Promise<ExpectedEmployeeIdentity | null> {
  try {
    const snap = await hrDbAdmin.collection("employees").where("auth_uid", "==", appUserId).limit(1).get();
    if (snap.empty) return null;
    const identity = await identityFromEmployeeSnap(snap.docs[0]);
    return identity ? { ...identity, employeeId: appUserId } : null;
  } catch {
    return null;
  }
}

export type LocatedEmployeeIdentity = ExpectedEmployeeIdentity & {
  matchedBy: "CPF" | "REGISTRATION" | "NAME_BIRTH" | "NAME_EXACT";
};

/**
 * Procura no quadro um colaborador que bata com os identificadores extraídos do
 * documento. Usado para detectar upload no perfil errado e sugerir redirecionar
 * o item para o dossiê correto.
 */
export async function findEmployeeIdentityByExtractedIdentity(
  extracted: ExtractedIdentity,
  excludeEmployeeId?: string,
): Promise<LocatedEmployeeIdentity | null> {
  const excluded = excludeEmployeeId ?? "";

  const cpf = normalizeCpf(extracted.cpf);
  if (cpf && isValidCpf(cpf)) {
    try {
      const snap = await hrDbAdmin.collectionGroup("field_values").where("value_text", "in", cpfVariants(cpf)).limit(20).get();
      for (const doc of snap.docs) {
        if (doc.id !== "employee.cpf" || normalizeCpf(doc.get("value_text")) !== cpf) continue;
        const employeeRef = doc.ref.parent.parent;
        if (!employeeRef) continue;
        const identity = await identityFromEmployeeSnap(await employeeRef.get());
        if (identity && identity.employeeId !== excluded) return { ...identity, matchedBy: "CPF" };
        if (identity && identity.employeeId === excluded) return { ...identity, matchedBy: "CPF" };
      }
    } catch {
      // Sem índice/consulta disponível: segue para matrícula/nome.
    }
  }

  const registrationValues = registrationVariants(extracted.registrationNumber);
  if (registrationValues.length > 0) {
    try {
      const snap = await hrDbAdmin.collection("employees").where("bizneo_employee_id", "in", registrationValues).limit(10).get();
      for (const doc of snap.docs) {
        const identity = await identityFromEmployeeSnap(doc);
        if (identity && identity.employeeId !== excluded) return { ...identity, matchedBy: "REGISTRATION" };
        if (identity && identity.employeeId === excluded) return { ...identity, matchedBy: "REGISTRATION" };
      }
    } catch {
      // Continua para nome + nascimento.
    }
  }

  const extractedName = normalizePersonName(extracted.name);
  if (extractedName && extracted.birthDate) {
    try {
      const snap = await hrDbAdmin.collection("employees").limit(500).get();
      for (const doc of snap.docs) {
        const identity = await identityFromEmployeeSnap(doc);
        if (!identity?.name || !identity.birthDate) continue;
        if (normalizePersonName(identity.name) !== extractedName || identity.birthDate !== extracted.birthDate) continue;
        if (identity.employeeId !== excluded) return { ...identity, matchedBy: "NAME_BIRTH" };
        return { ...identity, matchedBy: "NAME_BIRTH" };
      }
    } catch {
      return null;
    }
  }

  if (extractedName) {
    try {
      const snap = await hrDbAdmin.collection("employees").limit(500).get();
      const matches: LocatedEmployeeIdentity[] = [];
      for (const doc of snap.docs) {
        const identity = await identityFromEmployeeSnap(doc);
        if (!identity?.name || normalizePersonName(identity.name) !== extractedName) continue;
        matches.push({ ...identity, matchedBy: "NAME_EXACT" });
      }
      const otherMatches = matches.filter((identity) => identity.employeeId !== excluded);
      if (otherMatches.length === 1) return otherMatches[0];
      if (matches.length === 1) return matches[0];
    } catch {
      return null;
    }
  }

  return null;
}

/** Código do colaborador para nomenclatura (matrícula ou fallback técnico). */
export function employeeCodeFrom(identity: ExpectedEmployeeIdentity | null, fallbackId: string): string {
  return identity?.registrationNumber?.trim() || `UID-${fallbackId.slice(0, 8)}`;
}

/** SHA-256 do conteúdo (duplicidade exata). */
export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
