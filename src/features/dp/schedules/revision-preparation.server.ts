import 'server-only';

import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';

type RevisionEntry = { id: string; value: DocumentData };
type RevisionPerson = { userId: string; shifts: Array<DocumentData & { id: string }> };
type RevisionReference = { id: string; value: DocumentData };
type Candidate = { userId: string; competence: string };
export type PreparedRevision = {
  scheduleRef: DocumentReference;
  revisionId: string;
  identity: {
    draftGenerationId: string; draftVersion: number; operationalVersion: number;
    publicationVersion: number; baseRevisionId: string | null;
  };
  entries: RevisionEntry[];
  people: RevisionPerson[];
  references: RevisionReference[];
  candidates: Candidate[];
};

const CHUNK_SIZE = 180;
const MAX_ENTRIES = 2_000;
const MAX_CHANGED = 500;
const MAX_PERSON_SHIFTS = 62;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024;
const MAX_REFERENCE_BYTES = 16 * 1024;
const MAX_PERSON_ROW_BYTES = 500 * 1024;
const MAX_CANDIDATE_SCHEDULES = 100;

function fail(code: string): never {
  throw new AppError({ code, kind: 'DATA_INTEGRITY', safeMessage: 'A preparação da revisão da escala está inconsistente.' });
}
function pathId(value: string) {
  if (!value || value.includes('/') || value.length > 1_200) fail('DP_REVISION_PATH_INVALID');
  return value;
}
function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function candidateId(userId: string, competence: string) {
  return digest(`${userId}:${competence}`);
}

/**
 * All documents are immutable inputs identified by a content hash. A failed chunk leaves a
 * `preparing` manifest; retry writes the same documents and marks it ready only after every ack.
 * A ready manifest is not official until its schedule pointer is committed separately.
 */
export async function prepareScheduleRevision(input: PreparedRevision, onChunk?: (index: number) => Promise<void>) {
  const { scheduleRef, revisionId, identity, entries, people, references, candidates } = input;
  if (scheduleRef.parent.id !== 'dp_schedules' || !revisionId || revisionId.includes('/')
    || entries.length > MAX_ENTRIES || references.length > MAX_CHANGED
    || people.some((person) => person.shifts.length > MAX_PERSON_SHIFTS)
    || new Set(entries.map((entry) => entry.id)).size !== entries.length
    || new Set(people.map((person) => person.userId)).size !== people.length
    || new Set(references.map((reference) => reference.id)).size !== references.length
    || candidates.some((candidate) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(candidate.competence))) {
    fail('DP_REVISION_PREPARATION_LIMIT');
  }
  const sortedEntries = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const sortedPeople = [...people].sort((a, b) => a.userId.localeCompare(b.userId));
  const sortedReferences = [...references].sort((a, b) => a.id.localeCompare(b.id));
  if (sortedEntries.some((entry) => Buffer.byteLength(JSON.stringify(entry.value)) > MAX_ENTRY_BYTES)
    || sortedReferences.some((reference) => Buffer.byteLength(JSON.stringify(reference.value)) > MAX_REFERENCE_BYTES)
    || sortedPeople.some((person) => Buffer.byteLength(JSON.stringify(person.shifts)) > MAX_PERSON_ROW_BYTES)) {
    fail('DP_REVISION_DOCUMENT_LIMIT');
  }
  const sortedCandidates = [...new Map(candidates.map((candidate) =>
    [`${candidate.userId}:${candidate.competence}`, candidate])).values()]
    .sort((a, b) => `${a.userId}:${a.competence}`.localeCompare(`${b.userId}:${b.competence}`));
  const hash = digest({ identity, entries: sortedEntries, people: sortedPeople,
    references: sortedReferences, candidates: sortedCandidates });
  const revisionRef = scheduleRef.collection('revisions').doc(pathId(revisionId));
  const manifestData = { scheduleId: scheduleRef.id, status: 'preparing', hash,
    identity, entryCount: entries.length, personCount: people.length,
    referenceCount: references.length, candidateCount: sortedCandidates.length };
  if (Buffer.byteLength(JSON.stringify(manifestData)) > MAX_MANIFEST_BYTES) fail('DP_REVISION_MANIFEST_LIMIT');
  const alreadyReady = await dbAdmin.runTransaction(async (tx) => {
    const manifest = await tx.get(revisionRef);
    if (manifest.exists) {
      if (manifest.get('hash') !== hash || manifest.get('scheduleId') !== scheduleRef.id
        || !['preparing', 'ready'].includes(manifest.get('status'))) fail('DP_REVISION_ID_COLLISION');
      return manifest.get('status') === 'ready';
    }
    tx.create(revisionRef, { ...manifestData, createdAt: Timestamp.now() });
    return false;
  });
  if (alreadyReady) return { revisionId, hash, entryCount: entries.length, personCount: people.length };
  const writes: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  sortedEntries.forEach(({ id, value }) => writes.push((batch) => batch.set(revisionRef.collection('entries').doc(pathId(id)), value)));
  sortedPeople.forEach(({ userId, shifts }) => writes.push((batch) => batch.set(revisionRef.collection('people').doc(pathId(userId)), { shifts })));
  sortedReferences.forEach(({ id, value }) => writes.push((batch) => batch.set(dbAdmin.collection('dp_shiftReferenceHistory').doc(pathId(id)), value)));
  for (let offset = 0; offset < writes.length; offset += CHUNK_SIZE) {
    const batch = dbAdmin.batch();
    writes.slice(offset, offset + CHUNK_SIZE).forEach((write) => write(batch));
    await batch.commit();
    await onChunk?.(offset / CHUNK_SIZE);
  }
  for (let offset = 0; offset < sortedCandidates.length; offset += 50) {
    const candidates = sortedCandidates.slice(offset, offset + 50);
    const indexRefs = candidates.map(({ userId, competence }) =>
      dbAdmin.collection('dp_personScheduleIndex').doc(candidateId(pathId(userId), competence)));
    await dbAdmin.runTransaction(async (tx) => {
      const documents = await tx.getAll(...indexRefs);
      documents.forEach((document, index) => {
        const candidate = candidates[index];
        const scheduleIds = document.exists ? document.get('scheduleIds') : [];
        if (!Array.isArray(scheduleIds) || scheduleIds.length > MAX_CANDIDATE_SCHEDULES
          || scheduleIds.some((id) => typeof id !== 'string' || !id || id.includes('/'))
          || document.exists && (document.get('userId') !== candidate.userId
            || document.get('competence') !== candidate.competence)
          || !scheduleIds.includes(scheduleRef.id) && scheduleIds.length === MAX_CANDIDATE_SCHEDULES) {
          fail('DP_REVISION_CANDIDATE_LIMIT');
        }
      });
      documents.forEach((document, index) => tx.set(document.ref, {
        userId: candidates[index].userId, competence: candidates[index].competence,
        scheduleIds: FieldValue.arrayUnion(scheduleRef.id) }, { merge: true }));
    });
  }
  await dbAdmin.runTransaction(async (tx) => {
    const manifest = await tx.get(revisionRef);
    if (!manifest.exists || manifest.get('hash') !== hash || manifest.get('scheduleId') !== scheduleRef.id) fail('DP_REVISION_ID_COLLISION');
    if (manifest.get('status') === 'ready') return;
    if (manifest.get('status') !== 'preparing') fail('DP_REVISION_ID_COLLISION');
    tx.update(revisionRef, { status: 'ready', readyAt: Timestamp.now() });
  });
  return { revisionId, hash, entryCount: entries.length, personCount: people.length };
}
