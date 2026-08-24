import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cwd } from 'node:process';
import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { getStorage } from 'firebase-admin/storage';

import { AccountantAdmissionFormPdf, type AccountantDependentAnalysis } from '@/features/hr/accountant/admission-form-pdf';
import { missingAccountantPrerequisites } from '@/features/hr/accountant/workflow';
import { assertFormalizationAccess } from '@/features/hr/lib/server-access';
import { dependentAge, familyRequiredDocs } from '@/features/hr/lib/family-salary';
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

const FAMILY_DOCUMENT_NAMES: Record<string, string> = {
  'certidão': 'Certidão de nascimento',
  'vacinação': 'Caderneta de vacinação',
  'frequência escolar': 'Comprovante de frequência escolar',
};

function salaryFrom(source: Record<string, unknown>) {
  const salaryRange = record(source.salaryRange);
  const publicRange = record(source.publicSalaryRange);
  return numeric(salaryRange.min) ?? numeric(publicRange.min);
}

function extractedText(documents: OnboardingDocument[], key: string) {
  for (const document of documents) {
    if (document.status !== 'approved') continue;
    const value = record(document.extractedFields)[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function dependentAnalysis(answers: Record<string, unknown>, documents: OnboardingDocument[], monthlySalary: number | null) {
  const children = Array.isArray(answers.children) ? answers.children.map(record) : [];
  const limit = 1980.38;
  let eligible = 0;
  let pending = 0;
  const dependents: AccountantDependentAnalysis[] = children.map((child, index) => {
    const birthDate = text(child.birthDate, 10);
    const age = dependentAge(birthDate || null);
    const required = familyRequiredDocs(birthDate || null);
    const approved = required.filter((kind) => documents.find((document) => document.id === `child_${index + 1}_${kind}`)?.status === 'approved');
    const documentsComplete = required.length === approved.length;
    const ageEligible = age != null && age >= 0 && age < 14;
    const incomeEligible = monthlySalary != null && monthlySalary <= limit;
    let eligibility = 'Não elegível pela idade';
    if (ageEligible && !documentsComplete) { eligibility = 'Pendente de documentação'; pending += 1; }
    else if (ageEligible && monthlySalary == null) { eligibility = 'Aguardando remuneração'; pending += 1; }
    else if (ageEligible && !incomeEligible) eligibility = 'Não elegível pela renda';
    else if (ageEligible) { eligibility = 'Elegível'; eligible += 1; }
    return {
      name: text(child.name, 160) || `Dependente ${index + 1}`,
      birthDate: birthDate ? dateBr(birthDate) : 'Não informada',
      ageLabel: age == null ? 'Pendente' : `${age} ano${age === 1 ? '' : 's'}`,
      documentDetails: required.length === 0
        ? 'Nenhum documento exigido pela idade'
        : required.map((kind) => `${FAMILY_DOCUMENT_NAMES[kind] ?? kind}: ${approved.includes(kind) ? 'aprovado' : 'pendente'}`).join('\n'),
      eligibility,
    };
  });
  const conclusion = monthlySalary == null
    ? 'ANÁLISE PENDENTE: REMUNERAÇÃO NÃO INFORMADA'
    : monthlySalary > limit
      ? 'NÃO ELEGÍVEL PELO CRITÉRIO DE RENDA'
      : eligible > 0
        ? `ELEGÍVEL: ${eligible} DEPENDENTE${eligible === 1 ? '' : 'S'} VALIDADO${eligible === 1 ? '' : 'S'}`
        : pending > 0
          ? 'AGUARDANDO VALIDAÇÃO DOS DEPENDENTES'
          : 'SEM DEPENDENTES ELEGÍVEIS'
  return { dependents, conclusion };
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
  const missing = missingAccountantPrerequisites({ documents, asoApproved: text(aso.status) === 'approved', expectedAdmissionDate: text(onboarding.expectedAdmissionDate, 10), publicFormAnswers: onboarding.publicFormAnswers });
  if (missing.length) return NextResponse.json({ error: `A etapa do contador ainda não pode começar. Falta: ${missing.join('; ')}.` }, { status: 409 });

  const [roleSnapshot, functionSnapshot] = await Promise.all([
    text(onboarding.jobRoleId) ? hrDbAdmin.collection('jobRoles').doc(text(onboarding.jobRoleId)).get() : Promise.resolve(null),
    text(onboarding.functionId) ? hrDbAdmin.collection('jobFunctions').doc(text(onboarding.functionId)).get() : Promise.resolve(null),
  ]);
  const role = roleSnapshot?.data() ?? {};
  const jobFunction = functionSnapshot?.data() ?? {};
  const answers = record(onboarding.publicFormAnswers);
  const previousWorkflow = record(onboarding.accountantWorkflow);
  const previousFormData = record(previousWorkflow.formData);
  const monthlySalary = numeric(onboarding.monthlySalary) ?? numeric(previousFormData.monthlySalary) ?? salaryFrom(jobFunction) ?? salaryFrom(role);
  const analysis = dependentAnalysis(answers, documents, monthlySalary);
  const employerCnpj = CnpjValidator.clean(text(onboarding.employerCnpj, 30));
  const employeeName = text(answers.fullName, 180) || text(onboarding.candidateName, 180);
  const logo = await readFile(path.join(cwd(), 'src/features/hr/aso/assets/coala-shakes-letterhead-v1.png'));
  const pdf = await renderToBuffer(<AccountantAdmissionFormPdf data={{
    companyName: text(onboarding.employerUnitName, 180) || text(onboarding.unitName, 180) || 'Empresa não informada',
    employerCnpj: CnpjValidator.format(employerCnpj), employeeName,
    maritalStatus: text(answers.maritalStatus, 80) || extractedText(documents, 'maritalStatus') || 'Não informado', employeeCpf: text(answers.cpf, 20),
    educationLevel: text(answers.educationLevel, 120) || 'Não informado', admissionDate: dateBr(text(onboarding.expectedAdmissionDate, 10)),
    jobFunction: text(onboarding.functionName, 180) || text(onboarding.jobRoleName, 180), salaryLabel: currency(monthlySalary),
    probationContract: probationContractLabel(onboarding), weeklyRest: text(onboarding.weeklyRest, 120) || 'Conforme escala',
    workSchedule: text(jobFunction.workSchedule, 400) || text(role.workSchedule, 400) || text(onboarding.shiftDefinitionName, 180) || 'Não informada',
    salaryLimitLabel: currency(1980.38), quotaLabel: currency(67.54), familySalaryConclusion: analysis.conclusion,
    dependents: analysis.dependents, logoDataUri: `data:image/png;base64,${logo.toString('base64')}`,
  }} />);
  const buffer = Buffer.from(pdf); const hashSha256 = createHash('sha256').update(buffer).digest('hex');
  const generatedId = randomUUID(); const now = new Date().toISOString();
  const fileName = `formulario-admissao-contabilidade-${safeFilePart(employeeName)}.pdf`;
  const storagePath = `hr/onboarding/${id}/generated/accountant-forms/${generatedId}.pdf`;
  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, { resumable: false, metadata: { contentType: 'application/pdf', cacheControl: 'private, max-age=0, no-store', metadata: { onboardingId: id, generatedId, hashSha256 } } });
  const generated = { id: generatedId, kind: 'accountant_admission_form', templateVersion: '1.0', mimeType: 'application/pdf', fileName, storagePath, hashSha256, generatedAt: now, generatedBy: access.decoded.uid, generatedByEmail: access.decoded.email ?? null };
  await Promise.all([
    processRef.collection('generatedDocuments').doc(generatedId).set(generated),
    processRef.set({
      stages: applyOnboardingSignatureMode(normalizeOnboardingStages(onboarding.stages), onboarding.generateSignatureDocuments === true),
      currentStage: 'accountant',
      ...(onboarding.currentStage === 'accountant' ? {} : { currentStageStartedAt: now }),
      status: 'accountant_pending',
      accountantWorkflow: { ...previousWorkflow, status: 'form_generated', latestFormId: generatedId, latestFormHashSha256: hashSha256, latestFormGeneratedAt: now, formValidation: null, formData: { monthlySalary }, updatedAt: now }, updatedAt: now,
    }, { merge: true }),
    processRef.collection('accountantEvents').doc(randomUUID()).set({ type: 'ACCOUNTANT_FORM_GENERATED', at: now, actorId: access.decoded.uid, actorEmail: access.decoded.email ?? null, documentId: generatedId, hashSha256 }),
  ]);
  return new NextResponse(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fileName}"`, 'Cache-Control': 'private, no-store', 'X-Generated-Document-Id': generatedId, 'X-Content-SHA256': hashSha256 } });
}
