import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import PizZip from 'pizzip';

const base = 'docs/modelos-documentos';
const source = await readFile(`${base}/papel-timbrado/papel-timbrado-coala-shakes-v1.docx`);

function esc(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function paragraph(value, { bold = false, size = 22, before = 0, after = 150, color = '26313F' } = {}) {
  const paragraphs = value.split('\n');
  return paragraphs.map((line) => `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${after}" w:line="300" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="${color}"/><w:sz w:val="${size}"/>${bold ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`).join('');
}

const common = [
  paragraph('Empregador  {{integration.employer_name}}', { before: 180 }),
  paragraph('CNPJ  {{integration.employer_cnpj}}'),
  paragraph('Declarante  {{employee.name}}'),
  paragraph('CPF  {{employee.cpf}}', { after: 300 }),
].join('');

const templates = [
  {
    file: `${base}/admissionais/08-termo-salario-familia-v1.docx`,
    body: [
      paragraph('Termo de responsabilidade para salário-família', { bold: true, size: 28, after: 300 }),
      common,
      paragraph('Dependentes considerados aptos', { bold: true, color: 'DE2D82', before: 120, after: 150 }),
      paragraph('{{family_salary_dependents_lines}}', { after: 300 }),
      paragraph('Declaro que as informações prestadas sobre os dependentes acima são verdadeiras. Comprometo-me a comunicar imediatamente ao empregador qualquer fato que altere o direito ao salário-família, inclusive falecimento, cessação de invalidez reconhecida ou decisão judicial que modifique a titularidade ou o pagamento.', { after: 220 }),
      paragraph('Estou ciente de que a manutenção do benefício depende dos requisitos aplicáveis e da conferência pelo Departamento Pessoal. Valores recebidos indevidamente poderão ser restituídos, sem prejuízo das medidas legais cabíveis.', { after: 270 }),
      paragraph('Este termo integra o kit admissional e é assinado no termo de encerramento do pacote.', { size: 18, color: '596875' }),
    ].join(''),
  },
  {
    file: `${base}/admissionais/08-declaracao-dependentes-ir-v1.docx`,
    body: [
      paragraph('Declaração de dependentes para imposto de renda', { bold: true, size: 28, after: 300 }),
      common,
      paragraph('Dependentes declarados para retenção na fonte', { bold: true, color: 'DE2D82', before: 120, after: 150 }),
      paragraph('{{income_tax_dependents_lines}}', { after: 300 }),
      paragraph('Declaro, sob minha responsabilidade, que as pessoas acima são meus dependentes para fins de cálculo do imposto de renda retido na fonte, observadas as regras legais aplicáveis.', { after: 220 }),
      paragraph('Comprometo-me a comunicar à fonte pagadora qualquer alteração que modifique esta declaração e a apresentar nova versão quando necessário.', { after: 270 }),
      paragraph('Esta declaração integra o kit admissional e é assinada no termo de encerramento do pacote.', { size: 18, color: '596875' }),
    ].join(''),
  },
];

for (const template of templates) {
  const zip = new PizZip(source);
  const original = zip.file('word/document.xml').asText();
  if (!original.includes('</w:p><w:sectPr>')) throw new Error('Ponto de inserção do papel timbrado não encontrado.');
  const xml = original.replace('</w:p><w:sectPr>', `</w:p>${template.body}<w:sectPr>`);
  zip.file('word/document.xml', xml, { date: new Date('2026-11-10T00:00:00Z') });
  const bytes = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  await writeFile(template.file, bytes);
  process.stdout.write(`${template.file} ${createHash('sha256').update(bytes).digest('hex')}\n`);
}
