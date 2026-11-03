import assert from "node:assert/strict";
import test from "node:test";
import { readSubjectRef, resolveStrictPersonRefs, subjectKey, type PersonLookup, type PersonProcess } from "../../src/features/privacy/person-subject";

function lookup(users: Array<{ id: string; hrEmployeeId?: string; recruitmentCandidateId?: string; source?: string; onboardingId?: string }>, employees: Array<{ id: string; auth_uid?: string; source_user_id?: string }>, processes: PersonProcess[] = []): PersonLookup {
  return {
    async processById(id) { return processes.find((row) => row.id === id) ?? null; },
    async user(id) { return users.find((row) => row.id === id) ?? null; },
    async employee(id) { return employees.find((row) => row.id === id) ?? null; },
    async candidate(id) { return processes.some((process) => process.candidateId === id) ? { id } : null; },
    async processesByUser(id) { return processes.filter((process) => process.collaboratorUserId === id); },
    async processesByCandidate(id) { return processes.filter((process) => process.candidateId === id); },
    async usersByEmployee(id) { return users.filter((row) => row.hrEmployeeId === id); },
    async employeesByUser(id) { return employees.filter((row) => row.auth_uid === id || row.source_user_id === id); },
  };
}

test("reciprocal unique link is symmetric across namespaces", async () => {
  const db = lookup([{ id: "uid", hrEmployeeId: "rh" }], [{ id: "rh", auth_uid: "uid" }]);
  const fromUser = await resolveStrictPersonRefs({ namespace: "main.users", id: "uid" }, db);
  const fromEmployee = await resolveStrictPersonRefs({ namespace: "hr.employees", id: "rh" }, db);
  assert.deepEqual(fromUser.conflicts, []);
  assert.deepEqual(fromEmployee.conflicts, []);
  assert.deepEqual(fromUser.refs, [{ namespace: "main.users", id: "uid" }, { namespace: "hr.employees", id: "rh" }]);
  assert.deepEqual(fromEmployee.refs, [{ namespace: "hr.employees", id: "rh" }, { namespace: "main.users", id: "uid" }]);
});

test("candidate documents stay discoverable after account creation through explicit process and user claim", async () => {
  const db = lookup([{ id: "u", hrEmployeeId: "e", recruitmentCandidateId: "c" }], [{ id: "e", auth_uid: "u" }], [{ id: "p", source: "recruitment", candidateId: "c", collaboratorUserId: "u" }]);
  const fromUser = await resolveStrictPersonRefs({ namespace: "main.users", id: "u" }, db);
  const fromCandidate = await resolveStrictPersonRefs({ namespace: "hr.candidates", id: "c" }, db);
  assert.deepEqual(new Set(fromUser.refs.map(subjectKey)), new Set(["main.users:u", "hr.employees:e", "hr.candidates:c"]));
  assert.deepEqual(new Set(fromCandidate.refs.map(subjectKey)), new Set(["hr.candidates:c", "main.users:u", "hr.employees:e"]));
});

test("same literal ID in separate namespaces does not imply equivalence", async () => {
  const db = lookup([{ id: "same" }], [{ id: "same" }]);
  assert.notEqual(subjectKey({ namespace: "main.users", id: "same" }), subjectKey({ namespace: "hr.employees", id: "same" }));
  assert.deepEqual((await resolveStrictPersonRefs({ namespace: "main.users", id: "same" }, db)).refs, [{ namespace: "main.users", id: "same" }]);
});

test("collisions and differing employee UIDs never merge in either direction", async () => {
  const db = lookup([{ id: "u1", hrEmployeeId: "e" }, { id: "u2", hrEmployeeId: "e" }], [{ id: "e", auth_uid: "u1", source_user_id: "u2" }]);
  for (const ref of [{ namespace: "main.users", id: "u1" }, { namespace: "hr.employees", id: "e" }] as const) {
    const result = await resolveStrictPersonRefs(ref, db);
    assert.equal(result.refs.length, 1);
    assert.ok(result.conflicts.length);
  }
});

test("different reverse UID also conflicts without another claimant", async () => {
  const db = lookup([{ id: "u1", hrEmployeeId: "e" }], [{ id: "e", auth_uid: "u2", source_user_id: "u1" }]);
  assert.equal((await resolveStrictPersonRefs({ namespace: "main.users", id: "u1" }, db)).refs.length, 1);
});

test("invalid runtime namespace and slash ID are rejected", () => {
  assert.throws(() => subjectKey({ namespace: "other" as "main.users", id: "x" }));
  assert.throws(() => subjectKey({ namespace: "main.users", id: "x/y" }));
});

test("request serializers preserve only explicit valid person references", () => {
  assert.deepEqual(readSubjectRef({ namespace: "hr.employees", id: "immutable-id" }), { namespace: "hr.employees", id: "immutable-id" });
  for (const value of [null, "name@example.test", { namespace: "main.users", id: "bad/id" }, { namespace: "main.users", id: " spaced " }, { namespace: "main.users", id: "x".repeat(181) }, { namespace: "unknown", id: "immutable-id" }]) assert.equal(readSubjectRef(value), null);
});


