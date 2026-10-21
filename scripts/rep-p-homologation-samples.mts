/**
 * Gera amostras de homologação do REP-P (AFD + .p7s e comprovante PAdES) com dados fictícios,
 * assinadas pela credencial ICP-Brasil da desenvolvedora, para validar nos verificadores do ITI.
 *
 * A credencial (chave + certificados em PEM) chega pela entrada padrão e nunca é gravada:
 *   gcloud secrets versions access latest --secret=REP_P_ICP_SIGNER_PEM --project=<projeto> \
 *     | node --import tsx scripts/rep-p-homologation-samples.mts --out <pasta> --confirm-sample
 * Não lê nem escreve em banco e não registra batida.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildRepPHomologationSamples } from '../src/features/dp/rep-p/homologation-samples';
import { loadRepPIcpIdentity } from '../src/features/dp/rep-p/icp-signer';

const DEVELOPER_CNPJ = '14276603000125';
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
if (!args.includes('--confirm-sample') || outIndex < 0 || !args[outIndex + 1]) {
  process.stderr.write('Uso: <PEM pela entrada padrão> | node --import tsx scripts/rep-p-homologation-samples.mts --out <pasta> --confirm-sample\n');
  process.exit(2);
}
if (process.stdin.isTTY) {
  process.stderr.write('A credencial PEM deve chegar pela entrada padrão (pipe); não digite nem cole a chave.\n');
  process.exit(2);
}
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const identity = loadRepPIcpIdentity(Buffer.concat(chunks).toString('utf8'), DEVELOPER_CNPJ);
const instant = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(', ', 'T');
const samples = await buildRepPHomologationSamples(identity, { developerCnpj: DEVELOPER_CNPJ, instant: `${instant}:00-0300` });
const out = resolve(args[outIndex + 1]);
mkdirSync(out, { recursive: true });
const files: [string, Buffer][] = [[samples.afd.filename, samples.afd.bytes], [samples.afd.signatureFilename, samples.afd.signature],
  [samples.receipt.filename, samples.receipt.bytes]];
for (const [name, bytes] of files) {
  writeFileSync(join(out, name), bytes, { flag: 'wx' });
  console.log(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
console.log(`Certificado: CNPJ ${identity.cnpj}, válido até ${identity.notAfter.toISOString().slice(0, 10)}. Amostras em ${out}`);
