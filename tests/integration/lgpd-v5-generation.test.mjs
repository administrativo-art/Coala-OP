import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

const projectId = 'demo-coala-repository';
assertFirestoreEmulatorSafety({ projectId });
assert.match(process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '', /^(127\.0\.0\.1|localhost):\d+$/);
assert.equal(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, `${projectId}.appspot.com`);
assert.equal(process.env.FIREBASE_PROJECT_ID, projectId);

const { PDFDocument } = await import('pdf-lib');
const { default: PizZip } = await import('pizzip');
const { dbAdmin, adminApp } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { getStorage } = await import('firebase-admin/storage');
const { generateDocumentFromTemplate } = await import('../../src/features/hr/documents/generate-document.server.ts');
const { systemDocumentTemplateById } = await import('../../src/features/hr/documents/system-template-catalog.ts');
const { generateDocx, extractDocxVariables } = await import('../../src/features/hr/documents/docx-generator.ts');
const { convertDocxToPdf } = await import('../../src/features/hr/documents/pdf-converter.server.ts');
const { applyCoalaLetterheadToPdf } = await import('../../src/features/hr/documents/letterhead-pdf.server.ts');
const { buildAdmissionPdfBundle } = await import('../../src/features/hr/documents/admission-pdf-bundle.server.ts');
const { admissionClosingComponentsSummary } = await import('../../src/features/hr/documents/admission-closing-term.ts');
const { admissionBundleSignerPositions } = await import('../../src/features/hr/documents/admission-signature-positions.ts');
const { admissionSignaturePackageTemplateIds } = await import('../../src/features/hr/documents/admission-signature-order.ts');
const { buildDocumentTemplateDemoData } = await import('../../src/features/hr/documents/document-template-demo-data.ts');

const template = systemDocumentTemplateById('system-admission-lgpd-awareness-term');
const bucket = getStorage(adminApp).bucket(`${projectId}.appspot.com`);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const prefix = 'synthetic-lgpd-v5';
const outputs = process.env.LGPD_VALIDATION_OUTPUT_DIR;
const realConverter = process.env.LGPD_VALIDATION_REAL_CONVERTER === 'true';
if (realConverter) {
  assert.equal(process.env.DOCX_TO_PDF_URL, 'https://coala-gotenberg-qsrxz2aeqa-rj.a.run.app');
  assert.equal(process.env.DOCX_TO_PDF_AUDIENCE, process.env.DOCX_TO_PDF_URL);
}

