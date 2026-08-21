import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cwd } from 'node:process';
import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';

import { assertFormalizationAccess } from '@/features/hr/lib/server-access';
import { renderMedclincReferralPdf } from '@/features/hr/aso/medclinc-referral-pdf';
import { adminApp } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { CnpjValidator } from '@/lib/company/cnpj-validator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeFilePart(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'colaborador';
}

function formatCpf(value: unknown) {
  const digits = text(value).replace(/\D/g, '').slice(0, 11);
  return digits.length === 11
    ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
    : text(value);
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertFormalizationAccess(request, 'aso.manage').catch(() => null);
  if (!access) return NextResponse.json({ error: 'Sem permissão para gerar a guia do ASO.' }, { status: 403 });

  const { id } = await context.params;
  const processRef = hrDbAdmin.collection('onboardingProcesses').doc(id);
  const snapshot = await processRef.get();
  if (!snapshot.exists) return NextResponse.json({ error: 'Integração não encontrada.' }, { status: 404 });
  const process = snapshot.data() ?? {};
  const answers = process.publicFormAnswers && typeof process.publicFormAnswers === 'object'
    ? process.publicFormAnswers as Record<string, unknown>
    : {};
  const employerCnpj = CnpjValidator.clean(text(process.employerCnpj));
  if (!CnpjValidator.validate(employerCnpj).valid) {
    return NextResponse.json({ error: 'Selecione um CNPJ responsável válido na criação da integração.' }, { status: 400 });
  }

  const employeeName = text(answers.fullName) || text(process.candidateName);
  const employeeCpf = formatCpf(answers.cpf);
  const jobFunction = text(process.functionName) || text(process.jobRoleName);
  const examType = process.asoExamType === 'dismissal' ? 'dismissal' : 'admission';
  const missing = [
    !employeeName ? 'nome do colaborador' : null,
    !employeeCpf ? 'CPF do colaborador' : null,
    !jobFunction ? 'função' : null,
  ].filter((value): value is string => Boolean(value));
  if (missing.length > 0) {
    return NextResponse.json({ error: `A guia ainda não pode ser gerada. Falta: ${missing.join(', ')}.` }, { status: 400 });
  }

  const [logo, letterheadLogo] = await Promise.all([
    readFile(path.join(cwd(), 'src/features/hr/aso/assets/medclinc-logo.jpg')),
    readFile(path.join(cwd(), 'src/features/hr/aso/assets/coala-shakes-letterhead-v1.png')),
  ]);
  const pdf = await renderMedclincReferralPdf({
    companyName: text(process.employerUnitName) || text(process.unitName) || 'Empresa responsável',
    employerCnpj: CnpjValidator.format(employerCnpj),
    employeeName,
    employeeCpf,
    jobFunction,
    serviceDate: null,
    observations: null,
    logoDataUri: `data:image/jpeg;base64,${logo.toString('base64')}`,
    letterheadLogoDataUri: `data:image/png;base64,${letterheadLogo.toString('base64')}`,
    examType,
  });
  const buffer = Buffer.from(pdf);
  const hashSha256 = createHash('sha256').update(buffer).digest('hex');
  const generatedId = randomUUID();
  const now = new Date().toISOString();
  const fileName = `guia-aso-${examType === 'dismissal' ? 'demissional' : 'admissional'}-${safeFilePart(employeeName)}.pdf`;
  const storagePath = `hr/onboarding/${id}/generated/aso-guides/${generatedId}.pdf`;
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  await bucket.file(storagePath).save(buffer, {
    resumable: false,
    metadata: { contentType: 'application/pdf', cacheControl: 'private, max-age=0, no-store', metadata: { onboardingId: id, generatedId, hashSha256 } },
  });

  const record = {
    id: generatedId,
    kind: examType === 'dismissal' ? 'aso_dismissal_referral' : 'aso_admission_referral',
    provider: 'MedClinic',
    templateVersion: 'medclinic-v2',
    mimeType: 'application/pdf',
    fileName,
    storagePath,
    hashSha256,
    employerUnitId: text(process.employerUnitId) || null,
    employerUnitName: text(process.employerUnitName) || null,
    employerCnpj,
    paymentMethod: 'PIX',
    sector: 'GERAL',
    serviceDateStatus: 'to_be_defined_by_clinic',
    examType,
    examProgram: 'PCMSO',
    generatedAt: now,
    generatedBy: access.decoded.uid,
    generatedByEmail: access.decoded.email ?? null,
  };
  await processRef.collection('generatedDocuments').doc(generatedId).set(record);
  const workflow = recordValue(process.asoWorkflow);
  await processRef.set({
    asoWorkflow: {
      ...workflow,
      status: workflow.status ?? 'guide_generated',
      latestGuideId: generatedId,
      latestGuideHashSha256: hashSha256,
      latestGuideGeneratedAt: now,
      updatedAt: now,
    },
    updatedAt: now,
  }, { merge: true });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Generated-Document-Id': generatedId,
      'X-Content-SHA256': hashSha256,
    },
  });
}
