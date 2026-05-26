/**
 * seed-rh-field-map.ts
 *
 * Popula coala-rh/schema/field_map com o mapeamento v1.0 completo.
 * Executar: npx tsx scripts/seed-rh-field-map.ts
 *
 * Pré-requisito: GOOGLE_APPLICATION_CREDENTIALS apontando para a SA key.
 * bizneo_ids marcados como "PENDING_DISCOVERY" devem ser atualizados após ADR-001.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { FieldMap, FieldMapEntry } from '../src/types/rh';

const SA_KEY_PATH = resolve(__dirname, 'smart-converter-752gf-firebase-adminsdk-fbsvc-aaa18b4778.json');
initializeApp({ credential: cert(JSON.parse(readFileSync(SA_KEY_PATH, 'utf8'))) });

const rhDb = getFirestore('coala-rh');

// ─── Definição de fields ────────────────────────────────────────────────────

type FieldDef = Omit<FieldMapEntry, never>;

const fields: Record<string, FieldDef> = {

  // ── Dados Pessoais ──────────────────────────────────────────────────────
  'employee.name': {
    bizneo_id: 'full_name', label: 'Nome Completo', section: 'Dados Pessoais',
    type: 'text', visibility: 'public', employee_visible: true, employee_editable: false,
    required: true, order: 1,
  },
  'employee.state': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Estado (UF)', section: 'Dados Pessoais',
    type: 'single_select', visibility: 'public', employee_visible: true, employee_editable: true,
    order: 2,
    options: ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'],
  },
  'employee.city': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Cidade', section: 'Dados Pessoais',
    type: 'text', visibility: 'public', employee_visible: true, employee_editable: true,
    order: 3,
  },
  'employee.address': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Endereço (Rua, N° e Bairro)', section: 'Dados Pessoais',
    type: 'text', visibility: 'sensitive', employee_visible: true, employee_editable: true,
    order: 4,
  },
  'employee.phone': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Telefone Celular (com DDD)', section: 'Dados Pessoais',
    type: 'text', visibility: 'sensitive', employee_visible: true, employee_editable: false,
    required: true, order: 5,
    validation: [{ type: 'regex', pattern: '^\\(\\d{2}\\)\\s?9?\\d{4}-?\\d{4}$' }],
  },
  'employee.personal_email': {
    bizneo_id: 'email', label: 'E-Mail Pessoal', section: 'Dados Pessoais',
    type: 'text', visibility: 'sensitive', employee_visible: true, employee_editable: false,
    required: true, order: 6,
    validation: [{ type: 'unique', scope: 'global' }],
  },
  'employee.nationality': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Nacionalidade', section: 'Dados Pessoais',
    type: 'text', visibility: 'public', employee_visible: true, employee_editable: false,
    order: 7,
  },
  'employee.birth_date': {
    bizneo_id: 'birthday', label: 'Data de Nascimento', section: 'Dados Pessoais',
    type: 'date', visibility: 'public', employee_visible: true, employee_editable: true,
    required: true, order: 8,
    validation: [{ type: 'past_date' }],
  },
  'employee.marital_status': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Estado Civil', section: 'Dados Pessoais',
    type: 'single_select', visibility: 'public', employee_visible: true, employee_editable: false,
    order: 9,
    options: ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)', 'União Estável'],
  },
  'employee.mother_name': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Nome da Mãe', section: 'Dados Pessoais',
    type: 'text', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 10,
  },
  'employee.father_name': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Nome do Pai', section: 'Dados Pessoais',
    type: 'text', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 11,
  },
  'employee.children_under_14': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Filhos menores de 14 anos', section: 'Dados Pessoais',
    type: 'single_select', visibility: 'sensitive', employee_visible: true, employee_editable: true,
    order: 12,
    options: ['Nenhum', '1', '2', '3', '4 ou mais'],
  },

  // ── Documentos ──────────────────────────────────────────────────────────
  'employee.cpf': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'CPF', section: 'Documentos',
    type: 'text', visibility: 'sensitive', employee_visible: true, employee_editable: false,
    required: true, order: 1,
    validation: [{ type: 'unique', scope: 'global' }, { type: 'regex', pattern: '^\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}$' }],
  },
  'employee.pis': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'PIS', section: 'Documentos',
    type: 'text', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 2,
  },
  'employee.ctps_number': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'CTPS — Número', section: 'Documentos',
    type: 'text', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 3,
  },
  'employee.ctps_series': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'CTPS — Série', section: 'Documentos',
    type: 'text', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 4,
  },
  'employee.ctps_date': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'CTPS — Data de Emissão', section: 'Documentos',
    type: 'date', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 5,
  },
  'employee.cnh_number': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'CNH — Número', section: 'Documentos',
    type: 'text', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 6,
  },
  'employee.cnh_type': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'CNH — Tipo', section: 'Documentos',
    type: 'multi_select', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 7, options: ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'],
  },
  'employee.cnh_expiry': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'CNH — Validade', section: 'Documentos',
    type: 'date', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 8,
  },

  // ── Dados Contratuais ────────────────────────────────────────────────────
  'employee.employer_cnpj': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'CNPJ (Empregador)', section: 'Dados Contratuais',
    type: 'text', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 1,
  },
  'employee.employer_name': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Razão Social', section: 'Dados Contratuais',
    type: 'single_select', visibility: 'public', employee_visible: true, employee_editable: false,
    order: 2,
    options: ['CT Sorvetes Ltda', 'Coala Shakes'],
  },
  'employee.job_role_id': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Cargo / Função', section: 'Dados Contratuais',
    type: 'ref:jobRoles', visibility: 'public', employee_visible: true, employee_editable: false,
    order: 3,
  },
  'employee.probation_eval_1': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Exp. — 1ª avaliação', section: 'Dados Contratuais',
    type: 'date', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 4,
    triggers: [{ event: 'on_set', action: 'create_hr_task' }],
  },
  'employee.probation_eval_2': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Exp. — 2ª avaliação', section: 'Dados Contratuais',
    type: 'date', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 5,
    triggers: [{ event: 'on_set', action: 'create_hr_task' }],
  },

  // ── Benefícios ───────────────────────────────────────────────────────────
  'employee.has_vt': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Tem VT?', section: 'Benefícios',
    type: 'boolean', visibility: 'sensitive', employee_visible: true, employee_editable: false,
    order: 1,
  },
  'employee.vt_daily_value': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Valor VT (Diário)', section: 'Benefícios',
    type: 'currency', visibility: 'sensitive', employee_visible: true, employee_editable: false,
    order: 2,
    validation: [{ type: 'min', value: 0 }, { type: 'max', value: 5000 }],
    conditionals: [{ kind: 'required_if', field: 'employee.has_vt', operator: 'truthy' }],
  },
  'employee.vt_notes': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'VT — Observação', section: 'Benefícios',
    type: 'multiline', visibility: 'internal', employee_visible: false, employee_editable: false,
    order: 3,
  },
  'employee.has_va_vr': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Tem VA/VR?', section: 'Benefícios',
    type: 'boolean', visibility: 'sensitive', employee_visible: true, employee_editable: false,
    order: 4,
  },
  'employee.va_vr_daily_value': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Valor VA/VR (diário)', section: 'Benefícios',
    type: 'currency', visibility: 'sensitive', employee_visible: true, employee_editable: false,
    order: 5,
    conditionals: [{ kind: 'required_if', field: 'employee.has_va_vr', operator: 'truthy' }],
  },
  'employee.has_health_plan': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Convênio Médico?', section: 'Benefícios',
    type: 'boolean', visibility: 'sensitive', employee_visible: true, employee_editable: false,
    order: 6,
  },
  'employee.has_dental_plan': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Convênio Odontológico?', section: 'Benefícios',
    type: 'boolean', visibility: 'sensitive', employee_visible: true, employee_editable: false,
    order: 7,
  },

  // ── Formação Acadêmica ───────────────────────────────────────────────────
  'employee.education_level': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Grau de Instrução', section: 'Formação Acadêmica',
    type: 'single_select', visibility: 'public', employee_visible: true, employee_editable: false,
    order: 1,
    options: ['Fundamental Incompleto', 'Fundamental Completo', 'Médio Incompleto', 'Médio Completo', 'Superior Incompleto', 'Superior Completo', 'Pós-Graduação', 'Mestrado', 'Doutorado'],
  },
  'employee.education_course': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Curso', section: 'Formação Acadêmica',
    type: 'text', visibility: 'public', employee_visible: true, employee_editable: false,
    order: 2,
  },
  'employee.education_institution': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Instituição', section: 'Formação Acadêmica',
    type: 'text', visibility: 'public', employee_visible: true, employee_editable: false,
    order: 3,
  },
  'employee.education_end_date': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Data de Conclusão', section: 'Formação Acadêmica',
    type: 'date', visibility: 'public', employee_visible: true, employee_editable: false,
    order: 4,
  },

  // ── Inclusão & Diversidade (NÃO ativar antes do MVP 3) ───────────────────
  'employee.gender_identity': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Identidade de Gênero', section: 'Inclusão & Diversidade',
    type: 'single_select', visibility: 'internal', employee_visible: false, employee_editable: false,
    order: 1,
    options: ['Mulher Cis', 'Homem Cis', 'Mulher Trans', 'Homem Trans', 'Não-binário', 'Prefiro não informar'],
  },
  'employee.sexual_orientation': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Orientação Sexual', section: 'Inclusão & Diversidade',
    type: 'single_select', visibility: 'internal', employee_visible: false, employee_editable: false,
    order: 2,
    options: ['Heterossexual', 'Homossexual', 'Bissexual', 'Pansexual', 'Assexual', 'Prefiro não informar'],
  },
  'employee.is_pcd': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'é PCD?', section: 'Inclusão & Diversidade',
    type: 'boolean', visibility: 'internal', employee_visible: false, employee_editable: false,
    order: 3,
  },
  'employee.disability': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Deficiência', section: 'Inclusão & Diversidade',
    type: 'multi_select', visibility: 'internal', employee_visible: false, employee_editable: false,
    order: 4,
    options: ['Física', 'Auditiva', 'Visual', 'Intelectual', 'Psicossocial', 'Múltipla'],
    conditionals: [{ kind: 'show_if', field: 'employee.is_pcd', operator: 'truthy' }],
  },
  'employee.ethnicity': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Etnia', section: 'Inclusão & Diversidade',
    type: 'single_select', visibility: 'internal', employee_visible: false, employee_editable: false,
    order: 5,
    options: ['Branco(a)', 'Pardo(a)', 'Preto(a)', 'Amarelo(a)', 'Indígena', 'Prefiro não informar'],
  },

  // ── Contatos de Emergência ───────────────────────────────────────────────
  'employee.emergency_name': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Nome (Emergência)', section: 'Contatos de Emergência',
    type: 'text', visibility: 'public', employee_visible: true, employee_editable: true,
    required: true, order: 1,
  },
  'employee.emergency_phone': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Celular — Emergência', section: 'Contatos de Emergência',
    type: 'text', visibility: 'public', employee_visible: true, employee_editable: true,
    required: true, order: 2,
  },
  'employee.emergency_relation': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Grau de Parentesco', section: 'Contatos de Emergência',
    type: 'single_select', visibility: 'public', employee_visible: true, employee_editable: true,
    order: 3,
    options: ['Cônjuge', 'Pai/Mãe', 'Filho(a)', 'Irmão/Irmã', 'Avô/Avó', 'Tio(a)', 'Amigo(a)', 'Outro'],
  },
  'employee.emergency_medical': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Alergias e Dados Médicos', section: 'Contatos de Emergência',
    type: 'multiline', visibility: 'sensitive', employee_visible: true, employee_editable: true,
    order: 4,
  },

  // ── Dependentes ─────────────────────────────────────────────────────────
  'employee.dependent_name': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Nome Dependente', section: 'Dependentes',
    type: 'text', visibility: 'public', employee_visible: false, employee_editable: false,
    order: 1,
  },
  'employee.dependent_relation': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Grau de Parentesco (Dep.)', section: 'Dependentes',
    type: 'single_select', visibility: 'public', employee_visible: false, employee_editable: false,
    order: 2,
    options: ['Cônjuge', 'Filho(a)', 'Pai/Mãe', 'Irmão/Irmã', 'Outro'],
  },
  'employee.dependent_cpf': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'CPF (Dependente)', section: 'Dependentes',
    type: 'text', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 3,
  },
  'employee.dependent_rg': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'RG (Dependente)', section: 'Dependentes',
    type: 'text', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 4,
  },

  // ── Dados Bancários ──────────────────────────────────────────────────────
  'employee.bank_name': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Banco', section: 'Dados Bancários',
    type: 'single_select', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 1,
    options: ['Nubank', 'Bradesco', 'Itaú', 'Caixa', 'BB', 'Santander', 'Inter', 'C6', 'PicPay', 'Outro'],
  },
  'employee.bank_agency': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Agência', section: 'Dados Bancários',
    type: 'text', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 2,
  },
  'employee.bank_account': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Conta Corrente', section: 'Dados Bancários',
    type: 'text', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 3,
  },
  'employee.pix_key': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Chave PIX', section: 'Dados Bancários',
    type: 'text', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 4,
  },

  // ── Controle de ASOs ─────────────────────────────────────────────────────
  'employee.aso_admission_date': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Exame Admissional', section: 'Controle de Asos',
    type: 'date', visibility: 'internal', employee_visible: false, employee_editable: false,
    required: true, order: 1,
    triggers: [{ event: 'on_set', action: 'schedule_aso_alert' }],
  },
  'employee.aso_dismissal_date': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Exame Demissional', section: 'Controle de Asos',
    type: 'date', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 2,
  },
  'employee.aso_periodic_1': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Exame Periódico 1', section: 'Controle de Asos',
    type: 'date', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 3,
    triggers: [{ event: 'on_set', action: 'schedule_aso_alert' }],
  },
  'employee.aso_periodic_2': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Exame Periódico 2', section: 'Controle de Asos',
    type: 'date', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 4,
  },

  // ── Uniforme ─────────────────────────────────────────────────────────────
  'employee.uniform_shirt_size': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Tamanho de camisa', section: 'Uniforme',
    type: 'single_select', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 1,
    options: ['PP', 'P', 'M', 'G', 'GG', 'XGG'],
    triggers: [{ event: 'on_change', action: 'propagate_uniform' }],
  },
  'employee.uniform_pants_size': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Tamanho da calça', section: 'Uniforme',
    type: 'single_select', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 2,
    options: ['34', '36', '38', '40', '42', '44', '46', '48', '50'],
    triggers: [{ event: 'on_change', action: 'propagate_uniform' }],
  },
  'employee.uniform_shoe_size': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Numeração do calçado', section: 'Uniforme',
    type: 'single_select', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 3,
    options: ['33','34','35','36','37','38','39','40','41','42','43','44','45'],
    triggers: [{ event: 'on_change', action: 'propagate_uniform' }],
  },
  'employee.uniform_shirt_qty': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Camisa — Qtd entregue', section: 'Uniforme',
    type: 'number', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 4,
  },
  'employee.uniform_apron_qty': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Avental — Qtd entregue', section: 'Uniforme',
    type: 'number', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 5,
  },
  'employee.uniform_sash_qty': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Faixa — Qtd entregue', section: 'Uniforme',
    type: 'number', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 6,
  },
  'employee.uniform_cap_qty': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Boné — Qtd entregue', section: 'Uniforme',
    type: 'number', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 7,
  },
  'employee.uniform_last_delivery': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Data última entrega', section: 'Uniforme',
    type: 'date', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 8,
  },

  // ── Salário Família ──────────────────────────────────────────────────────
  'employee.has_family_salary': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Tem salário família?', section: 'Salário Família',
    type: 'boolean', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 1,
  },
  'employee.family_salary_end_1': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Data encerramento filho 1', section: 'Salário Família',
    type: 'date', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 2,
    conditionals: [{ kind: 'show_if', field: 'employee.has_family_salary', operator: 'truthy' }],
  },
  'employee.family_salary_birth_1': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Nascimento filho 1', section: 'Salário Família',
    type: 'date', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 3,
    conditionals: [{ kind: 'show_if', field: 'employee.has_family_salary', operator: 'truthy' }],
  },
  'employee.family_salary_name_1': {
    bizneo_id: 'PENDING_DISCOVERY', label: 'Nome filho 1', section: 'Salário Família',
    type: 'text', visibility: 'sensitive', employee_visible: false, employee_editable: false,
    order: 4,
    conditionals: [{ kind: 'show_if', field: 'employee.has_family_salary', operator: 'truthy' }],
  },
};

// ─── Seed ───────────────────────────────────────────────────────────────────

async function main() {
  const fieldMap: FieldMap = {
    version: new Date().toISOString().slice(0, 10),
    fields,
  };

  const docRef = rhDb.collection('schema').doc('field_map');
  await docRef.set(fieldMap);

  console.log(`✅ field_map v${fieldMap.version} gravado com ${Object.keys(fields).length} campos.`);

  const sections = [...new Set(Object.values(fields).map((f) => f.section))];
  console.log(`   Seções: ${sections.join(' · ')}`);

  const pending = Object.entries(fields).filter(([, f]) => f.bizneo_id === 'PENDING_DISCOVERY');
  console.log(`   ⚠️  ${pending.length} campos com bizneo_id PENDING_DISCOVERY (aguardando ADR-001).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
