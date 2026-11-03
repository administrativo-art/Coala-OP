import { provenPlaceholder, readOnboardingPerson, record } from "./onboarding-person";
/** A person identifier is meaningful only together with its source namespace. */
export type SubjectRef = { namespace: "main.users" | "hr.employees" | "hr.candidates" | "hr.onboardingPersons"; id: string };
export type PersonResolution = { refs: SubjectRef[]; conflicts: string[]; gaps?: string[] };

/** Invalid legacy values remain unlinked; display text never becomes an identity. */
export function readSubjectRef(value: unknown): SubjectRef | null {
  if (!value || typeof value !== "object") return null;
  const { namespace, id } = value as Record<string, unknown>;
  if (namespace !== "main.users" && namespace !== "hr.employees" && namespace !== "hr.candidates" && namespace !== "hr.onboardingPersons") return null;
  if (typeof id !== "string" || !id || id.length > 180 || id.trim() !== id || id.includes("/")) return null;
  return { namespace, id };
}

export type PersonProcess = Record<string, unknown> & { id: string; candidateId?: string | null; collaboratorUserId?: string | null };
export interface PersonLookup {
  onboardingPerson?(id: string): Promise<{ id: string; processId: string; process: PersonProcess } | null>;
  processById?(id: string): Promise<PersonProcess | null>;
  user(id: string): Promise<{ id: string; hrEmployeeId?: string | null; recruitmentCandidateId?: string | null; onboardingId?: string | null; source?: string | null; onboardingPersonRef?: SubjectRef | null; onboardingProvisioningId?: string | null } | null>;
  employee(id: string): Promise<{ id: string; auth_uid?: string | null; source_user_id?: string | null; onboardingPersonRef?: SubjectRef | null; onboardingProvisioningId?: string | null; onboardingId?: string | null } | null>;
  candidate(id: string): Promise<{ id: string } | null>;
  processesByUser(id: string): Promise<PersonProcess[]>;
  processesByCandidate(id: string): Promise<PersonProcess[]>;
  usersByEmployee(id: string): Promise<Array<{ id: string; hrEmployeeId?: string | null }>>;
  employeesByUser(id: string): Promise<Array<{ id: string; auth_uid?: string | null; source_user_id?: string | null }>>;
}

export function subjectKey(ref: SubjectRef): string {
  if (ref.namespace !== "main.users" && ref.namespace !== "hr.employees" && ref.namespace !== "hr.candidates" && ref.namespace !== "hr.onboardingPersons") throw new Error("Namespace pessoal inválido.");
  if (!ref.id.trim() || ref.id !== ref.id.trim() || ref.id.includes("/")) throw new Error("Identificador pessoal inválido.");
  return `${ref.namespace}:${ref.id}`;
}

