import "server-only";

import { createHash } from "node:crypto";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import type { ExpectedEmployeeIdentity } from "@/lib/hr/employee-document-match";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
    const emp = snap.docs[0];
    const [cpfSnap, birthSnap] = await Promise.all([
      emp.ref.collection("field_values").doc("employee.cpf").get(),
      emp.ref.collection("field_values").doc("employee.birth_date").get(),
    ]);
    const dateText = (s: FirebaseFirestore.DocumentSnapshot) => {
      const value = s.get("value_date");
      if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
        return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
      }
      return asString(s.get("value_text"));
    };
    return {
      employeeId: appUserId,
      cpf: cpfSnap.exists ? asString(cpfSnap.get("value_text")) : null,
      registrationNumber: asString(emp.get("bizneo_employee_id")),
      name: asString(emp.get("name")),
      birthDate: birthSnap.exists ? dateText(birthSnap) : null,
      admissionDate: null,
    };
  } catch {
    return null;
  }
}

/** Código do colaborador para nomenclatura (matrícula ou fallback técnico). */
export function employeeCodeFrom(identity: ExpectedEmployeeIdentity | null, fallbackId: string): string {
  return identity?.registrationNumber?.trim() || `UID-${fallbackId.slice(0, 8)}`;
}

/** SHA-256 do conteúdo (duplicidade exata). */
export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
