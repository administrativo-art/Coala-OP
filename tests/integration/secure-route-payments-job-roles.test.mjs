import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';
assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
enableServerOnlyTestImports('demo-coala-repository');
// Sem credenciais do Inter: o envio precisa parar antes de qualquer chamada ao banco.
for (const key of Object.keys(process.env)) if (key.startsWith('INTER_')) delete process.env[key];
const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const receiptPayment = await import('../../src/app/api/documents/generated/[id]/payment/route.ts');
const payments = await import('../../src/app/api/financial/payment-requests/route.ts');
const submit = await import('../../src/app/api/financial/payment-requests/[id]/submit/route.ts');
const roles = await import('../../src/app/api/hr/roles/route.ts');
const role = await import('../../src/app/api/hr/roles/[roleId]/route.ts');
const bootstrap = await import('../../src/app/api/client/bootstrap/route.ts');
const publicOnboarding = await import('../../src/app/api/hr/onboarding/public/[token]/route.ts');
const signatures = await import('../../src/app/api/hr/onboarding/[id]/signature-documents/route.ts');

const PASSWORD = 'synthetic-password-123';
async function signIn(email) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const token = (await response.json()).idToken;
  assert.ok(token);
  return token;
}
async function actor(uid, { isDefaultAdmin = false, permissions = {} } = {}) {
  const email = `${uid}@example.test`;
  await authAdmin.createUser({ uid, email, password: PASSWORD });
  await authAdmin.setCustomUserClaims(uid, { profileId: uid, sessionVersion: 0 });
  await Promise.all([
    dbAdmin.collection('profiles').doc(uid).set({ isDefaultAdmin, permissions }),
    dbAdmin.collection('users').doc(uid).set({ username: `Ator ${uid}`, email, profileId: uid, isActive: true, sessionVersion: 0,
      profileCompliance: { status: 'complete', policyVersion: 1 } }),
  ]);
  return signIn(email);
}
const request = (method, path, token, body) => new NextRequest(`http://localhost${path}`, {
  method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
const none = { params: Promise.resolve({}) };
const payload = async (response) => response.json();

let admin; let nobody;
test.before(async () => {
  admin = await actor('routes-admin', { isDefaultAdmin: true });
  nobody = await actor('routes-nobody', {});
});
test.after(async () => { await Promise.all(['routes-admin', 'routes-nobody'].map((uid) => authAdmin.deleteUser(uid).catch(() => {}))); });

test('solicitações de pagamento: 401, 403, validação, origem protegida e leitura sem cache', { timeout: 120_000 }, async () => {
  const path = '/api/financial/payment-requests';
  const body = { sourceType: 'salary', sourceId: 'origem-sintetica', beneficiaryReference: { sourceType: 'employee', sourceId: 'pessoa-sintetica' }, amount: 10, description: 'Pagamento sintético' };
  assert.equal((await payments.GET(request('GET', path), none)).status, 401);
  assert.equal((await payments.POST(request('POST', path, null, body), none)).status, 401);
  const forbidden = await payments.GET(request('GET', path, nobody), none);
  assert.equal(forbidden.status, 403);
  assert.equal((await payload(forbidden)).error.message, 'Sem permissão para visualizar solicitações de pagamento.');
  // Quem não tem permissão não recebe retorno da validação.
  assert.equal((await payments.POST(request('POST', path, nobody, {}), none)).status, 403);
  const invalid = await payments.POST(request('POST', path, admin, { ...body, amount: -1 }), none);
  assert.equal(invalid.status, 400);
  assert.match((await payload(invalid)).error.message, /amount/);
  assert.equal((await payments.POST(request('POST', path, admin, 'isto não é json'), none)).status, 400);
  const protectedSource = await payments.POST(request('POST', path, admin, { ...body, sourceType: 'vacation' }), none);
  assert.equal(protectedSource.status, 403);
  assert.equal((await payload(protectedSource)).error.message, 'Este pagamento só pode ser criado pelo fluxo protegido.');
  const list = await payments.GET(request('GET', path, admin), none);
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'private, no-store');
  const listed = await payload(list);
  assert.ok(Array.isArray(listed.requests));
  assert.equal(listed.submissionAvailable, false);
});

test('envio ao banco: 401, 403 e bloqueio fora do ambiente publicado, sem chamar o banco', { timeout: 120_000 }, async () => {
  const path = '/api/financial/payment-requests/inexistente/submit';
  const context = { params: Promise.resolve({ id: 'inexistente' }) };
  assert.equal((await submit.POST(request('POST', path), context)).status, 401);
  assert.equal((await submit.POST(request('POST', path, nobody), context)).status, 403);
  const unavailable = await submit.POST(request('POST', path, admin), context);
  assert.equal(unavailable.status, 409);
  assert.equal((await payload(unavailable)).error.code, 'PAYMENT_SUBMISSION_ENVIRONMENT_UNAVAILABLE');
});

test('cargos: permissão, regras de negócio, gravação e alteração', { timeout: 120_000 }, async () => {
  const profileId = 'routes-job-role-profile';
  await dbAdmin.collection('profiles').doc(profileId).set({ permissions: {} });
  assert.equal((await roles.GET(request('GET', '/api/hr/roles'), none)).status, 401);
  const forbidden = await roles.GET(request('GET', '/api/hr/roles', nobody), none);
  assert.equal(forbidden.status, 403);
  assert.match((await payload(forbidden)).error.message, /^Sem permissão/);
  assert.equal((await roles.POST(request('POST', '/api/hr/roles', nobody, {}), none)).status, 403);
  assert.equal((await roles.POST(request('POST', '/api/hr/roles', admin, {}), none)).status, 400);

  const noProfile = await roles.POST(request('POST', '/api/hr/roles', admin, { name: 'Cargo sintético' }), none);
  assert.equal(noProfile.status, 400);
  assert.equal((await payload(noProfile)).error.message, 'Todo cargo ativo deve possuir um perfil de acesso padrão.');

  const created = await roles.POST(request('POST', '/api/hr/roles', admin, { name: 'Cargo sintético', defaultProfileId: profileId }), none);
  const createdBody = await payload(created);
  assert.equal(created.status, 201, JSON.stringify(createdBody));
  const roleId = createdBody.role.id;
  assert.equal((await hrDbAdmin.collection('jobRoles').doc(roleId).get()).get('name'), 'Cargo sintético');
  assert.ok((await payload(await roles.GET(request('GET', '/api/hr/roles', admin), none))).roles.some((item) => item.id === roleId));

  const patch = (id, token, body) => role.PATCH(request('PATCH', `/api/hr/roles/${id}`, token, body), { params: Promise.resolve({ roleId: id }) });
  assert.equal((await patch(roleId, null, { name: 'Outro' })).status, 401);
  assert.equal((await patch(roleId, nobody, { name: 'Outro' })).status, 403);
  assert.equal((await patch('nao-existe', admin, { name: 'Outro nome' })).status, 404);
  const selfParent = await patch(roleId, admin, { parentId: roleId });
  assert.equal((await payload(selfParent)).error.message, 'Um cargo não pode ser pai dele mesmo.');
  const updated = await patch(roleId, admin, { name: 'Cargo sintético revisado', defaultProfileId: profileId });
  assert.equal(updated.status, 200, JSON.stringify(await updated.clone().json()));
  assert.equal((await hrDbAdmin.collection('jobRoles').doc(roleId).get()).get('name'), 'Cargo sintético revisado');
  await hrDbAdmin.collection('jobRoles').doc(roleId).delete();
});

test('carregamento inicial: 401, entrada, filtro por permissão e cadastro incompleto só com currentUser', { timeout: 120_000 }, async () => {
  const call = (query, token) => bootstrap.GET(request('GET', `/api/client/bootstrap${query}`, token), none);
  const anonymous = await call('?collections=currentUser');
  assert.equal(anonymous.status, 401);
  assert.equal((await payload(anonymous)).error.message, 'Não autorizado.');
  const empty = await call('', nobody);
  assert.equal(empty.status, 400);
  assert.equal((await payload(empty)).error.message, 'Informe ao menos uma coleção.');
  assert.equal((await call('?collections=segredos', nobody)).status, 404);

  const restricted = await payload(await call('?collections=currentUser,users,lots,goals', nobody));
  assert.equal(restricted.currentUser.id, 'routes-nobody');
  assert.deepEqual(restricted.users.map((item) => item.id), ['routes-nobody']);
  assert.deepEqual(restricted.lots, []);
  assert.deepEqual(restricted.goalPeriods, []);
  const full = await payload(await call('?collections=users', admin));
  assert.ok(full.users.length >= 2);

  await dbAdmin.collection('users').doc('routes-nobody').update({ profileCompliance: { status: 'pending', policyVersion: 1 } });
  try {
    assert.equal((await call('?collections=currentUser', nobody)).status, 200);
    assert.equal((await call('?collections=currentUser,users', nobody)).status, 401);
  } finally {
    await dbAdmin.collection('users').doc('routes-nobody').update({ profileCompliance: { status: 'complete', policyVersion: 1 } });
  }
});

test('documentos de admissão: permissão por tipo de ação, validações, não encontrado e regra de negócio', { timeout: 180_000 }, async () => {
  const id = 'routes-onboarding-inexistente';
  const context = { params: Promise.resolve({ id }) };
  const base = `/api/hr/onboarding/${id}/signature-documents`;
  const get = (query, token) => signatures.GET(request('GET', `${base}${query}`, token), context);
  const act = (token, body) => signatures.POST(request('POST', base, token, body), context);
  const message = async (response) => (await payload(response)).error.message;
  // Cada ator tem só uma das permissões de formalização.
  const only = {};
  for (const [key, path] of Object.entries({ view: ['signatures', 'view'], send: ['signatures', 'send'], generate: ['documents', 'generate'], review: ['documents', 'review'] })) {
    only[key] = await actor(`routes-form-${key}`, { permissions: { hr: { formalization: { [path[0]]: { [path[1]]: true } } } } });
  }
  const required = { select: 'generate', generate: 'generate', preview_bundle: 'generate', set_family_salary_decision: 'generate', approve: 'review', request_changes: 'review',
    reconcile: 'view', prepare_positions: 'send', save_positions: 'send', send: 'send', add_company_signer: 'send', resend_participant: 'send', create_signature_link: 'send', replace_participant_email: 'send' };
  try {
    assert.equal((await get('', null)).status, 401);
    assert.equal((await act(null, { action: 'send' })).status, 401);
    assert.equal((await get('', nobody)).status, 403);
    for (const [action, needed] of Object.entries(required)) {
      for (const [key, token] of Object.entries(only)) {
        const { status } = await act(token, { action });
        // Quem pode enviar assinatura também pode consultá-la (regra do catálogo de permissões).
        if (key === needed || (needed === 'view' && key === 'send')) assert.notEqual(status, 403, `${action} com ${key}`);
        else assert.equal(status, 403, `${action} com ${key}`);
      }
    }
    const invalidPackage = await get('?package=zip', admin);
    assert.equal(invalidPackage.status, 400);
    assert.equal(await message(invalidPackage), 'Formato de pacote inválido.');
    const missingPackage = await get('?package=draft', admin);
    assert.equal(missingPackage.status, 404);
    assert.equal(await message(missingPackage), 'Pacote de assinatura não encontrado.');
    assert.equal((await get('?documentId=x&download=exe', admin)).status, 400);
    assert.equal((await get('?documentId=x&download=signed', admin)).status, 404);
    assert.equal(await message(await act(admin, { action: 'desconhecida' })), 'Ação inválida.');
    assert.equal(await message(await act(admin, { action: 'set_family_salary_decision' })), 'Informe a decisão sobre a concessão do salário-família.');
    assert.equal(await message(await act(admin, { action: 'send' })), 'A versão do pacote não foi informada corretamente.');
    assert.equal(await message(await act(admin, { action: 'resend_participant' })), 'Os dados da ação sobre o signatário são inválidos.');
    const badLayout = await act(admin, { action: 'save_positions' });
    assert.notEqual(badLayout.status, 403);
    // Mensagem de regra vinda do serviço continua chegando ao usuário, com status 400.
    const fromService = await act(admin, { action: 'preview_bundle' });
    assert.equal(fromService.status, 400);
    assert.equal(await message(fromService), 'Integração não encontrada.');
  } finally {
    await Promise.all(Object.keys(only).map((key) => authAdmin.deleteUser(`routes-form-${key}`).catch(() => {})));
  }
});

test('página pública de admissão: link inválido, encerrado e vencido; armadilha, limite de tentativas e leitura válida', { timeout: 180_000 }, async () => {
  const processes = hrDbAdmin.collection('onboardingProcesses');
  const day = 86_400_000;
  const make = async (key, data) => { const ref = processes.doc(`routes-public-${key}`); await ref.set({ publicToken: `token-${key}`, candidateName: 'Pessoa Sintética', documents: [], createdAt: new Date().toISOString(), ...data }); return ref; };
  const future = new Date(Date.now() + 30 * day).toISOString();
  const past = new Date(Date.now() - day).toISOString();
  const refs = await Promise.all([
    make('open', { status: 'pending', publicTokenExpiresAt: future }),
    make('cancelled', { status: 'cancelled', publicTokenExpiresAt: future }),
    make('expired', { status: 'pending', publicTokenExpiresAt: past }),
  ]);
  const path = (token) => `/api/hr/onboarding/public/${token}`;
  const context = (token) => ({ params: Promise.resolve({ token }) });
  const get = (token) => publicOnboarding.GET(request('GET', path(token)), context(token));
  const post = (token, body, ip = '203.0.113.1') => {
    const req = request('POST', path(token), null, body);
    req.headers.set('x-forwarded-for', ip);
    return publicOnboarding.POST(req, context(token));
  };
  const message = async (response) => (await payload(response)).error.message;
  try {
    const unknown = await get('token-desconhecido');
    assert.equal(unknown.status, 404);
    assert.equal(await message(unknown), 'Onboarding não encontrado.');
    assert.match(unknown.headers.get('cache-control'), /no-store/);
    assert.equal((await get('token-cancelled')).status, 404);
    assert.equal((await post('token-cancelled', { answers: {} })).status, 403);
    const expired = await get('token-expired');
    assert.equal(expired.status, 410);
    assert.equal((await post('token-expired', { answers: {} })).status, 410);

    const open = await get('token-open');
    const opened = await payload(open);
    assert.equal(open.status, 200, JSON.stringify(opened));
    assert.match(open.headers.get('cache-control'), /no-store/);
    assert.equal(opened.candidateName, 'Pessoa Sintética');
    assert.ok(opened.privacyNotice);
    assert.equal((await refs[0].collection('audit').where('action', '==', 'PUBLIC_LINK_ACCESSED').get()).size, 1);

    assert.equal(await message(await post('token-open', 'isto não é json', '203.0.113.2')), 'Payload inválido.');
    assert.equal(await message(await post('token-open', { website: 'robô' }, '203.0.113.3')), 'Envio não aceito.');
    const incomplete = await post('token-open', { answers: {}, documents: {} }, '203.0.113.4');
    assert.equal(incomplete.status, 400);
    assert.ok(await message(incomplete));
    assert.equal((await refs[0].get()).get('publicFormSubmittedAt'), undefined);

    for (let attempt = 0; attempt < 8; attempt += 1) assert.notEqual((await post('token-open', { website: 'x' }, '203.0.113.9')).status, 429);
    const limited = await post('token-open', { website: 'x' }, '203.0.113.9');
    assert.equal(limited.status, 429);
    assert.equal(await message(limited), 'Muitas tentativas. Tente novamente em alguns minutos.');
  } finally {
    await Promise.all(refs.map((ref) => ref.delete()));
  }
});

function publicSubmission() {
  const processes = hrDbAdmin.collection('onboardingProcesses');
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const path = (token) => `/api/hr/onboarding/public/${token}`;
  const context = (token) => ({ params: Promise.resolve({ token }) });
  const read = async (token) => payload(await publicOnboarding.GET(request('GET', path(token)), context(token)));
  const submitForm = (token, body, ip) => {
    const req = request('POST', path(token), null, body);
    req.headers.set('x-forwarded-for', ip);
    return publicOnboarding.POST(req, context(token));
  };
  const upload = (documents) => Object.fromEntries(documents.map((item) => [item.id, {
    fileUrl: `https://firebasestorage.googleapis.com/v0/b/demo/o/${item.id}`, filePath: `onboarding/sintetico/${item.id}`, sha256: 'a'.repeat(64),
  }]));
  const consents = (view) => ({
    privacyAcceptance: { noticeVersion: view.privacyNotice.version, noticeHash: view.privacyNotice.hash, acknowledged: true,
      allergyAcknowledged: true, allergyNoticeVersion: view.privacyNotice.allergyNoticeVersion, allergyNoticeHash: view.privacyNotice.allergyNoticeHash },
    imageVoiceConsent: { authorized: false, termVersion: view.imageVoiceConsentTerm.version, termHash: view.imageVoiceConsentTerm.hash, decisionChanged: true },
  });
  return { processes, future, read, submitForm, upload, consents };
}

test('página pública de admissão: envio PJ completo grava o aceite e avança a etapa', { timeout: 180_000 }, async () => {
  const { processes, future, read, submitForm, upload, consents } = publicSubmission();
  const pj = processes.doc('routes-public-submit-pj');
  await pj.set({ publicToken: 'token-submit-pj', candidateName: 'Representante Sintético', employmentRelationshipType: 'pj', status: 'pending', publicTokenExpiresAt: future, documents: [],
    pjWorkflow: { currentStep: 'provider_registration', steps: { provider_registration: { status: 'active' }, registration_review: { status: 'pending' } } } });
  try {
    const pjView = await read('token-submit-pj');
    const pjAnswers = { companyAddress: 'Rua Sintética, 1', companyPhone: '(98) 3000-0000', representativeName: 'Representante Sintético',
      representativeCpf: '12345678909', representativeQualification: 'Sócio administrador', authoritySource: 'social_contract', bankMethod: 'pix',
      bankHolderName: 'Empresa Sintética', bankHolderDocument: '12345678000195', pixKey: 'chave-sintetica', pixKeyType: 'random', bankName: 'Banco', bankAgency: '1', bankAccount: '2', bankAccountType: 'checking',
      email: 'pj@example.test', dataAccuracyConfirmed: true, representationAuthorityConfirmed: true, invoiceAcknowledged: true };
    const pjSent = await submitForm('token-submit-pj', { answers: pjAnswers, documents: upload(pjView.documents.filter((item) => item.required)), ...consents(pjView) }, '198.51.100.2');
    const pjBody = await payload(pjSent);
    assert.equal(pjSent.status, 200, JSON.stringify(pjBody));
    const storedPj = (await pj.get()).data();
    assert.ok(storedPj.publicPrivacyAcceptance.lastProtocol);
    assert.equal(storedPj.pjWorkflow.currentStep, 'registration_review');
  } finally {
    await pj.delete();
  }
});

// Campos opcionais de análise ausentes não podem impedir a submissão.
test('página pública de admissão: envio CLT completo', { timeout: 180_000 }, async () => {
  const { processes, future, read, submitForm, upload, consents } = publicSubmission();
  const clt = processes.doc('routes-public-submit-clt');
  await clt.set({ publicToken: 'token-submit-clt', candidateName: 'Pessoa Sintética', status: 'pending', publicTokenExpiresAt: future, documents: [] });
  try {
    const cltView = await read('token-submit-clt');
    const answers = { fullName: 'Pessoa Sintética', cpf: '12345678909', maritalStatus: 'Solteiro(a)', hasChildren: 'no',
      emergencyName: 'Contato Sintético', emergencyPhone: '(98) 99999-0000', emergencyRelation: 'Mãe/Pai', hasFoodRestriction: 'no' };
    const sent = await submitForm('token-submit-clt', { answers, documents: upload(cltView.documents), ...consents(cltView) }, '198.51.100.1');
    const sentBody = await payload(sent);
    assert.equal(sent.status, 200, JSON.stringify(sentBody));
    assert.match(sent.headers.get('cache-control'), /no-store/);
    const stored = (await clt.get()).data();
    assert.ok(stored.publicFormSubmittedAt);
    assert.equal(stored.publicFormAnswers.cpf, '12345678909');
    assert.equal(stored.publicPrivacyAcceptance.acknowledged, true);
    assert.ok((await clt.collection('audit').get()).size >= 1);
  } finally {
    await clt.delete();
  }
});


test('pagamento do recibo: rota inicializa, rejeita campos extras e bloqueia envio sem Inter', async () => {
  const path = '/api/documents/generated/recibo-sintetico/payment';
  const context = { params: Promise.resolve({ id: 'recibo-sintetico' }) };
  assert.equal((await receiptPayment.POST(request('POST', path), context)).status, 401);
  assert.equal((await receiptPayment.POST(request('POST', path, nobody), context)).status, 403);
  assert.equal((await receiptPayment.POST(request('POST', path, admin, { amount: 10 }), context)).status, 400);
  assert.equal((await receiptPayment.POST(request('POST', path + '?amount=10', admin), context)).status, 400);
  const unavailable = await receiptPayment.POST(request('POST', path, admin), context);
  assert.equal(unavailable.status, 409);
  assert.equal((await payload(unavailable)).error.code, 'DOCUMENT_RECEIPT_PAYMENT_INTER_UNAVAILABLE');
});


test('payment creation preserves missing Pix and salary rule messages without a bank call', async () => {
  const employee = hrDbAdmin.collection('employees').doc('routes-no-pix-beneficiary');
  const { financialDbAdmin } = await import('../../src/lib/firebase-financial-admin.ts');
  const expense = financialDbAdmin.collection('expenses').doc('routes-salary-expense');
  await employee.set({ status: 'active' });
  await employee.collection('field_values').doc('employee.cpf').set({ value_text: '12345678909' });
  await expense.set({ workspaceId: 'coala', status: 'pending', provisionType: 'actual', payrollEarningType: 'salary', employeeId: employee.id, totalValue: 10, description: 'Synthetic salary' });
  const input = { sourceType: 'salary', sourceId: expense.id, expenseId: expense.id, beneficiaryReference: { sourceType: 'employee', sourceId: employee.id }, amount: 10, description: 'Synthetic salary', scheduledFor: '2099-01-01' };
  try {
    const noPix = await payments.POST(request('POST', '/api/financial/payment-requests', admin, input), none);
    assert.equal(noPix.status, 400);
    assert.match((await payload(noPix)).error.message, /Pix/);
    const wrongValue = await payments.POST(request('POST', '/api/financial/payment-requests', admin, { ...input, amount: 12 }), none);
    assert.equal(wrongValue.status, 400);
    assert.match((await payload(wrongValue)).error.message, /valor/i);
  } finally { await hrDbAdmin.recursiveDelete(employee); await expense.delete(); }
});
