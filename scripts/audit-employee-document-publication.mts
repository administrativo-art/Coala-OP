import { createHash } from 'node:crypto';

import { FieldPath } from 'firebase-admin/firestore';

import { hrDbAdmin } from '../src/lib/firebase-rh-admin';
import { isPublishedToEmployee, resolvePublicationPolicy, shouldAutoPublish,
  type DocumentPublicationPolicy } from '../src/lib/hr/employee-document-publication';

const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';
if (projectId !== 'smart-converter-752gf') throw new Error('Auditoria real exige FIREBASE_PROJECT_ID=smart-converter-752gf.');
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('A auditoria real não aceita FIRESTORE_EMULATOR_HOST.');

const policySnapshot = await hrDbAdmin.collection('schema').doc('document_publication').get();
const rawPolicies = policySnapshot.get('policies');
const overrides = rawPolicies && typeof rawPolicies === 'object'
  ? rawPolicies as Record<string, DocumentPublicationPolicy> : null;
const counters = {
  total: 0, active: 0, withEmployee: 0, classified: 0, legacyUnclassified: 0,
  published: 0, withdrawn: 0, unpublished: 0, automaticEligibleWithoutPublication: 0,
  invalidPublished: 0,
};
const types: Record<string, number> = {};
let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
do {
  let query = hrDbAdmin.collection('employeeDocuments').orderBy(FieldPath.documentId()).limit(500);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  for (const document of page.docs) {
    const data = document.data();
    counters.total += 1;
    if (data.deletedAt) continue;
    counters.active += 1;
    if (typeof data.employeeId === 'string' && data.employeeId.trim()) counters.withEmployee += 1;
    const code = typeof data.documentTypeCode === 'string' && data.documentTypeCode.trim()
      ? data.documentTypeCode.trim() : 'UNCLASSIFIED';
    types[code] = (types[code] ?? 0) + 1;
    if (code === 'UNCLASSIFIED' || code === 'UNKNOWN_DOCUMENT') counters.legacyUnclassified += 1;
    else counters.classified += 1;
    if (data.publication?.status === 'published') counters.published += 1;
    else if (data.publication?.status === 'withdrawn') counters.withdrawn += 1;
    else counters.unpublished += 1;
    if (data.publication?.status === 'published' && (!isPublishedToEmployee(data)
      || resolvePublicationPolicy(code, overrides).mode === 'never')) counters.invalidPublished += 1;
    if (!data.publication) {
      const event = data.signatureStatus === 'signed' ? 'signed' : data.status === 'validated' ? 'validated' : null;
      if (event && shouldAutoPublish(resolvePublicationPolicy(code, overrides), event, data)) {
        counters.automaticEligibleWithoutPublication += 1;
      }
    }
  }
  cursor = page.docs.at(-1) ?? null;
  if (page.size < 500) cursor = null;
} while (cursor);

const pendingAudit = await hrDbAdmin.collectionGroup('audit')
  .where('action', '==', 'DOCUMENT_PUBLICATION_PENDING').count().get().catch(() => null);
const normalizedTypes = Object.fromEntries(Object.entries(types).sort(([left], [right]) => left.localeCompare(right)));
const policyDigest = overrides ? createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(overrides).sort()))).digest('hex') : null;
console.log(JSON.stringify({
  mode: 'read-only', projectId, database: 'coala-rh',
  policy: { explicitConfiguration: policySnapshot.exists, configuredTypes: Object.keys(overrides ?? {}).length, digest: policyDigest },
  documents: counters, byType: normalizedTypes,
  pendingPublicationAuditEvents: pendingAudit?.data().count ?? 'query_unavailable',
}, null, 2));