test('LGPD v5: geração, PDF, pacote, troca de versão e histórico em emuladores', { timeout: 600_000 }, async (t) => {
  let converter;
  const oldUrl = process.env.DOCX_TO_PDF_URL;
  const oldAudience = process.env.DOCX_TO_PDF_AUDIENCE;
  const oldToken = process.env.DOCX_TO_PDF_ID_TOKEN;
  const templateRef = dbAdmin.collection('companyDocumentTemplates').doc(template.id);
  const stateRef = dbAdmin.collection('systemDocumentTemplateStates').doc(template.id);
  const onboarding = hrDbAdmin.collection('onboardingProcesses').doc(prefix);
  const longOnboarding = hrDbAdmin.collection('onboardingProcesses').doc(`${prefix}-long`);
  const invalidOnboarding = hrDbAdmin.collection('onboardingProcesses').doc(`${prefix}-missing`);
  const refs = [onboarding, longOnboarding, invalidOnboarding, templateRef, stateRef];
  const generated = new Set();
  const fixture = {
    candidateName: 'Pessoa Fictícia de Homologação',
    publicFormAnswers: { cpf: '52998224725' },
    employerUnitName: 'EMPREGADORA FICTÍCIA PARA ENSAIO LTDA',
    employerCnpj: '11222333000181',
    employerAddress: 'Rua Fictícia de Homologação, 123, Centro, Belém/PA, CEP 66000-000',
  };
  const params = { templateId: template.id, onboardingId: prefix, includeSensitive: true,
    actorId: 'synthetic-dp', actorName: 'DP Fictício', lifecycle: 'final' };
  const save = async (name, bytes) => {
    if (outputs) { await mkdir(outputs, { recursive: true }); await writeFile(path.join(outputs, name), bytes); }
  };
  const generate = async (overrides = {}) => {
    const result = await generateDocumentFromTemplate({ ...params, ...overrides });
    generated.add(result.id);
    return result;
  };
  const restoreEnv = (key, value) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };

  try {
    if (!realConverter) {
      // CI/local isolado: exercita multipart HTTP e o pipeline, sem alegar validar LibreOffice.
      const pdf = await PDFDocument.create();
      pdf.addPage([595.28, 841.89]);
      const response = Buffer.from(await pdf.save());
      converter = createServer(async (request, reply) => {
        try {
          const data = await new Request('http://localhost/convert', {
            method: 'POST', headers: request.headers, body: request, duplex: 'half',
          }).formData();
          const file = data.get('files');
          assert.ok(file instanceof File);
          assert.deepEqual(extractDocxVariables(Buffer.from(await file.arrayBuffer())), []);
          reply.writeHead(200, { 'content-type': 'application/pdf' });
          reply.end(response);
        } catch { reply.writeHead(400); reply.end(); }
      });
      await new Promise((resolve) => converter.listen(0, '127.0.0.1', resolve));
      process.env.DOCX_TO_PDF_URL = `http://127.0.0.1:${converter.address().port}`;
      delete process.env.DOCX_TO_PDF_AUDIENCE;
      delete process.env.DOCX_TO_PDF_ID_TOKEN;
    }
    await Promise.all([onboarding.set(fixture), templateRef.delete(), stateRef.delete()]);

    await t.test('recusa cada campo obrigatório ausente antes de gravar documento', async () => {
      for (const patch of [{ candidateName: '' }, { publicFormAnswers: {} }, { employerUnitName: '' },
        { employerCnpj: '' }, { employerAddress: '' }]) {
        await invalidOnboarding.set({ ...fixture, ...patch });
        await assert.rejects(generate({ onboardingId: invalidOnboarding.id }), /geração foi bloqueada/i);
      }
      const rows = await dbAdmin.collection('generatedDocuments').where('onboardingId', '==', invalidOnboarding.id).get();
      assert.equal(rows.size, 0);
    });

    let first;
    let pdfBytes;
    await t.test('gera v5 completa com auditoria, PDF timbrado e repetição idempotente', async () => {
      first = await generate();
      assert.equal(first.templateVersion, 5);
      assert.deepEqual(extractDocxVariables(first.buffer), []);
      const xml = new PizZip(first.buffer).file('word/document.xml').asText();
      assert.ok(xml.includes(fixture.candidateName));
      assert.ok(xml.includes('3-A. Localização'));
      assert.ok(first.pdfStoragePath, 'conversão deve produzir PDF, sem aceitar degradação silenciosa');
      pdfBytes = (await bucket.file(first.pdfStoragePath).download())[0];
      const pdf = await PDFDocument.load(pdfBytes);
      assert.ok(pdf.getPageCount() > 0);
      const doc = await dbAdmin.collection('generatedDocuments').doc(first.id).get();
      assert.equal(doc.get('templateVersion'), 5);
      assert.equal(doc.get('templateContentHash'), template.contentHash);
      assert.equal(doc.get('pdfContentHash'), hash(pdfBytes));
      assert.equal(doc.get('pdfGenerationStatus'), 'ready');
      assert.ok((await doc.ref.collection('audit').doc('resolvedValues').get()).exists);
      const again = await generate();
      assert.equal(again.id, first.id);
      assert.deepEqual(again.buffer, first.buffer);
      assert.equal(again.pdfStoragePath, first.pdfStoragePath);
      assert.equal((await dbAdmin.collection('generatedDocuments').where('onboardingId', '==', prefix).get()).size, 1);
      await save('lgpd-v5-filled.docx', first.buffer);
      await save('lgpd-v5-filled.pdf', pdfBytes);
    });

    await t.test('nomes longos, acentos e caracteres XML são preenchidos sem campos pendentes', async () => {
      const name = 'Pessoa Fictícia Áurea da Conceição de Albuquerque e Vasconcelos de São José dos Campos';
      const employer = 'EMPREGADORA FICTÍCIA COMÉRCIO & SERVIÇOS DE ALIMENTAÇÃO E ADMINISTRAÇÃO DE UNIDADES LTDA';
      await longOnboarding.set({ ...fixture, candidateName: name, employerUnitName: employer,
        employerAddress: `${fixture.employerAddress}, Bloco de Homologação & Testes, Sala 1200, `
          + 'Complemento extenso para conferência de quebra de linha e paginação em endereço fictício' });
      const result = await generate({ onboardingId: longOnboarding.id });
      assert.deepEqual(extractDocxVariables(result.buffer), []);
      const xml = new PizZip(result.buffer).file('word/document.xml').asText();
      assert.ok(xml.includes(name));
      assert.ok(xml.includes('COMÉRCIO &amp; SERVIÇOS'));
      assert.ok(result.pdfStoragePath);
      const bytes = (await bucket.file(result.pdfStoragePath).download())[0];
      assert.ok((await PDFDocument.load(bytes)).getPageCount() > 0);
      await save('lgpd-v5-long.docx', result.buffer);
      await save('lgpd-v5-long.pdf', bytes);
    });

    await t.test('modelo v4 armazenado prevalece: atualização do banco é pré-condição da entrega da v5', async () => {
      const source = await readFile('docs/modelos-documentos/admissionais/03-termo-lgpd-v4.docx');
      const storagePath = `synthetic-lgpd-validation/${prefix}/template-v4.docx`;
      await bucket.file(storagePath).save(source, { resumable: false });
      await templateRef.set({ ...JSON.parse(JSON.stringify(template)), version: 4, storagePath, contentHash: hash(source), status: 'published' });
      const previous = await generate();
      assert.equal(previous.templateVersion, 4);
      assert.notEqual(previous.id, first.id);
      assert.equal(new PizZip(previous.buffer).file('word/document.xml').asText().includes('3-A. Localização'), false);
      // Marca histórica no emulador: não envia nada ao provedor de assinatura.
      const previousRef = dbAdmin.collection('generatedDocuments').doc(previous.id);
      await previousRef.update({ status: 'signed', signatureStatus: 'signed', signatureProvider: 'synthetic-fixture' });
      const original = (await previousRef.get()).data();
      const pdfHash = hash((await bucket.file(previous.pdfStoragePath).download())[0]);
      const v5 = await readFile(template.sourcePath);
      const v5Path = `synthetic-lgpd-validation/${prefix}/template-v5.docx`;
      await bucket.file(v5Path).save(v5, { resumable: false });
      await templateRef.update({ version: 5, storagePath: v5Path, contentHash: hash(v5) });
      const current = await generate();
      assert.equal(current.templateVersion, 5);
      assert.equal(current.id, first.id);
      assert.deepEqual((await previousRef.get()).data(), original);
      assert.equal(hash((await bucket.file(previous.pdfStoragePath).download())[0]), pdfHash);
      const invalid = { contentHash: '0'.repeat(64) };
      await templateRef.update(invalid);
      await assert.rejects(generate({ revisionKey: 'tampered-template' }), /DOCX publicado não corresponde/i);
      await templateRef.update({ contentHash: hash(v5) });
    });

    await t.test('pacote com PDF v5 real recalcula índice e posiciona assinaturas no encerramento', async () => {
      const components = [];
      const expectedIndex = [];
      let nextPage = 1;
      const closingId = 'system-admission-bundle-closing-term';
      // A seleção manual exclui o encerramento, acrescentado automaticamente pelo fluxo.
      const expectedIds = [...admissionSignaturePackageTemplateIds('yes'), closingId];
      for (const id of expectedIds.filter((id) => id !== closingId)) {
        const item = systemDocumentTemplateById(id);
        let docx;
        let pdf;
        if (id === template.id) { docx = first.buffer; pdf = pdfBytes; }
        else {
          const data = buildDocumentTemplateDemoData({ variables: item.variables, fieldMapping: item.fieldMapping });
          const replacements = { 'employee.name': fixture.candidateName, 'employee.cpf': '529.982.247-25',
            'integration.employer_name': fixture.employerUnitName, 'integration.employer_legal_name': fixture.employerUnitName,
            'integration.employer_cnpj': '11.222.333/0001-81', 'integration.employer_address': fixture.employerAddress };
          for (const variable of item.variables) {
            const binding = item.fieldMapping?.[variable];
            const key = binding?.kind === 'system' ? binding.key : variable;
            if (!(key in replacements)) continue;
            const parts = variable.split('.'); let node = data;
            for (const part of parts.slice(0, -1)) { node[part] ??= {}; node = node[part]; }
            node[parts.at(-1)] = replacements[key];
          }
          docx = generateDocx(await readFile(item.sourcePath), data);
          assert.deepEqual(extractDocxVariables(docx), [], id);
          const converted = await convertDocxToPdf(docx);
          assert.ok(converted, id);
          pdf = await applyCoalaLetterheadToPdf(converted);
        }
        const count = (await PDFDocument.load(pdf)).getPageCount();
        expectedIndex.push([nextPage, nextPage + count - 1]);
        components.push({ id, name: item.name, templateId: id, templateVersion: item.version,
          sourceDocxHash: hash(docx), buffer: pdf });
        nextPage += count;
      }
      const closingTemplate = systemDocumentTemplateById('system-admission-bundle-closing-term');
      const closingData = { employee: { name: fixture.candidateName }, integration: { employer_name: fixture.employerUnitName },
        contract_start_long: 'vinte e sete de outubro de dois mil e vinte e seis',
        bundle_components_summary: admissionClosingComponentsSummary(components.map((item, index) => ({
          title: item.name, startPage: expectedIndex[index][0], endPage: expectedIndex[index][1],
        }))) };
      const closingDocx = generateDocx(await readFile(closingTemplate.sourcePath), closingData);
      assert.deepEqual(extractDocxVariables(closingDocx), []);
      const converted = await convertDocxToPdf(closingDocx);
      assert.ok(converted);
      const closingPdf = await applyCoalaLetterheadToPdf(converted);
      const closingPages = (await PDFDocument.load(closingPdf)).getPageCount();
      components.push({ id: closingId, name: closingTemplate.name, templateId: closingTemplate.id,
        templateVersion: closingTemplate.version, sourceDocxHash: hash(closingDocx), buffer: closingPdf });
      expectedIndex.push([nextPage, nextPage + closingPages - 1]);
      const bundle = await buildAdmissionPdfBundle({ title: 'PACOTE SINTÉTICO DE HOMOLOGAÇÃO', logoPng: Buffer.alloc(0),
        packageId: prefix, protocol: 'ENSAIO-SEM-VALIDADE', components });
      assert.equal(bundle.pageCount, nextPage + closingPages - 1);
      assert.equal((await PDFDocument.load(bundle.buffer)).getPageCount(), bundle.pageCount);
      assert.deepEqual(bundle.index.map((row) => [row.startPage, row.endPage]), expectedIndex);
      assert.deepEqual(bundle.manifest.components.map((item) => item.templateId), expectedIds);
      for (const party of ['employee', 'company']) assert.equal(admissionBundleSignerPositions(bundle.manifest, party)[0].z, bundle.pageCount);
      assert.equal(bundle.manifest.components.find((item) => item.templateId === template.id).templateVersion, 5);
      await save('closing-filled.docx', closingDocx);
      await save('admission-bundle.pdf', bundle.buffer);
      await save('manifest.json', Buffer.from(JSON.stringify(bundle.manifest, null, 2)));
    });
  } finally {
    for (const id of generated) {
      const ref = dbAdmin.collection('generatedDocuments').doc(id);
      for (const audit of (await ref.collection('audit').get()).docs) await audit.ref.delete();
      await ref.delete();
    }
    for (const ref of refs) await ref.delete();
    for (const folder of [`generated-documents/${prefix}/`, `generated-documents/${prefix}-long/`, `synthetic-lgpd-validation/${prefix}/`]) {
      const [files] = await bucket.getFiles({ prefix: folder });
      for (const file of files) await file.delete();
    }
    if (converter) await new Promise((resolve) => converter.close(resolve));
    restoreEnv('DOCX_TO_PDF_URL', oldUrl);
    restoreEnv('DOCX_TO_PDF_AUDIENCE', oldAudience);
    restoreEnv('DOCX_TO_PDF_ID_TOKEN', oldToken);
  }
});
