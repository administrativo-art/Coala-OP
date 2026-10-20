import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { defaultAdminPermissions, defaultGuestPermissions } = await import('../../src/types/index.ts');
const { autoPublishDocument, changeDocumentPublication, listOwnPublishedDocuments, openOwnPublishedDocument } = await import('../../src/features/hr/documents/publication.server.ts');

test('pasta do colaborador: só o titular, só o publicado; só o DP publica e retira', async () => {
  const prefix = `pub-${randomUUID().slice(0, 6)}`;
  const actor = (uid, permissions, extra = {}) => ({ decoded: { uid }, userDoc: { id: uid, ...extra }, profileId: null, permissions, isDefaultAdmin: false, workspace_id: 'coala-one' });
  const maria = actor(`${prefix}-maria`, structuredClone(defaultGuestPermissions), { hrEmployeeId: `${prefix}-hr-maria` });
  const joao = actor(`${prefix}-joao`, structuredClone(defaultGuestPermissions));
  const dp = actor(`${prefix}-dp`, structuredClone(defaultAdminPermissions));
  const viewerPermissions = structuredClone(defaultGuestPermissions);
  viewerPermissions.dp.collaborators.view = true;
  const viewer = actor(`${prefix}-viewer`, viewerPermissions);
  const files = new Map([['docs/a.pdf', Buffer.from('%PDF-a')], ['docs/b.pdf', Buffer.from('%PDF-b')]]);
  const deps = { hrDb: hrDbAdmin, now: () => new Date('2026-10-20T12:00:00.000Z'), overrides: async () => null,
    storage: { async download(path) { return files.get(path); } } };
  const docRef = (id) => hrDbAdmin.collection('employeeDocuments').doc(`${prefix}-${id}`);
  await Promise.all([
    // Da Maria pelo cadastro do RH: recibo de férias assinado (publicável) e atestado (restrito).
    docRef('receipt').set({ employeeId: `${prefix}-hr-maria`, documentTypeCode: 'VACATION_RECEIPT', displayName: 'Recibo de férias', storagePath: 'docs/a.pdf',
      signatureRequired: true, signatureStatus: 'signed', status: 'validated', deletedAt: null }),
    docRef('certificate').set({ employeeId: maria.decoded.uid, documentTypeCode: 'MEDICAL_CERTIFICATE', storagePath: 'docs/b.pdf', status: 'validated', deletedAt: null }),
    // Do João, já publicado.
    docRef('joao').set({ employeeId: joao.decoded.uid, documentTypeCode: 'VACATION_RECEIPT', storagePath: 'docs/b.pdf', status: 'validated', deletedAt: null,
      publication: { status: 'published', at: '2026-10-19T00:00:00.000Z', by: 'dp', source: 'manual' } }),
  ]);

  // Nada publicado ainda: a pasta da Maria está vazia e o documento não abre.
  assert.deepEqual(await listOwnPublishedDocuments(maria, deps), []);
  await assert.rejects(openOwnPublishedDocument(maria, docRef('receipt').id, 'view', deps), { code: 'EMPLOYEE_DOCUMENT_NOT_FOUND' });
  // Só o DP autorizado com edição publica; quem só vê, não.
  await assert.rejects(changeDocumentPublication(maria, { id: docRef('receipt').id, action: 'publish' }, deps), { code: 'EMPLOYEE_DOCUMENT_PUBLICATION_FORBIDDEN' });
  await assert.rejects(changeDocumentPublication(viewer, { id: docRef('receipt').id, action: 'publish' }, deps), { code: 'EMPLOYEE_DOCUMENT_PUBLICATION_FORBIDDEN' });
  // Tipo restrito não publica nem pelo DP.
  await assert.rejects(changeDocumentPublication(dp, { id: docRef('certificate').id, action: 'publish' }, deps), { code: 'EMPLOYEE_DOCUMENT_NOT_PUBLISHABLE' });
  const published = await changeDocumentPublication(dp, { id: docRef('receipt').id, action: 'publish' }, deps);
  assert.deepEqual([published.status, published.by, published.source], ['published', dp.decoded.uid, 'manual']);

  const list = await listOwnPublishedDocuments(maria, deps);
  assert.deepEqual(list.map((item) => item.id), [docRef('receipt').id]);
  assert.equal((await openOwnPublishedDocument(maria, docRef('receipt').id, 'download', deps)).bytes.toString(), '%PDF-a');
  // A Maria não vê nem abre o do João, mesmo publicado; o João não abre o da Maria.
  await assert.rejects(openOwnPublishedDocument(maria, docRef('joao').id, 'view', deps), { code: 'EMPLOYEE_DOCUMENT_NOT_FOUND' });
  await assert.rejects(openOwnPublishedDocument(joao, docRef('receipt').id, 'view', deps), { code: 'EMPLOYEE_DOCUMENT_NOT_FOUND' });
  assert.deepEqual((await listOwnPublishedDocuments(joao, deps)).map((item) => item.id), [docRef('joao').id]);

  // Retirar exige motivo, mantém o arquivo e some da pasta; a automática não republica o retirado.
  await assert.rejects(changeDocumentPublication(dp, { id: docRef('receipt').id, action: 'withdraw', reason: 'curto' }, deps), { code: 'EMPLOYEE_DOCUMENT_WITHDRAW_REASON' });
  const withdrawn = await changeDocumentPublication(dp, { id: docRef('receipt').id, action: 'withdraw', reason: 'Documento enviado com valor errado.' }, deps);
  assert.equal(withdrawn.status, 'withdrawn');
  assert.deepEqual(await listOwnPublishedDocuments(maria, deps), []);
  assert.equal(await autoPublishDocument(docRef('receipt').id, 'signed', deps), null);
  assert.equal((await docRef('receipt').get()).get('storagePath'), 'docs/a.pdf');
  const audit = (await docRef('receipt').collection('audit').get()).docs.map((doc) => doc.get('action')).sort();
  assert.deepEqual(audit, ['DOCUMENT_PUBLISHED', 'DOCUMENT_WITHDRAWN', 'downloaded']);

  // Publicação automática pela política: ASO periódico validado publica; atestado não.
  await docRef('aso').set({ employeeId: maria.decoded.uid, documentTypeCode: 'ASO_PERIODIC', storagePath: 'docs/a.pdf', status: 'validated', deletedAt: null });
  assert.equal((await autoPublishDocument(docRef('aso').id, 'validated', deps)).source, 'policy');
  assert.equal(await autoPublishDocument(docRef('certificate').id, 'validated', deps), null);
  assert.deepEqual((await listOwnPublishedDocuments(maria, deps)).map((item) => item.id), [docRef('aso').id]);
});
