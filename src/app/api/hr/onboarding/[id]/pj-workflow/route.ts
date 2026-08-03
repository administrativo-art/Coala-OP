import { createHash, randomUUID } from 'node:crypto';
import { renderToBuffer } from '@react-pdf/renderer';
import { getStorage } from 'firebase-admin/storage';
import { NextRequest, NextResponse } from 'next/server';

import { PjServiceContractPdf, type PjContractData } from '@/features/hr/onboarding-pj/contract-pdf';
import { pjRequiredRegistrationFieldsMissing, setPjWorkflowStep } from '@/features/hr/onboarding-pj/core';
import { resolveDocumentLegalEntitySnapshot } from '@/features/hr/documents/legal-entity-snapshot.server';
import { assertFormalizationAccess, serializeHrValue } from '@/features/hr/lib/server-access';
import { createAutentiqueDocument, getAutentiqueDocumentStatus } from '@/lib/autentique.server';
import { sendTrackedIntegrationCommunication } from '@/lib/email/integration-communications';
import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { createOnboardingPublicLinkWindow } from '@/lib/hr/onboarding-public-link';
import { fetchPdvLegalProfiles } from '@/lib/integrations/pdv-legal-admin';
import { logAction } from '@/lib/log-action';
import type { IntegrationTemplateVersion } from '@/features/hr/integration/schemas';
import type { OnboardingDocument, PjOnboardingWorkflow } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function email(value: unknown) {
  const normalized = text(value, 240).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function digits(value: unknown, length?: number) {
  const normalized = String(value ?? '').replace(/\D/g, '');
  return length ? normalized.slice(0, length) : normalized;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)))
    : [];
}

function workflowFrom(process: Record<string, unknown>) {
  return process.pjWorkflow && typeof process.pjWorkflow === 'object' && !Array.isArray(process.pjWorkflow)
    ? process.pjWorkflow as PjOnboardingWorkflow
    : null;
}

function integrationTemplate(process: Record<string, unknown>) {
  const snapshot = record(record(process.integrationV2).snapshot);
  return snapshot as unknown as IntegrationTemplateVersion;
}

async function loadProcess(id: string) {
  const ref = hrDbAdmin.collection('onboardingProcesses').doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error('Integração PJ não encontrada.');
  const process = snapshot.data() ?? {};
  if (process.employmentRelationshipType !== 'pj') throw new Error('Este fluxo está disponível somente para contratação PJ.');
  const workflow = workflowFrom(process);
  if (!workflow) throw new Error('O fluxo PJ desta integração está incompleto.');
  return { ref, process, workflow };
}

async function readStorage(path: string) {
  const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).download();
  return buffer;
}

