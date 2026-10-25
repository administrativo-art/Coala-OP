import { createHash } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';

import { hrDbAdmin } from '../src/lib/firebase-rh-admin';
import { activeDocumentTypeCodes } from '../src/lib/hr/employee-document-catalog';
import { resolvePublicationPolicy } from '../src/lib/hr/employee-document-publication';

const apply = process.argv.includes('--apply');
const production = process.argv.includes('--production');
const confirmed = process.argv.includes('--confirm-central-policy');
const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';
if (projectId !== 'smart-converter-752gf') throw new Error('A política real exige FIREBASE_PROJECT_ID=smart-converter-752gf.');
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('A política real não aceita FIRESTORE_EMULATOR_HOST.');
if (apply && (!production || !confirmed)) {
  throw new Error('Para gravar, use --apply --production --confirm-central-policy.');
}

const policies = Object.fromEntries(activeDocumentTypeCodes().sort().map((code) => [code, resolvePublicationPolicy(code)]));
const digest = createHash('sha256').update(JSON.stringify(policies)).digest('hex');
const ref = hrDbAdmin.collection('schema').doc('document_publication');
const current = await ref.get();
const currentPolicies = current.get('policies');
const currentDigest = currentPolicies && typeof currentPolicies === 'object'
  ? createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(currentPolicies).sort()))).digest('hex') : null;
const plan = {
  mode: apply ? 'apply' : 'dry-run', projectId, database: 'coala-rh', target: 'schema/document_publication',
  policyTypes: Object.keys(policies).length, digest, currentExists: current.exists, currentDigest,
};
console.log(JSON.stringify(plan, null, 2));
if (!apply) process.exit(0);
if (current.exists && currentDigest !== digest) {
  throw new Error('Já existe uma política central diferente; revisão humana obrigatória antes de substituir.');
}

const receipt = await hrDbAdmin.runTransaction(async (transaction) => {
  const fresh = await transaction.get(ref);
  const freshPolicies = fresh.get('policies');
  const freshDigest = freshPolicies && typeof freshPolicies === 'object'
    ? createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(freshPolicies).sort()))).digest('hex') : null;
  if (fresh.exists && freshDigest !== digest) throw new Error('A política mudou depois da prévia; operação cancelada.');
  if (fresh.exists) return { replayed: true };
  const at = Timestamp.now();
  transaction.create(ref, { schemaVersion: 1, policies, policyDigest: digest,
    updatedAt: at, updatedBy: 'system:central-publication-bootstrap' });
  transaction.create(ref.collection('audit').doc(`bootstrap-${digest.slice(0, 24)}`), {
    action: 'DOCUMENT_PUBLICATION_POLICY_BOOTSTRAPPED', actorId: 'system:central-publication-bootstrap',
    policyDigest: digest, policyTypes: Object.keys(policies).length, at,
  });
  return { replayed: false };
});
console.log(JSON.stringify({ status: receipt.replayed ? 'already-configured' : 'configured', digest }, null, 2));
