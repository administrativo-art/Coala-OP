import { autoPublishDocument } from '../src/features/hr/documents/publication.server';
import { hrDbAdmin } from '../src/lib/firebase-rh-admin';
import { resolvePublicationPolicy, shouldAutoPublish,
  type DocumentPublicationPolicy, type DocumentPublicationTrigger } from '../src/lib/hr/employee-document-publication';

const apply = process.argv.includes('--apply');
const production = process.argv.includes('--production');
const confirmed = process.argv.includes('--confirm-automatic-publication');
const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';
if (projectId !== 'smart-converter-752gf') throw new Error('A reconciliação real exige FIREBASE_PROJECT_ID=smart-converter-752gf.');
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('A reconciliação real não aceita FIRESTORE_EMULATOR_HOST.');
if (apply && (!production || !confirmed)) {
  throw new Error('Para publicar automaticamente, use --apply --production --confirm-automatic-publication.');
}

const policySnapshot = await hrDbAdmin.collection('schema').doc('document_publication').get();
const rawPolicies = policySnapshot.get('policies');
if (!policySnapshot.exists || !rawPolicies || typeof rawPolicies !== 'object') {
  throw new Error('A política central precisa estar configurada antes da reconciliação.');
}
const policies = rawPolicies as Record<string, DocumentPublicationPolicy>;
const documents = await hrDbAdmin.collection('employeeDocuments').get();
const eligible: Array<{ id: string; code: string; event: DocumentPublicationTrigger }> = [];
for (const document of documents.docs) {
  const data = document.data();
  if (data.deletedAt || data.publication || typeof data.employeeId !== 'string' || !data.employeeId.trim()) continue;
  const code = typeof data.documentTypeCode === 'string' ? data.documentTypeCode.trim() : '';
  const event: DocumentPublicationTrigger | null = data.signatureStatus === 'signed'
    ? 'signed' : data.status === 'validated' ? 'validated' : null;
  if (event && shouldAutoPublish(resolvePublicationPolicy(code, policies), event, data)) eligible.push({ id: document.id, code, event });
}
const byType = Object.fromEntries([...new Set(eligible.map((item) => item.code))].sort()
  .map((code) => [code, eligible.filter((item) => item.code === code).length]));
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', projectId, database: 'coala-rh',
  eligible: eligible.length, byType }, null, 2));
if (apply) {
  let published = 0;
  for (const item of eligible) if (await autoPublishDocument(item.id, item.event)) published += 1;
  console.log(JSON.stringify({ status: 'reconciled', eligible: eligible.length, published }, null, 2));
}