/** Only a unique, reciprocal UID/employee link can add an equivalent reference. */
export async function resolveStrictPersonRefs(ref: SubjectRef, lookup: PersonLookup): Promise<PersonResolution> {
  subjectKey(ref);
  const refs: SubjectRef[] = [ref];
  const conflicts: string[] = [];
  const gaps: string[] = [];
  if (ref.namespace === "hr.onboardingPersons") {
    const owned = await lookup.onboardingPerson?.(ref.id);
    const identity = owned ? readOnboardingPerson(owned.process, owned.processId) : null;
    if (!owned || !identity || identity.ref.id !== ref.id) return { refs, conflicts: ["onboarding_person_missing"] };
    const link = identity.provisioningLink;
    if (link) {
      const user = await lookup.user(link.uid);
      const checkpoint = record(owned.process.personProvisioning);
      if (!user || subjectKey(user.onboardingPersonRef ?? { namespace: "hr.onboardingPersons", id: "unlinked" }) !== subjectKey(ref)
        || user.onboardingId !== owned.processId || user.onboardingProvisioningId !== link.operationId || checkpoint.operationId !== link.operationId
        || checkpoint.uid !== link.uid || checkpoint.hrEmployeeId !== link.hrEmployeeId || owned.process.collaboratorUserId !== link.uid) conflicts.push("onboarding_person_not_reciprocal");
      else {
        const linked = await resolveStrictPersonRefs({ namespace: "main.users", id: link.uid }, lookup);
        for (const extra of linked.refs) if (!refs.some((item) => subjectKey(item) === subjectKey(extra))) refs.push(extra);
        conflicts.push(...linked.conflicts);
      }
    }
    return { refs, conflicts };
  }
  if (ref.namespace === "hr.candidates") {
    if (!await lookup.candidate(ref.id)) return { refs, conflicts: ["candidate_missing"] };
    const processes = await lookup.processesByCandidate(ref.id);
    const uids = [...new Set(processes.map((process) => process.collaboratorUserId).filter((value): value is string => Boolean(value)))];
    if (uids.length > 1) conflicts.push("candidate_user_collision");
    else if (uids.length === 1) {
      const user = await lookup.user(uids[0]);
      if (!user || user.recruitmentCandidateId !== ref.id) conflicts.push("candidate_not_reciprocal");
      else {
        refs.push({ namespace: "main.users", id: user.id });
        const linked = await resolveStrictPersonRefs({ namespace: "main.users", id: user.id }, lookup);
        for (const extra of linked.refs) if (!refs.some((current) => subjectKey(current) === subjectKey(extra))) refs.push(extra);
        conflicts.push(...linked.conflicts);
      }
    }
    return { refs, conflicts };
  }
  if (ref.namespace === "main.users") {
    const user = await lookup.user(ref.id);
    if (!user) return { refs, conflicts: ["user_missing"] };
    const [byUser, byDeclared] = await Promise.all([
      lookup.employeesByUser(ref.id),
      user.hrEmployeeId ? lookup.employee(user.hrEmployeeId) : Promise.resolve(null),
    ]);
    if (byUser.length > 1) conflicts.push("employee_uid_collision");
    if (user.hrEmployeeId) {
      const users = await lookup.usersByEmployee(user.hrEmployeeId);
      if (users.length !== 1 || users[0]?.id !== ref.id) conflicts.push("employee_claim_collision");
      if (!byDeclared) conflicts.push("employee_missing");
      else if (byDeclared.auth_uid && byDeclared.source_user_id && byDeclared.auth_uid !== byDeclared.source_user_id) conflicts.push("employee_uid_conflict");
      else if (byDeclared && byDeclared.auth_uid !== ref.id && byDeclared.source_user_id !== ref.id) conflicts.push("employee_not_reciprocal");
      if (byUser.some((candidate) => candidate.id !== user.hrEmployeeId)) conflicts.push("employee_uid_conflict");
      if (!conflicts.length) refs.push({ namespace: "hr.employees", id: user.hrEmployeeId });
    } else if (byUser.length) conflicts.push("user_not_reciprocal");
    if (user.onboardingPersonRef) {
      const own = user.onboardingPersonRef;
      const owned = own.namespace === "hr.onboardingPersons" ? await lookup.onboardingPerson?.(own.id) : null;
      const identity = owned ? readOnboardingPerson(owned.process, owned.processId) : null;
      const link = identity?.provisioningLink, checkpoint = record(owned?.process.personProvisioning);
      if (!owned || !identity || !link || link.uid !== ref.id || link.hrEmployeeId !== user.hrEmployeeId || user.onboardingId !== owned.processId
        || user.onboardingProvisioningId !== link.operationId || byDeclared?.onboardingProvisioningId !== link.operationId || byDeclared?.onboardingId !== owned.processId
        || byDeclared?.onboardingPersonRef?.id !== own.id || checkpoint.operationId !== link.operationId || checkpoint.uid !== ref.id
        || owned.process.collaboratorUserId !== ref.id) conflicts.push("onboarding_person_not_reciprocal");
      else refs.push(own);
    }
    if (user.recruitmentCandidateId) {
      const [candidate, byUserProcess, byCandidateProcess] = await Promise.all([
        lookup.candidate(user.recruitmentCandidateId), lookup.processesByUser(ref.id), lookup.processesByCandidate(user.recruitmentCandidateId),
      ]);
      const matching = byUserProcess.some((process) => process.candidateId === user.recruitmentCandidateId && process.collaboratorUserId === ref.id);
      const claimants = [...new Set(byCandidateProcess.map((process) => process.collaboratorUserId).filter(Boolean))];
      // Legacy native intake stored a process placeholder here. It is a compatibility
      // gap, not a candidate and not a reason to invalidate a proven UID/HR pair.
      const originProcess = user.onboardingId && lookup.processById ? await lookup.processById(user.onboardingId) : null;
      const placeholder = !candidate && user.source === "recruitment_onboarding" && originProcess && originProcess.collaboratorUserId === ref.id
        && provenPlaceholder(originProcess, user.recruitmentCandidateId);
      if (placeholder) gaps.push("native_intake_placeholder");
      else if (!candidate || !matching || claimants.length !== 1 || claimants[0] !== ref.id) conflicts.push("candidate_not_reciprocal");
      else refs.push({ namespace: "hr.candidates", id: user.recruitmentCandidateId });
    }
  } else {
    const employee = await lookup.employee(ref.id);
    if (!employee) return { refs, conflicts: ["employee_missing"] };
    const uid = employee.auth_uid || employee.source_user_id;
    if (employee.auth_uid && employee.source_user_id && employee.auth_uid !== employee.source_user_id) conflicts.push("employee_uid_conflict");
    if (uid) {
      const [user, employees] = await Promise.all([lookup.user(uid), lookup.employeesByUser(uid)]);
      if (!user) conflicts.push("user_missing");
      else if (user.hrEmployeeId !== ref.id) conflicts.push("user_not_reciprocal");
      if (employees.length !== 1 || employees[0]?.id !== ref.id) conflicts.push("employee_uid_collision");
      const claimants = await lookup.usersByEmployee(ref.id);
      if (claimants.length !== 1 || claimants[0]?.id !== uid) conflicts.push("employee_claim_collision");
      if (!conflicts.length) {
        refs.push({ namespace: "main.users", id: uid });
        const linked = await resolveStrictPersonRefs({ namespace: "main.users", id: uid }, lookup);
        for (const extra of linked.refs) if (!refs.some((current) => subjectKey(current) === subjectKey(extra))) refs.push(extra);
        conflicts.push(...linked.conflicts);
      }
    }
  }
  return { refs, conflicts, ...(gaps.length ? { gaps } : {}) };
}
