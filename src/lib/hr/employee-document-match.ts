/**
 * Correspondência determinística do colaborador (feita no backend, não pela IA).
 *
 * A IA apenas informa os identificadores extraídos do documento (CPF, matrícula,
 * nome). Quem decide se o documento pertence ao colaborador é este serviço, com
 * regras estáveis e testáveis. Um upload iniciado no perfil de alguém NÃO força
 * a correspondência: o CPF do documento é comparado ao CPF cadastrado.
 *
 * Módulo puro (sem Firestore) para ser testado isoladamente.
 */

export type EmployeeMatchStatus = "MATCH" | "POSSIBLE_MATCH" | "MISMATCH" | "UNKNOWN";

export interface ExtractedIdentity {
  cpf?: string | null;
  registrationNumber?: string | null;
  internalCode?: string | null;
  name?: string | null;
  birthDate?: string | null;      // AAAA-MM-DD
  admissionDate?: string | null;  // AAAA-MM-DD
}

export interface ExpectedEmployeeIdentity {
  employeeId: string;
  cpf?: string | null;
  registrationNumber?: string | null;
  internalCode?: string | null;
  name?: string | null;
  birthDate?: string | null;
  admissionDate?: string | null;
}

export interface EmployeeMatchResult {
  status: EmployeeMatchStatus;
  reason: string;
  matchedBy: "CPF" | "REGISTRATION" | "INTERNAL_CODE" | "NAME_CORROBORATED" | "NAME_SIMILAR" | "NONE";
}

/** Mantém apenas dígitos. */
export function normalizeCpf(value?: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Valida CPF por dígito verificador (rejeita sequências repetidas). */
export function isValidCpf(value?: string | null): boolean {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digit = (sliceLength: number) => {
    let sum = 0;
    for (let i = 0; i < sliceLength; i++) {
      sum += Number(cpf[i]) * (sliceLength + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/** Normaliza nome para comparação: sem acentos, minúsculo, espaços colapsados. */
export function normalizePersonName(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function digitsOnly(value?: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}

function sameNonEmpty(a: string, b: string): boolean {
  return a.length > 0 && a === b;
}

/**
 * Verifica se o documento pertence ao colaborador esperado (contexto de perfil).
 *
 * Ordem: CPF → matrícula → código interno → nome + dado corroborante → nome
 * semelhante. CPF válido que difere do esperado gera MISMATCH (bloqueia).
 */
export function matchEmployeeAgainstExpected(input: {
  extracted: ExtractedIdentity;
  expected: ExpectedEmployeeIdentity;
}): EmployeeMatchResult {
  const { extracted, expected } = input;

  // 1) CPF — identificador mais forte.
  const extractedCpf = normalizeCpf(extracted.cpf);
  if (extractedCpf) {
    if (!isValidCpf(extractedCpf)) {
      // CPF ilegível/ inválido não confirma nem descarta sozinho; segue as demais regras.
    } else {
      const expectedCpf = normalizeCpf(expected.cpf);
      if (expectedCpf && extractedCpf === expectedCpf) {
        return { status: "MATCH", reason: "CPF coincidente.", matchedBy: "CPF" };
      }
      if (expectedCpf && extractedCpf !== expectedCpf) {
        return { status: "MISMATCH", reason: "CPF pertence a outro colaborador.", matchedBy: "CPF" };
      }
      // Colaborador esperado sem CPF cadastrado: não é possível confirmar por CPF.
    }
  }

  // 2) Matrícula.
  const extractedReg = digitsOnly(extracted.registrationNumber) || (extracted.registrationNumber ?? "").trim();
  const expectedReg = digitsOnly(expected.registrationNumber) || (expected.registrationNumber ?? "").trim();
  if (sameNonEmpty(extractedReg, expectedReg)) {
    return { status: "MATCH", reason: "Matrícula coincidente.", matchedBy: "REGISTRATION" };
  }

  // 3) Código interno.
  const extractedCode = (extracted.internalCode ?? "").trim().toLowerCase();
  const expectedCode = (expected.internalCode ?? "").trim().toLowerCase();
  if (sameNonEmpty(extractedCode, expectedCode)) {
    return { status: "MATCH", reason: "Código interno coincidente.", matchedBy: "INTERNAL_CODE" };
  }

  // 4/5) Nome — só confirma com dado corroborante; sozinho é apenas possível.
  const extractedName = normalizePersonName(extracted.name);
  const expectedName = normalizePersonName(expected.name);
  if (extractedName && expectedName && extractedName === expectedName) {
    const birthMatches = !!extracted.birthDate && extracted.birthDate === expected.birthDate;
    const admissionMatches = !!extracted.admissionDate && extracted.admissionDate === expected.admissionDate;
    if (birthMatches || admissionMatches) {
      return { status: "MATCH", reason: "Nome completo + data corroborante.", matchedBy: "NAME_CORROBORATED" };
    }
    return { status: "POSSIBLE_MATCH", reason: "Nome completo coincidente, sem dado corroborante.", matchedBy: "NAME_SIMILAR" };
  }
  if (extractedName && expectedName && namesAreSimilar(extractedName, expectedName)) {
    return { status: "POSSIBLE_MATCH", reason: "Nome semelhante.", matchedBy: "NAME_SIMILAR" };
  }

  return { status: "UNKNOWN", reason: "Sem identificadores suficientes.", matchedBy: "NONE" };
}

/** Similaridade simples por sobreposição de tokens (nome semelhante ≠ confirmação). */
export function namesAreSimilar(a: string, b: string): boolean {
  const ta = new Set(a.split(" ").filter((t) => t.length > 1));
  const tb = new Set(b.split(" ").filter((t) => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const smaller = Math.min(ta.size, tb.size);
  return shared / smaller >= 0.5;
}
