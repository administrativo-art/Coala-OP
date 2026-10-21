import { generateRepPAfd, signRepPAfd, type RepPAfdEvent } from './afd';
import { hashRepPType7 } from './core';
import { createRepPIcpSigners, type RepPIcpIdentity } from './icp-signer';
import { REP_P_RECEIPT_TITLE, renderRepPReceiptPdf, signRepPReceipt, type RepPReceiptSnapshot } from './receipt';

/**
 * Amostras de homologação para os verificadores oficiais (ITI): AFD com .p7s e comprovante PAdES,
 * assinados pela credencial real da desenvolvedora, mas com dados fictícios e marcados como amostra.
 * Nunca usam dados da ARP nem registram batida. O empregador fictício impede confundir com AFD oficial.
 */
export const REP_P_SAMPLE_EMPLOYER = Object.freeze({
  cnpj: '11222333000181',
  legalName: 'AMOSTRA DE HOMOLOGACAO SEM VALIDADE',
  workLocation: 'AMOSTRA - ENDERECO FICTICIO, SEM VALIDADE',
});
const SAMPLE_EMPLOYEE = Object.freeze({ cpf: '52998224725', name: 'TRABALHADOR FICTICIO AMOSTRA' });
const SAMPLE_INPI = '00000000000000000';

export async function buildRepPHomologationSamples(identity: RepPIcpIdentity, input: {
  developerCnpj: string; instant: string; now?: Date;
}) {
  const signers = createRepPIcpSigners(identity, () => input.now ?? new Date());
  const establishmentId = 'amostra-homologacao';
  const markingSource = { nsr: 3, markedAt: input.instant, employeeCpf: SAMPLE_EMPLOYEE.cpf, recordedAt: input.instant,
    collectorId: '02' as const, mode: '0' as const, previousHash: null };
  const hash = hashRepPType7(markingSource);
  const events: RepPAfdEvent[] = [
    { recordType: '2', nsr: 1, establishmentId, recordedAt: input.instant, responsibleCpf: SAMPLE_EMPLOYEE.cpf,
      employerCnpj: REP_P_SAMPLE_EMPLOYER.cnpj, employerLegalName: REP_P_SAMPLE_EMPLOYER.legalName,
      workLocation: REP_P_SAMPLE_EMPLOYER.workLocation },
    { recordType: '5', nsr: 2, establishmentId, recordedAt: input.instant, operation: 'I', employeeCpf: SAMPLE_EMPLOYEE.cpf,
      employeeName: SAMPLE_EMPLOYEE.name, responsibleCpf: SAMPLE_EMPLOYEE.cpf },
    { recordType: '7', establishmentId, ...markingSource, hash },
  ];
  const date = input.instant.slice(0, 10);
  const afd = await signRepPAfd(generateRepPAfd({ profile: { establishmentId, employerCnpj: REP_P_SAMPLE_EMPLOYER.cnpj,
    employerLegalName: REP_P_SAMPLE_EMPLOYER.legalName, inpiRegistration: SAMPLE_INPI, developerCnpj: input.developerCnpj },
  startDate: date, endDate: date, generatedAt: input.instant, events }), signers.cades, input.developerCnpj);

  const snapshot: RepPReceiptSnapshot = { schemaVersion: 1, title: REP_P_RECEIPT_TITLE, nsr: 3, markedAt: input.instant, hash,
    employerLegalName: REP_P_SAMPLE_EMPLOYER.legalName, employerCnpj: REP_P_SAMPLE_EMPLOYER.cnpj, cnoCaepf: null,
    workLocation: REP_P_SAMPLE_EMPLOYER.workLocation, inpiRegistration: SAMPLE_INPI, developerCnpj: input.developerCnpj,
    employeeName: SAMPLE_EMPLOYEE.name, employeeCpf: SAMPLE_EMPLOYEE.cpf, collectorId: '02',
    establishmentId, executionUnitId: establishmentId };
  // O rodapé de amostra declara dados fictícios e ausência de validade; a assinatura é real.
  const receipt = await signRepPReceipt(snapshot, await renderRepPReceiptPdf(snapshot, { sample: true }), signers.pades);
  return {
    afd: { filename: `AMOSTRA_${afd.filename}`, bytes: afd.bytes, signatureFilename: `AMOSTRA_${afd.signatureFilename}`,
      signature: afd.signature, sha256: afd.sha256 },
    receipt: { filename: `AMOSTRA_${receipt.filename}`, bytes: receipt.bytes, sha256: receipt.sha256 },
  };
}
