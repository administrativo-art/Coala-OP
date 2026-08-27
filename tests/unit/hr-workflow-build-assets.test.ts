import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { renderToBuffer } from 'react-pdf-renderer-server';

import nextConfig from '../../next.config.mjs';
import { AccountantAdmissionFormPdf } from '../../src/features/hr/accountant/admission-form-pdf';
import { applyCoalaLetterheadToPdf } from '../../src/features/hr/documents/letterhead-pdf.server';

const workspace = process.cwd();
const tracingIncludes = (nextConfig.outputFileTracingIncludes ?? {}) as Record<string, string[]>;
const documentPdfRuntimeAssets = [
  './src/features/hr/documents/assets/coala-shakes-letterhead-overlay-a4-v2.png',
  './node_modules/@fontsource/caladea/files/caladea-latin-400-normal.woff',
  './node_modules/@fontsource/caladea/files/caladea-latin-700-normal.woff',
];
const systemDocumentTemplateAssets = [
  './docs/modelos-documentos/**/*.docx',
  './src/features/hr/documents/assets/coala-shakes-letterhead-a4-v2.png',
  ...documentPdfRuntimeAssets,
];

const onboardingRuntimeAssets: Record<string, string[]> = {
  '/api/hr/onboarding/*/aso-workflow': [
    './public/coala-email-logo.jpg',
    './public/email/icons/file-text-pink.png',
    './public/email/icons/calendar-days-white.png',
    './public/email/icons/boxes/file-text-pink-14-in-28-fff0f6-r8.png',
    './public/email/icons/boxes/stethoscope-white-20-in-36-28b3d0-r11.png',
    './public/email/icons/boxes/building-2-pink-14-in-28-fff0f6-r9.png',
    './public/email/icons/boxes/user-round-pink-14-in-28-fff0f6-r9.png',
  ],
  '/api/hr/onboarding/*/aso-guide': [
    './src/features/hr/aso/assets/medclinc-logo.jpg',
    './src/features/hr/aso/assets/coala-shakes-letterhead-v1.png',
  ],
  '/api/hr/onboarding/*/accountant-form': [
    ...documentPdfRuntimeAssets,
  ],
  '/api/hr/onboarding/*/signature-documents': systemDocumentTemplateAssets,
  '/api/documents/generate': systemDocumentTemplateAssets,
  '/api/documents/generated/*': documentPdfRuntimeAssets,
  '/api/documents/templates/**': systemDocumentTemplateAssets,
};

function allFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(absolute) : [absolute];
  });
}

function sourceFiles(directory: string) {
  return allFiles(directory).filter(file => /\.(?:ts|tsx)$/.test(file));
}

function localAssetExists(assetPattern: string) {
  if (!assetPattern.includes('*')) return existsSync(path.resolve(workspace, assetPattern));
  const wildcardAt = assetPattern.indexOf('*');
  const root = path.resolve(workspace, assetPattern.slice(0, wildcardAt).replace(/\/$/, ''));
  const suffix = assetPattern.slice(assetPattern.lastIndexOf('*') + 1);
  return existsSync(root) && allFiles(root).some(file => file.endsWith(suffix));
}

test('empacota todos os ativos locais usados pelas etapas da integração', () => {
  for (const [route, expectedAssets] of Object.entries(onboardingRuntimeAssets)) {
    const configuredAssets = tracingIncludes[route] ?? [];
    for (const asset of expectedAssets) {
      assert.ok(configuredAssets.includes(asset), `${route} não empacota ${asset}`);
      assert.ok(localAssetExists(asset), `Ativo local ausente: ${asset}`);
    }
  }
});

test('isola o renderizador de PDF do servidor sem alterar o pacote do navegador', () => {
  assert.ok(nextConfig.serverExternalPackages?.includes('react-pdf-renderer-server'));
  assert.ok(nextConfig.serverExternalPackages?.includes('react-pdf-react-server'));
  const transpilePackages = 'transpilePackages' in nextConfig
    ? nextConfig.transpilePackages as string[] | undefined
    : undefined;
  assert.ok(transpilePackages?.includes('@react-pdf/renderer'));

  const serverPdfSources = [
    'src/app/api/hr/onboarding/[id]/accountant-form/route.tsx',
    'src/features/hr/accountant/admission-form-pdf.tsx',
    'src/app/api/hr/onboarding/[id]/pj-workflow/route.ts',
    'src/features/hr/onboarding-pj/contract-pdf.tsx',
    'src/features/hr/termination/server.ts',
    'src/features/hr/termination/pj-termination-agreement-pdf.tsx',
    'src/features/hr/documents/system-template-preview.server.tsx',
    'src/features/uniforms/term.server.tsx',
    'src/components/pdf/UniformTermDocument.tsx',
  ];
  for (const relativePath of serverPdfSources) {
    const source = readFileSync(path.join(workspace, relativePath), 'utf8');
    assert.doesNotMatch(source, /from ['"]@react-pdf\/renderer['"]/, `${relativePath} usa o renderizador incompatível no servidor`);
  }
});

test('mantém os geradores de PDF da demissão independentes de ativos locais não empacotados', () => {
  const roots = [
    path.join(workspace, 'src/features/hr/termination'),
    path.join(workspace, 'src/app/api/hr/terminations'),
  ];
  const offenders = roots.flatMap(sourceFiles).filter(file => {
    const source = readFileSync(file, 'utf8');
    return /(?:node:fs|readFile\s*\(|process\.cwd\s*\()/.test(source);
  });

  assert.deepEqual(offenders, [], `Rotas de demissão com ativo local sem contrato de empacotamento: ${offenders.join(', ')}`);
});

test('renderiza o formulário do contador com o timbre empacotado', async () => {
  const document = AccountantAdmissionFormPdf({ data: {
    companyName: 'CT Sorvetes Ltda.',
    employerCnpj: '00.000.000/0001-00',
    employeeName: 'Candidata de teste',
    maritalStatus: 'Solteira',
    employeeCpf: '000.000.000-00',
    educationLevel: 'Ensino médio completo',
    admissionDate: '24/08/2026',
    jobFunction: 'Atendente',
    salaryLabel: 'R$ 1.600,00',
    probationContract: '45 dias + 45 dias',
    weeklyRest: 'Conforme escala',
    workSchedule: '44 horas semanais',
    salaryLimitLabel: 'R$ 1.980,38',
    quotaLabel: 'R$ 67,54',
    familySalaryConclusion: 'SEM DEPENDENTES ELEGÍVEIS',
    dependents: [],
  } }) as Parameters<typeof renderToBuffer>[0];

  const pdf = await applyCoalaLetterheadToPdf(Buffer.from(await renderToBuffer(document)));
  assert.equal(pdf.subarray(0, 4).toString('ascii'), '%PDF');
  assert.ok(pdf.length > 10_000);
});

test('a rota do contador usa o papel timbrado institucional e exige remuneração', () => {
  const route = readFileSync(path.join(workspace, 'src/app/api/hr/onboarding/[id]/accountant-form/route.tsx'), 'utf8');

  assert.match(route, /applyCoalaLetterheadToPdf/);
  assert.match(route, /Informe a remuneração mensal antes de gerar/);
  assert.match(route, /const onboarding = snapshot\.data\(\)/);
  assert.doesNotMatch(route, /coala-shakes-letterhead-v1/);
  assert.doesNotMatch(route, /const process = snapshot\.data\(\)/);
});
