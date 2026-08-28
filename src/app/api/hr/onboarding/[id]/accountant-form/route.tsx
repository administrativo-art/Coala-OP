import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from 'react-pdf-renderer-server';
import { getStorage } from 'firebase-admin/storage';

import { AccountantAdmissionFormPdf } from '@/features/hr/accountant/admission-form-pdf';
import {
  buildAccountantDependentAnalysis,
  FAMILY_SALARY_LIMIT_2026,
  FAMILY_SALARY_QUOTA_2026,
} from '@/features/hr/accountant/dependent-analysis';
import { missingAccountantPrerequisites } from '@/features/hr/accountant/workflow';
import {
  resolveConfiguredMonthlySalary,
  salaryBaseFunctionId,
} from '@/features/hr/compensation/job-function-salary';
import { applyCoalaLetterheadToPdf } from '@/features/hr/documents/letterhead-pdf.server';
import { maritalStatusIsInformed } from '@/features/hr/onboarding/marital-status';
import { assertFormalizationAccess } from '@/features/hr/lib/server-access';
import { adminApp } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { applyOnboardingSignatureMode, normalizeOnboardingStages } from '@/lib/recruitment-onboarding';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import type { OnboardingDocument } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value: unknown, max = 500) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function dateBr(value: string) { const [year, month, day] = value.slice(0, 10).split('-'); return year && month && day ? `${day}/${month}/${year}` : value; }
function currency(value: number | null) { return value == null ? 'Não informado' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value); }
function numeric(value: unknown) { const number = typeof value === 'number' ? value : Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function safeFilePart(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'colaborador'; }
function probationContractLabel(onboarding: Record<string, unknown>) {
  const probation = record(onboarding.probationV2);
  const config = record(probation.config);
  const schedule = record(probation.schedule);
  const firstPeriod = record(schedule.firstPeriod);
  const secondPeriod = record(schedule.secondPeriod);
  const first = numeric(config.firstPeriodDays) ?? numeric(firstPeriod.days);
  const second = numeric(config.secondPeriodDays) ?? numeric(secondPeriod.days);
  if (first != null && second != null) return `${first} dias + ${second} dias`;
  if (first != null) return `${first} dias`;
  return 'Não informado';
}

function extractedText(documents: OnboardingDocument[], key: string) {
  for (const document of documents) {
    if (document.status !== 'approved') continue;
    const value = record(document.extractedFields)[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertFormalizationAccess(request, 'accountant.manage').catch(() => null);
  if (!access) return NextResponse.json({ error: 'Sem permissão para gerar o formulário do contador.' }, { status: 403 });
  const { id } = await context.params;
  const processRef = hrDbAdmin.collection('onboardingProcesses').doc(id);
  const snapshot = await processRef.get();
  if (!snapshot.exists) return NextResponse.json({ error: 'Integração não encontrada.' }, { status: 404 });
  const onboarding = snapshot.data() ?? {};
  const documents = Array.isArray(onboarding.documents) ? onboarding.documents as OnboardingDocument[] : [];
  const aso = record(record(onboarding.asoWorkflow).asoDocument);
  const missing = missingAccountantPrerequisites({ documents, asoApproved: text(aso.status) === 'approved', publicFormAnswers: onboarding.publicFormAnswers });
  if (missing.length) return NextResponse.json({ error: `A etapa do contador ainda não pode começar. Falta: ${missing.join('; ')}.` }, { status: 409 });
  if (!text(onboarding.expectedAdmissionDate, 10)) return NextResponse.json({ error: 'Revise e informe a data de admissão antes de gerar o formulário.' }, { status: 409 });

  const [roleSnapshot, functionSnapshot] = await Promise.all([
    text(onboarding.jobRoleId) ? hrDbAdmin.collection('jobRoles').doc(text(onboarding.jobRoleId)).get() : Promise.resolve(null),
    text(onboarding.functionId) ? hrDbAdmin.collection('jobFunctions').doc(text(onboarding.functionId)).get() : Promise.resolve(null),
  ]);
  const role = roleSnapshot?.data() ?? {};
  const jobFunction = functionSnapshot?.data() ?? {};
  const answers = record(onboarding.publicFormAnswers);
  const previousWorkflow = record(onboarding.accountantWorkflow);
  const previousFormData = record(previousWorkflow.formData);
  const storedMonthlySalary = numeric(onboarding.monthlySalary) ?? numeric(previousFormData.monthlySalary);
  const baseFunctionId = storedMonthlySalary == null ? salaryBaseFunctionId(jobFunction) : null;
  const baseFunctionSnapshot = baseFunctionId
    ? await hrDbAdmin.collection('jobFunctions').doc(baseFunctionId).get()
    : null;
  const monthlySalary = storedMonthlySalary ?? resolveConfiguredMonthlySalary({
    jobFunction,
    jobRole: role,
    baseFunction: baseFunctionSnapshot?.data(),
  });
  if (monthlySalary == null) {
    return NextResponse.json({ error: 'Informe a remuneração mensal antes de gerar o formulário da contabilidade.' }, { status: 409 });
  }
  const analysis = buildAccountantDependentAnalysis({ answers, documents, monthlySalary });
  const reviewedFormData = {
    companyName: text(previousFormData.companyName, 180)
      || text(onboarding.employerUnitName, 180)
      || text(onboarding.unitName, 180)
      || 'Empresa não informada',
    employerCnpj: CnpjValidator.clean(
      text(previousFormData.employerCnpj, 30) || text(onboarding.employerCnpj, 30),
    ),
    employeeName: text(previousFormData.employeeName, 180)
      || text(answers.fullName, 180)
      || text(onboarding.candidateName, 180),
    maritalStatus: (maritalStatusIsInformed(previousFormData.maritalStatus) ? text(previousFormData.maritalStatus, 80) : '')
      || text(answers.maritalStatus, 80)
      || extractedText(documents, 'maritalStatus')
      || 'Não informado',
    employeeCpf: text(previousFormData.employeeCpf, 30) || text(answers.cpf, 30) || 'Não informado',
    educationLevel: text(previousFormData.educationLevel, 120) || text(answers.educationLevel, 120) || 'Não informado',
    jobFunction: text(previousFormData.jobFunction, 180)
      || text(onboarding.functionName, 180)
      || text(onboarding.jobRoleName, 180)
      || 'Não informada',
    probationContract: text(previousFormData.probationContract, 120) || probationContractLabel(onboarding),
    weeklyRest: text(previousFormData.weeklyRest, 120) || text(onboarding.weeklyRest, 120) || 'Conforme escala',
    workSchedule: text(previousFormData.workSchedule, 400)
      || text(jobFunction.workSchedule, 400)
      || text(role.workSchedule, 400)
      || text(onboarding.shiftDefinitionName, 180)
      || 'Não informada',
  };
  if (!maritalStatusIsInformed(reviewedFormData.maritalStatus)) {
    return NextResponse.json({ error: 'Confirme o estado civil na revisão dos campos antes de gerar o formulário.' }, { status: 409 });
  }
  const employeeName = reviewedFormData.employeeName;
  const pdf = await renderToBuffer(AccountantAdmissionFormPdf({ data: {
    companyName: reviewedFormData.companyName,
    employerCnpj: CnpjValidator.format(reviewedFormData.employerCnpj),
    employeeName: reviewedFormData.employeeName,
    maritalStatus: reviewedFormData.maritalStatus,
    employeeCpf: reviewedFormData.employeeCpf,
    educationLevel: reviewedFormData.educationLevel,
    admissionDate: dateBr(text(onboarding.expectedAdmissionDate, 10)),
    jobFunction: reviewedFormData.jobFunction,
    salaryLabel: currency(monthlySalary),
    probationContract: reviewedFormData.probationContract,
    weeklyRest: reviewedFormData.weeklyRest,
    workSchedule: reviewedFormData.workSchedule,
    salaryLimitLabel: currency(FAMILY_SALARY_LIMIT_2026), quotaLabel: currency(FAMILY_SALARY_QUOTA_2026), familySalaryConclusion: analysis.conclusion,
    dependents: analysis.dependents,
  } }));
  const buffer = await applyCoalaLetterheadToPdf(Buffer.from(pdf));
  const hashSha256 = createHash('sha256').update(buffer).digest('hex');
  const generatedId = randomUUID(); const now = new Date().toISOString();
  const fileName = `formulario-admissao-contabilidade-${safeFilePart(employeeName)}.pdf`;
  const storagePath = `hr/onboarding/${id}/generated/accountant-forms/${generatedId}.pdf`;
  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, { resumable: false, metadata: { contentType: 'application/pdf', cacheControl: 'private, max-age=0, no-store', metadata: { onboardingId: id, generatedId, hashSha256 } } });
  const generated = { id: generatedId, kind: 'accountant_admission_form', templateVersion: '2.0', mimeType: 'application/pdf', fileName, storagePath, hashSha256, generatedAt: now, generatedBy: access.decoded.uid, generatedByEmail: access.decoded.email ?? null };
  await Promise.all([
    processRef.collection('generatedDocuments').doc(generatedId).set(generated),
    processRef.set({
      stages: applyOnboardingSignatureMode(normalizeOnboardingStages(onboarding.stages), onboarding.generateSignatureDocuments === true),
      currentStage: 'accountant',
      ...(onboarding.currentStage === 'accountant' ? {} : { currentStageStartedAt: now }),
      status: 'accountant_pending',
      accountantWorkflow: { ...previousWorkflow, status: 'form_generated', latestFormId: generatedId, latestFormHashSha256: hashSha256, latestFormGeneratedAt: now, latestFormRequiresRegeneration: false, latestFormStaleReasons: [], latestFormInvalidatedAt: null, formValidation: null, formData: { ...previousFormData, ...reviewedFormData, monthlySalary }, updatedAt: now }, updatedAt: now,
    }, { merge: true }),
    processRef.collection('accountantEvents').doc(randomUUID()).set({ type: 'ACCOUNTANT_FORM_GENERATED', at: now, actorId: access.decoded.uid, actorEmail: access.decoded.email ?? null, documentId: generatedId, hashSha256 }),
  ]);
  return new NextResponse(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fileName}"`, 'Cache-Control': 'private, no-store', 'X-Generated-Document-Id': generatedId, 'X-Content-SHA256': hashSha256 } });
}
