import { onboardingOrigin, processSubjectRef } from "./onboarding-person";
import { resolveStrictPersonRefs, subjectKey, type PersonLookup, type SubjectRef } from "./person-subject";

export async function preflightPersonKeys(ref: SubjectRef, lookup: PersonLookup): Promise<string[]> {
  const result = await resolveStrictPersonRefs(ref, lookup);
  if (result.conflicts.length) throw new Error("Vínculo pessoal não confirmado para nova gravação.");
  return result.refs.map(subjectKey);
}
export async function preflightIdentifierKeys(id: string, lookup: PersonLookup): Promise<string[]> {
  subjectKey({ namespace: "main.users", id });
  const [main, hr] = await Promise.all([lookup.user(id), lookup.employee(id)]);
  if (!main && !hr) throw new Error("Identificador pessoal sem cadastro confirmado.");
  const keys = await preflightPersonKeys({ namespace: main ? "main.users" : "hr.employees", id }, lookup);
  if (main && hr && !keys.includes(`hr.employees:${id}`)) throw new Error("Identificador literal colide entre cadastros sem vínculo confirmado.");
  return keys;
}
/** A document has one subject. Process identifiers must resolve to that same person. */
export async function preflightDocumentKeys(input: { employeeId?: string | null; process?: Record<string, unknown> | null }, lookup: PersonLookup): Promise<string[]> {
  const groups: string[][] = [];
  const process = input.process;
  if (process) {
    const origin = onboardingOrigin(process);
    if (origin === "pj-company") return []; // Legal entity is not its sender/signatory/access user.
    const own = processSubjectRef(process);
    if (!own) throw new Error("Origem pessoal da admissão não comprovada.");
    groups.push(await preflightPersonKeys(own, lookup));
    const uid = process.collaboratorUserId;
    if (typeof uid === "string" && uid) groups.push(await preflightPersonKeys({ namespace: "main.users", id: uid }, lookup));
  }
  if (input.employeeId) groups.push(await preflightIdentifierKeys(input.employeeId, lookup));
  if (process && input.employeeId && input.employeeId !== process.employeeId && input.employeeId !== process.collaboratorUserId) throw new Error("Titular diverge do processo de integração.");
  if (!groups.length) return [];
  const canonical = new Set(groups[0]);
  if (groups.some((group) => group.some((key) => !canonical.has(key)) || !group.some((key) => canonical.has(key)))) throw new Error("Processo contém titulares pessoais incompatíveis.");
  return [...canonical];
}
