export type PersonRecordType = "employee" | "director" | "partner" | "pj" | "internship" | "test";

export type PersonLinkedUser = {
  id: string;
  hrEmployeeId?: string | null;
  registrationIdBizneo?: string | null;
};

/**
 * Identificador canônico do cadastro pessoal no banco do RH.
 *
 * `registrationIdBizneo` permanece apenas como compatibilidade para contas
 * anteriores à padronização. Novos fluxos devem persistir `hrEmployeeId`.
 */
export function getHrEmployeeId(user: PersonLinkedUser | null | undefined) {
  if (!user) return null;
  return user.hrEmployeeId?.trim()
    || user.registrationIdBizneo?.trim()
    || user.id?.trim()
    || null;
}

export function isOwnHrEmployeeId(
  user: PersonLinkedUser | null | undefined,
  employeeId: string | null | undefined,
) {
  const normalized = employeeId?.trim();
  if (!user || !normalized) return false;
  return normalized === user.id
    || normalized === user.hrEmployeeId
    || normalized === user.registrationIdBizneo;
}