test('new-write preflight rejects incompatible candidate/user process and literal collision without merging', async () => {
  const { preflightDocumentKeys, preflightPersonKeys, preflightIdentifierKeys } = await import('../../src/features/privacy/person-preflight');
  const incompatible = lookup([{ id: 'u' }], [], [{ id: 'p', source: 'recruitment', candidateId: 'c', collaboratorUserId: 'u' }]);
  await assert.rejects(preflightDocumentKeys({ process: { id: 'p', source: 'recruitment', candidateId: 'c', collaboratorUserId: 'u' } }, incompatible), /não confirmado/);
  const collision = lookup([{ id: 'same' }], [{ id: 'same' }]);
  await assert.rejects(preflightIdentifierKeys('same', collision), /colide/);
  assert.deepEqual(await preflightPersonKeys({ namespace: 'main.users', id: 'same' }, collision), ['main.users:same']);
  assert.deepEqual(await preflightPersonKeys({ namespace: 'hr.employees', id: 'same' }, collision), ['hr.employees:same']);
  const standalone = lookup([{ id: 'account-only' }], [], [{ id: 'p', source: 'recruitment', candidateId: 'candidate-only' }]);
  assert.deepEqual(await preflightDocumentKeys({ employeeId: 'account-only' }, standalone), ['main.users:account-only']);
  assert.deepEqual(await preflightDocumentKeys({ process: { id: 'p', source: 'recruitment', candidateId: 'candidate-only' } }, standalone), ['hr.candidates:candidate-only']);
});

for (const kind of ['manual', 'pj'] as const) test(`physical candidate sharing ${kind} routing alias stays independent in both directions`, async () => {
  const pid = `${kind}-process`, cid = `${kind}_${pid}`;
  const native: PersonProcess = { id: pid, source: 'manual', applicationId: null, jobOpeningId: null, candidateId: cid, collaboratorUserId: 'u', employeeId: 'u', jobRoleId: 'role', functionId: 'function', unitId: 'unit', employerUnitId: 'unit', employmentRelationshipType: kind === 'pj' ? 'pj' : 'clt', integrationV2: { snapshot: { schemaVersion: 'coala-integration-v1' } }, ...(kind === 'pj' ? { providerCnpj: '11444777000161', pjWorkflow: { version: 1, provider: { cnpj: '11444777000161' } } } : {}) };
  const processes = [native];
  const db = lookup([{ id: 'u', hrEmployeeId: 'e', recruitmentCandidateId: cid, source: 'recruitment_onboarding', onboardingId: pid }], [{ id: 'e', auth_uid: 'u' }], processes);
  assert.ok(await db.candidate(cid)); // A physically backed, independent candidate has this exact literal ID.
  for (const ref of [{ namespace: 'main.users', id: 'u' }, { namespace: 'hr.employees', id: 'e' }] as const) {
    const result = await resolveStrictPersonRefs(ref, db);
    assert.deepEqual(result.conflicts, []); assert.deepEqual(new Set(result.refs.map(subjectKey)), new Set(['main.users:u', 'hr.employees:e']));
  }
  const independent = await resolveStrictPersonRefs({ namespace: 'hr.candidates', id: cid }, db);
  assert.deepEqual(independent.refs, [{ namespace: 'hr.candidates', id: cid }]); assert.deepEqual(independent.conflicts, []);
  processes.push({ id: 'forged-recruitment', source: 'recruitment', candidateId: cid, collaboratorUserId: 'u' });
  const forged = await resolveStrictPersonRefs({ namespace: 'hr.candidates', id: cid }, db);
  assert.deepEqual(forged.refs, [{ namespace: 'hr.candidates', id: cid }]); assert.ok(forged.conflicts.includes('candidate_not_reciprocal'));
  const account = await resolveStrictPersonRefs({ namespace: 'main.users', id: 'u' }, db);
  assert.deepEqual(account.conflicts, []); assert.deepEqual(new Set(account.refs.map(subjectKey)), new Set(['main.users:u', 'hr.employees:e']));
});

test('a routing prefix without compatible native origin never confirms candidate/account equivalence', async () => {
  const db = lookup([{ id: 'u', hrEmployeeId: 'e', recruitmentCandidateId: 'manual_p', source: 'recruitment_onboarding', onboardingId: 'p' }], [{ id: 'e', auth_uid: 'u' }], [{ id: 'p', source: 'manual', applicationId: 'incompatible-application', jobOpeningId: null, candidateId: 'manual_p', collaboratorUserId: 'u' }]);
  const account = await resolveStrictPersonRefs({ namespace: 'main.users', id: 'u' }, db);
  assert.ok(account.conflicts.includes('candidate_not_reciprocal')); assert.equal(account.refs.some((ref) => ref.namespace === 'hr.candidates'), false);
  const candidate = await resolveStrictPersonRefs({ namespace: 'hr.candidates', id: 'manual_p' }, db);
  assert.deepEqual(candidate.refs, [{ namespace: 'hr.candidates', id: 'manual_p' }]); assert.ok(candidate.conflicts.includes('candidate_process_origin_unconfirmed'));
});
