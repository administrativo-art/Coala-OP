/** @jsxImportSource react-pdf-react-server */
import React from 'react-pdf-react-server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderToBuffer } from 'react-pdf-renderer-server';

import { AccountantAdmissionFormPdf } from '../src/features/hr/accountant/admission-form-pdf';
import { applyCoalaLetterheadToPdf } from '../src/features/hr/documents/letterhead-pdf.server';

async function main() {
  const workspace = process.cwd();
  const outputDirectory = path.join(workspace, 'docs/modelos-documentos/contador');
  const outputPath = path.join(outputDirectory, 'formulario-admissao-contador-v2.pdf');

  const pdf = await renderToBuffer(<AccountantAdmissionFormPdf data={{
    companyName: 'EMPRESA DE EXEMPLO LTDA',
    employerCnpj: '00.000.000/0001-00',
    employeeName: 'COLABORADOR(A) DE EXEMPLO',
    maritalStatus: 'Não informado',
    employeeCpf: '000.000.000-00',
    educationLevel: 'Ensino Médio Completo',
    admissionDate: '25/07/2026',
    jobFunction: 'Atendente de Balcão',
    salaryLabel: 'R$ 1.787,30',
    probationContract: '45 dias + 45 dias',
    weeklyRest: 'Conforme escala',
    workSchedule: 'Jornada conforme função e escala da unidade',
    salaryLimitLabel: 'R$ 1.980,38',
    quotaLabel: 'R$ 67,54',
    familySalaryConclusion: 'ELEGÍVEL: 1 DEPENDENTE VALIDADO',
    dependents: [{
      name: 'DEPENDENTE DE EXEMPLO',
      birthDate: '10/03/2020',
      ageLabel: '6 anos',
      documentDetails: [
        'Certidão de nascimento: aprovado',
        'Caderneta de vacinação: aprovado',
        'Comprovante de frequência escolar: aprovado',
      ].join('\n'),
      eligibility: 'Elegível',
    }],
  }} />);

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, await applyCoalaLetterheadToPdf(Buffer.from(pdf)));
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