async function downloadSignedPdf(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Não foi possível baixar o contrato assinado (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

function contractData(process: Record<string, unknown>, workflow: PjOnboardingWorkflow, contractor: Awaited<ReturnType<typeof resolveDocumentLegalEntitySnapshot>>): PjContractData {
  const answers = record(process.publicFormAnswers);
  const settings = workflow.contract?.contractorRepresentative ?? {};
  return {
    contractor: {
      name: contractor.legalName || text(process.employerUnitName),
      cnpj: contractor.cnpj || digits(process.employerCnpj),
      email: email(settings.email),
      address: contractor.address || text(process.employerAddress, 800),
      representativeName: text(settings.name, 180),
      representativeRole: text(settings.role, 120),
      representativeQualification: text(settings.qualification, 300),
      representativeCpf: digits(settings.cpf, 11),
      representativeProfessionalId: text(settings.professionalId, 120) || null,
    },
    provider: {
      name: workflow.provider.legalName,
      cnpj: workflow.provider.cnpj,
      email: workflow.provider.email,
      address: text(answers.companyAddress, 800),
      representativeName: text(answers.representativeName, 180),
      representativeQualification: text(answers.representativeQualification, 300),
      representativeCpf: digits(answers.representativeCpf, 11),
    },
    terms: {
      startDate: workflow.terms.contractStartDate,
      termType: workflow.terms.termType,
      endDate: workflow.terms.contractEndDate ?? null,
      monthlyValue: workflow.terms.monthlyValue,
      paymentDay: workflow.terms.paymentDay,
      services: workflow.terms.serviceItems.map(item => ({ front: item.front, deliverable: item.deliverable })),
    },
    forumCity: text(workflow.contract?.forumCity, 180),
    signatureCity: text(workflow.contract?.signatureCity, 180),
    issueDate: new Date().toISOString().slice(0, 10),
  };
}

function validateContractData(data: PjContractData) {
  const required = [
    data.contractor.name, data.contractor.cnpj, data.contractor.email, data.contractor.address,
    data.contractor.representativeName, data.contractor.representativeRole,
    data.contractor.representativeQualification, data.contractor.representativeCpf,
    data.provider.name, data.provider.cnpj, data.provider.email, data.provider.address,
    data.provider.representativeName, data.provider.representativeQualification,
    data.provider.representativeCpf, data.forumCity, data.signatureCity,
  ];
  if (required.some(value => !value)) throw new Error('Preencha todos os dados do contrato e dos dois representantes.');
  if (data.contractor.representativeCpf.length !== 11 || data.provider.representativeCpf.length !== 11) {
    throw new Error('Informe CPF válido para os dois representantes.');
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertFormalizationAccess(request, 'onboarding.manage').catch(() => null);
  if (!access) return error('Sem permissão para acessar o fluxo PJ.', 403);
  try {
    const { id } = await context.params;
    const { process, workflow } = await loadProcess(id);
    const asset = request.nextUrl.searchParams.get('asset');
    if (!asset) return NextResponse.json(serializeHrValue({ id, ...process }));
    const path = asset === 'signed_contract' ? workflow.contract?.signedStoragePath : workflow.contract?.storagePath;
    if (!path) return error('Arquivo ainda não disponível.', 404);
    const buffer = await readStorage(path);
    const suffix = asset === 'signed_contract' ? 'assinado' : 'minuta';
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(`contrato-${suffix}-${workflow.provider.legalName}.pdf`)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : 'Falha ao carregar o fluxo PJ.', 400);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertFormalizationAccess(request, 'onboarding.manage').catch(() => null);
  if (!access) return error('Sem permissão para gerenciar o fluxo PJ.', 403);
  const { id } = await context.params;
  const body = record(await request.json().catch(() => null));
  const action = text(body.action, 80);
  try {
    const { ref, process, workflow } = await loadProcess(id);
    const now = new Date().toISOString();
    let nextWorkflow = structuredClone(workflow);
    const update: Record<string, unknown> = { updatedAt: now };

    if (action === 'set_document_status') {
      if (workflow.currentStep !== 'registration_review') throw new Error('Os documentos só podem ser conferidos na etapa 3.');
      const documentId = text(body.documentId, 120);
      const status = body.status === 'approved' ? 'approved' : body.status === 'rejected' ? 'rejected' : null;
      const documents = Array.isArray(process.documents) ? process.documents as OnboardingDocument[] : [];
      const target = documents.find(document => document.id === documentId);
      if (!target || !status) throw new Error('Documento ou situação inválida.');
      if (!target.fileUrl && !target.filePath) throw new Error('O documento não possui arquivo para conferência.');
      update.documents = documents.map(document => document.id === documentId ? {
        ...document,
        status,
        note: text(body.note, 1000) || null,
        approvedAt: status === 'approved' ? now : null,
        updatedAt: now,
      } : document);
    } else if (action === 'request_corrections') {
      if (workflow.currentStep !== 'registration_review') throw new Error('A devolutiva só pode ser enviada na etapa 3.');
      const message = text(body.message, 2000);
      if (!message) throw new Error('Explique o que a prestadora precisa corrigir.');
      const selectedIds = new Set(stringArray(body.documentIds));
      const documents = Array.isArray(process.documents) ? process.documents as OnboardingDocument[] : [];
      update.documents = documents.map(document => selectedIds.has(document.id) ? {
        ...document, status: 'rejected', note: message, approvedAt: null, updatedAt: now,
      } : document);
      nextWorkflow = {
        ...workflow,
        currentStep: 'provider_registration',
        review: {
          status: 'correction_required',
          issues: [{ id: randomUUID(), target: selectedIds.size ? 'documents' : 'registration', message, resolvedAt: null }],
          reviewedAt: now,
          reviewedBy: access.decoded.uid,
        },
        steps: {
          ...workflow.steps,
          provider_registration: { ...workflow.steps.provider_registration, status: 'correction_required', note: message },
          registration_review: { ...workflow.steps.registration_review, status: 'pending' },
        },
      };
      let publicToken = text(process.publicToken, 200);
      const expired = !text(process.publicTokenExpiresAt, 80) || new Date(text(process.publicTokenExpiresAt, 80)).getTime() <= Date.now();
      if (!publicToken || expired) {
        publicToken = randomUUID().replace(/-/g, '');
        Object.assign(update, { publicToken, ...createOnboardingPublicLinkWindow(new Date(now)), publicTokenClosedAt: null });
      }
      update.currentStage = 'documents';
      update.status = 'collecting_documents';
      await sendTrackedIntegrationCommunication({
        onboardingId: id,
        event: 'formalization_started',
        template: integrationTemplate(process),
        recipient: workflow.provider.email,
        actionUrl: `https://vagas.coalashakes.com/onboarding/${encodeURIComponent(publicToken)}`,
        expiresAt: text(update.publicTokenExpiresAt ?? process.publicTokenExpiresAt, 80),
        variables: {
          'employee.name': workflow.provider.legalName,
          'employee.personal_email': workflow.provider.email,
          'system.role.job_role': 'Prestadora de serviços',
          'system.role.functions': `Correção cadastral: ${message}`,
          'system.schedule.units': text(process.employerUnitName),
          'system.schedule.shift': null,
          'integration.expected_admission_date': workflow.terms.contractStartDate,
        },
        force: true,
      });
    } else if (action === 'approve_registration') {
      if (workflow.currentStep !== 'registration_review') throw new Error('A aprovação cadastral só pode ocorrer na etapa 3.');
      const missing = pjRequiredRegistrationFieldsMissing(process.publicFormAnswers);
      if (missing.length) throw new Error(`Cadastro incompleto: ${missing.join(', ')}.`);
      const documents = Array.isArray(process.documents) ? process.documents as OnboardingDocument[] : [];
      const pending = documents.filter(document => document.required !== false && document.status !== 'approved');
      if (pending.length) throw new Error(`Aprove os documentos obrigatórios: ${pending.map(document => document.label).join(', ')}.`);
      nextWorkflow = setPjWorkflowStep({
        ...workflow,
        review: { status: 'approved', issues: [], reviewedAt: now, reviewedBy: access.decoded.uid },
      }, 'contract_preparation', now, access.decoded.uid);
      update.currentStage = 'signature_preparation';
      update.status = 'contract_pending';
    } else if (action === 'save_contract_settings') {
      if (workflow.currentStep !== 'contract_preparation') throw new Error('O contrato só pode ser preparado na etapa 4.');
      const representative = record(body.contractorRepresentative);
      const contractorRepresentative = {
        name: text(representative.name, 180),
        email: email(representative.email),
        role: text(representative.role, 120),
        qualification: text(representative.qualification, 300),
        cpf: digits(representative.cpf, 11),
        professionalId: text(representative.professionalId, 120) || null,
      };
      if (!contractorRepresentative.name || !contractorRepresentative.email || !contractorRepresentative.role || !contractorRepresentative.qualification || contractorRepresentative.cpf.length !== 11) {
        throw new Error('Preencha nome, e-mail, cargo, qualificação e CPF do representante da contratante.');
      }
      const signatureCity = text(body.signatureCity, 180);
      const forumCity = text(body.forumCity, 180);
      if (!signatureCity || !forumCity) throw new Error('Informe a cidade de assinatura e o foro.');
      nextWorkflow.contract = { ...workflow.contract, contractorRepresentative, signatureCity, forumCity };
    } else if (action === 'generate_contract') {
      if (workflow.currentStep !== 'contract_preparation') throw new Error('A minuta só pode ser gerada na etapa 4.');
      const contractor = await resolveDocumentLegalEntitySnapshot({
        cnpj: process.employerCnpj,
        fallbackName: process.employerUnitName,
        fallbackAddress: process.employerAddress,
      });
      const data = contractData(process, workflow, contractor);
      validateContractData(data);
      const contractDocument = PjServiceContractPdf({ data }) as Parameters<typeof renderToBuffer>[0];
      const buffer = Buffer.from(await renderToBuffer(contractDocument));
      const version = Number(workflow.contract?.version ?? 0) + 1;
      const storagePath = `hr/onboarding/${id}/pj-contracts/v${version}/contrato.pdf`;
      const hashSha256 = createHash('sha256').update(buffer).digest('hex');
      await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, {
        resumable: false,
        metadata: { contentType: 'application/pdf', cacheControl: 'private, max-age=0, no-store', metadata: { onboardingId: id, version: String(version), hashSha256 } },
      });
      nextWorkflow.contract = {
        ...workflow.contract,
        status: 'draft', version, storagePath, signedStoragePath: null, hashSha256,
        generatedAt: now, generatedBy: access.decoded.uid, approvedAt: null, approvedBy: null,
        signatureRequestId: null, providerDocumentId: null, providerSignatures: [], sentAt: null, signedAt: null, lastError: null,
      };
    } else if (action === 'approve_contract') {
      if (workflow.currentStep !== 'contract_preparation' || workflow.contract?.status !== 'draft' || !workflow.contract.storagePath) {
        throw new Error('Gere e confira a minuta antes de aprová-la.');
      }
      nextWorkflow = setPjWorkflowStep({
        ...workflow,
        contract: { ...workflow.contract, status: 'approved', approvedAt: now, approvedBy: access.decoded.uid },
      }, 'contract_signature', now, access.decoded.uid);
      update.currentStage = 'signature';
    } else if (action === 'send_contract') {
      if (workflow.currentStep !== 'contract_signature' || workflow.contract?.status !== 'approved' || !workflow.contract.storagePath) {
        throw new Error('A minuta precisa estar aprovada antes do envio.');
      }
      const representative = workflow.contract.contractorRepresentative;
      const contractorEmail = email(representative?.email);
      const providerEmail = email(workflow.provider.email);
      if (!contractorEmail || !providerEmail) throw new Error('Os dois signatários precisam de e-mails válidos.');
      const buffer = await readStorage(workflow.contract.storagePath);
      const requestRef = hrDbAdmin.collection('hrSignatureRequests').doc();
      await requestRef.set({
        source: 'pj_onboarding_contract', onboardingId: id, status: 'sending',
        documentName: `Contrato de prestação de serviços · ${workflow.provider.legalName}`,
        generatedStoragePath: workflow.contract.storagePath, createdAt: now, updatedAt: now,
        createdBy: access.decoded.uid,
      });
      try {
        const created = await createAutentiqueDocument({
          buffer,
          fileName: `contrato-prestacao-servicos-${workflow.provider.legalName}.pdf`,
          documentName: `Contrato de prestação de serviços · ${workflow.provider.legalName}`,
          message: 'Confira o contrato e realize a assinatura eletrônica.',
          signers: [
            { name: text(representative?.name, 180), email: contractorEmail, cpf: digits(representative?.cpf, 11), action: 'SIGN' },
            { name: text(record(process.publicFormAnswers).representativeName, 180), email: providerEmail, cpf: digits(record(process.publicFormAnswers).representativeCpf, 11), action: 'SIGN' },
          ],
        });
        await requestRef.set({ status: 'sent', provider: 'autentique', sandbox: created.sandbox, providerDocumentId: created.document.id, providerSignatures: created.document.signatures, sentAt: now, updatedAt: now }, { merge: true });
        nextWorkflow.contract = { ...workflow.contract, status: 'sent', signatureRequestId: requestRef.id, providerDocumentId: created.document.id, providerSignatures: created.document.signatures, sentAt: now, lastError: null };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Falha ao enviar o contrato.';
        await requestRef.set({ status: 'failed', error: message, updatedAt: now }, { merge: true });
        throw cause;
      }
    } else if (action === 'reconcile_contract') {
      if (workflow.currentStep !== 'contract_signature' || !workflow.contract?.providerDocumentId) throw new Error('O contrato ainda não foi enviado.');
      const provider = await getAutentiqueDocumentStatus(workflow.contract.providerDocumentId);
      if (provider.completed && provider.signedUrl) {
        const buffer = await downloadSignedPdf(provider.signedUrl);
        const signedStoragePath = `hr/onboarding/${id}/pj-contracts/v${workflow.contract.version ?? 1}/contrato-assinado.pdf`;
        await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(signedStoragePath).save(buffer, {
          resumable: false,
          metadata: { contentType: 'application/pdf', cacheControl: 'private, max-age=0, no-store', metadata: { onboardingId: id, providerDocumentId: workflow.contract.providerDocumentId } },
        });
        if (workflow.contract.signatureRequestId) {
          await hrDbAdmin.collection('hrSignatureRequests').doc(workflow.contract.signatureRequestId).set({ status: 'signed', signedStoragePath, signedAt: now, updatedAt: now }, { merge: true });
        }
        nextWorkflow = setPjWorkflowStep({
          ...workflow,
          contract: { ...workflow.contract, status: 'signed', signedStoragePath, signedAt: now, lastError: null },
        }, 'financial_registration', now, 'system:autentique');
        update.currentStage = 'formalization_validation';
        update.status = 'ready_to_create_user';
      } else {
        nextWorkflow.contract = { ...workflow.contract, lastError: null };
        update.signatureProgress = { signedCount: provider.signedCount, signaturesCount: provider.signaturesCount, reconciledAt: now };
      }
    } else if (action === 'submit_finance') {
      if (workflow.currentStep !== 'financial_registration' || workflow.contract?.status !== 'signed') throw new Error('O contrato assinado é necessário antes do envio ao Financeiro.');
      nextWorkflow.finance = { status: 'submitted', submittedAt: now, submittedBy: access.decoded.uid, note: null };
      await hrDbAdmin.collection('hrNotifications').doc(`pj_financial_registration_${id}`).set({
        type: 'pj_financial_registration', status: 'pending', onboardingId: id,
        title: 'Cadastrar nova prestadora PJ',
        message: `${workflow.provider.legalName} está com contrato assinado e aguarda cadastro financeiro e fiscal. Nota fiscal obrigatória.`,
        channels: ['in_app'], recipient: { strategy: 'financial_pool' }, createdAt: now, updatedAt: now,
      }, { merge: true });
    } else if (action === 'finance_return') {
      if (workflow.currentStep !== 'financial_registration' || workflow.finance?.status !== 'submitted') throw new Error('O cadastro não está aguardando análise financeira.');
      const note = text(body.note, 2000);
      if (!note) throw new Error('Informe o motivo da devolução.');
      nextWorkflow.finance = { ...workflow.finance, status: 'correction_required', reviewedAt: now, reviewedBy: access.decoded.uid, note };
    } else if (action === 'finance_approve') {
      if (workflow.currentStep !== 'financial_registration' || workflow.finance?.status !== 'submitted') {
        throw new Error('Envie o cadastro ao Financeiro antes de aprová-lo.');
      }
      nextWorkflow = setPjWorkflowStep({
        ...workflow,
        finance: { ...workflow.finance, status: 'approved', reviewedAt: now, reviewedBy: access.decoded.uid, note: text(body.note, 2000) || workflow.finance?.note || null },
      }, 'access_configuration', now, access.decoded.uid);
      update.currentStage = 'integration';
      update.status = 'active';
    } else if (action === 'save_access') {
      if (workflow.currentStep !== 'access_configuration') throw new Error('Os acessos só podem ser configurados na etapa 7.');
      const userName = text(body.userName, 180);
      const userCpf = digits(body.userCpf, 11);
      const profileId = text(body.profileId, 160);
      const unitIds = stringArray(body.unitIds);
      if (!userName || userCpf.length !== 11 || !profileId || !unitIds.length) throw new Error('Informe usuário, CPF, perfil e ao menos uma unidade.');
      const [profileDocument, ...unitDocuments] = await Promise.all([
        dbAdmin.collection('profiles').doc(profileId).get(),
        ...unitIds.map(unitId => dbAdmin.collection('dp_units').doc(unitId).get()),
      ]);
      if (!profileDocument.exists || profileDocument.get('isDefaultAdmin') === true) throw new Error('Perfil de acesso inválido para a prestadora.');
      if (unitDocuments.some(document => !document.exists || document.get('isArchived') === true)) throw new Error('Uma das unidades selecionadas não está disponível.');
      const profileName = text(profileDocument.get('name'), 180) || text(profileDocument.get('profileName'), 180) || profileDocument.id;
      const unitNames = unitDocuments.map(document => text(document.get('name'), 180) || document.id);
      const pdvRequired = body.pdvRequired === true;
      let pdv = { pdvUnitId: null as string | null, pdvUnitName: null as string | null, pdvFilialId: null as string | null, pdvFilialName: null as string | null, pdvProfileId: null as string | null, pdvProfileName: null as string | null };
      if (pdvRequired) {
        const pdvUnitId = text(body.pdvUnitId, 160);
        const pdvProfileId = text(body.pdvProfileId, 160);
        const unitIndex = unitIds.indexOf(pdvUnitId);
        if (unitIndex < 0 || !pdvProfileId) throw new Error('Selecione uma unidade liberada e um perfil para o PDV Legal.');
        const unitDocument = unitDocuments[unitIndex];
        const pdvFilialId = text(unitDocument.get('pdvFilialId'), 160) || (unitDocument.get('externalSource') === 'pdvlegal' ? text(unitDocument.get('externalId'), 160) : '');
        if (!pdvFilialId) throw new Error('A unidade selecionada não possui filial do PDV Legal vinculada.');
        const pdvProfiles = await fetchPdvLegalProfiles();
        const pdvProfile = pdvProfiles.find(profile => String(profile.id) === pdvProfileId);
        if (!pdvProfile) throw new Error('Perfil do PDV Legal não encontrado.');
        pdv = { pdvUnitId, pdvUnitName: unitNames[unitIndex], pdvFilialId, pdvFilialName: unitNames[unitIndex], pdvProfileId, pdvProfileName: String(pdvProfile.name) };
        update.pdvAccess = { required: true, status: 'pending', unitId: pdvUnitId, unitName: unitNames[unitIndex], filialId: pdvFilialId, filialName: unitNames[unitIndex], profileId: pdvProfileId, profileName: String(pdvProfile.name) };
      } else {
        update.pdvAccess = { required: false, status: 'not_required' };
      }
      nextWorkflow.access = { status: 'configured', userName, userCpf, profileId, profileName, unitIds, unitNames, pdvRequired, ...pdv, configuredAt: now, configuredBy: access.decoded.uid };
    } else if (action === 'activate') {
      if (workflow.currentStep !== 'provider_activation' || !text(process.collaboratorUserId, 200)) throw new Error('Crie e envie o acesso antes de ativar a prestadora.');
      if (record(process.firstAccess).status !== 'used') throw new Error('A prestadora ainda não concluiu o primeiro acesso ao Coala One.');
      if (workflow.access?.pdvRequired && record(process.pdvAccess).status !== 'completed') throw new Error('O primeiro acesso ao PDV Legal ainda não foi concluído.');
      nextWorkflow = {
        ...workflow,
        currentStep: 'provider_activation',
        steps: { ...workflow.steps, provider_activation: { ...workflow.steps.provider_activation, status: 'completed', completedAt: now, completedBy: access.decoded.uid } },
        activatedAt: now,
        activatedBy: access.decoded.uid,
      };
      update.status = 'completed';
      update.currentStage = 'done';
      update.completedAt = now;
      update.publicToken = null;
      update.publicTokenClosedAt = now;
    } else {
      return error('Ação inválida.');
    }

    update.pjWorkflow = nextWorkflow;
    await ref.set(update, { merge: true });
    await logAction({
      user_id: access.decoded.uid,
      username: access.decoded.email ?? null,
      module: 'recruitment.onboarding',
      action: `onboarding_pj_${action}`,
      metadata: { target_type: 'onboarding', target_id: id, target_name: workflow.provider.legalName, changed_fields: Object.keys(update) },
      ttl_days: 365,
    });
    const saved = await ref.get();
    return NextResponse.json({ process: { id: saved.id, ...((serializeHrValue(saved.data()) as Record<string, unknown>) ?? {}) } });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : 'Falha ao atualizar o fluxo PJ.', 400);
  }
}
