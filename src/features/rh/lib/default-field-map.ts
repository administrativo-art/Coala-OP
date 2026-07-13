import type { FieldMapEntry, FieldType, FieldVisibility, ProfileBlockConfig } from "@/types/rh";
import { normalizeFieldVisibility } from "@/types/rh";

type FieldConfig = {
  label: string;
  section: string;
  type: FieldType;
  required?: boolean;
  visibility: FieldVisibility;
  employeeVisible: boolean;
  employeeEditable: boolean;
  order: number;
  options?: string[];
  conditionals?: FieldMapEntry["conditionals"];
  group?: FieldMapEntry["group"];
  subgroup?: FieldMapEntry["subgroup"];
  repeatable?: FieldMapEntry["repeatable"];
};

function field(config: FieldConfig): FieldMapEntry {
  const section = config.section.toLowerCase();
  const sectionKey = section.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const visibility = normalizeFieldVisibility(config.visibility);
  const isSensitiveCategory =
    sectionKey.includes("diversidade") ||
    sectionKey.includes("aso") ||
    sectionKey.includes("bancarios") ||
    sectionKey.includes("familia");
  const entry: FieldMapEntry = {
    bizneo_id: "coala_internal",
    label: config.label,
    section: config.section,
    type: config.type,
    visibility: config.visibility,
    employee_visible: config.employeeVisible,
    employee_editable: config.employeeEditable,
    order: config.order,
    lgpd: {
      category: isSensitiveCategory || visibility === "confidential"
        ? "sensitive"
        : visibility === "restricted_total" || visibility === "restricted_partial"
          ? "confidential"
          : "personal",
      legal_basis: sectionKey.includes("diversidade") ? "consent" : "legal_obligation",
      retention: sectionKey.includes("bancarios")
        ? "termination_plus_90d"
        : sectionKey.includes("diversidade") || sectionKey.includes("aso")
          ? "termination_plus_2y"
          : "employment_plus_5y",
      requires_consent: sectionKey.includes("diversidade"),
    },
  };
  if (config.required !== undefined) entry.required = config.required;
  if (config.options !== undefined) entry.options = config.options;
  if (config.conditionals !== undefined) entry.conditionals = config.conditionals;
  if (config.group !== undefined) entry.group = config.group;
  if (config.subgroup !== undefined) entry.subgroup = config.subgroup;
  if (config.repeatable !== undefined) entry.repeatable = config.repeatable;
  return entry;
}

const UF_OPTIONS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const YES_NO = ["Sim", "Não"];
const SHIRT_OPTIONS = ["PP", "P", "M", "G", "GG", "XG"];
const SHOE_OPTIONS = ["33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45"];
const CNH_GROUP: FieldMapEntry["group"] = { id: "documents_cnh", label: "CNH", order: 60 };
const CNH_VALIDITY_SUBGROUP: FieldMapEntry["subgroup"] = { id: "documents_cnh_validity", label: "Validade da CNH", group_id: "documents_cnh", order: 10 };
const HAS_CNH_CONDITION: FieldMapEntry["conditionals"] = [{ kind: "show_if", field: "employee.has_cnh", operator: "eq", value: true }];
const DEPENDENT_GROUP: FieldMapEntry["group"] = {
  id: "dependents_record",
  label: "Dependente",
  order: 10,
  repeatable: { enabled: true, add_label: "Adicionar dependente", item_label: "Dependente" },
};

export const DEFAULT_PROFILE_BLOCKS: Record<string, ProfileBlockConfig> = {
  "system.schedule_units": { id: "system.schedule_units", label: "Escala e unidades", order: 1020, employee_visible: false, locked: true },
  "system.uniforms": { id: "system.uniforms", label: "Uniformes: entrega e devolução", order: 1030, employee_visible: false, locked: true },
  "system.vacations": { id: "system.vacations", label: "Férias", order: 1040, employee_visible: false, locked: true },
  "system.aso_control": { id: "system.aso_control", label: "Controle de ASOs", order: 1045, employee_visible: false, locked: true },
  "system.family_salary": { id: "system.family_salary", label: "Salário-família", order: 1048, employee_visible: false, locked: true },
  "system.transport_voucher": { id: "system.transport_voucher", label: "Vale-transporte", order: 1050, employee_visible: false, locked: true },
  "system.behavior": { id: "system.behavior", label: "Comportamento no sistema", order: 1060, employee_visible: false, locked: true },
};

export const DEFAULT_SYSTEM_FIELDS: Record<string, FieldMapEntry> = {
  "system.documents.registration_bizneo": field({ label: "Matrícula Bizneo", section: "Dados contratuais", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 60 }),
  "system.documents.registration_pdv": field({ label: "Matrícula PDV", section: "Dados contratuais", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 70 }),
  "system.documents.access_profile": field({ label: "Perfil de acesso", section: "Dados contratuais", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 110 }),
  "system.role.job_role": field({ label: "Cargo", section: "Dados contratuais", type: "text", visibility: "public", employeeVisible: false, employeeEditable: false, order: 30 }),
  "system.role.operational": field({ label: "Operacional", section: "Dados contratuais", type: "boolean", visibility: "public", employeeVisible: false, employeeEditable: false, order: 80 }),
  "system.role.goals": field({ label: "Metas", section: "Dados contratuais", type: "boolean", visibility: "public", employeeVisible: false, employeeEditable: false, order: 90 }),
  "system.role.functions": field({ label: "Funções", section: "Dados contratuais", type: "text", visibility: "public", employeeVisible: false, employeeEditable: false, order: 100 }),
  "system.schedule.shift": field({ label: "Escala", section: "Escala e unidades", type: "text", visibility: "public", employeeVisible: false, employeeEditable: false, order: 10 }),
  "system.schedule.units": field({ label: "Unidades", section: "Escala e unidades", type: "text", visibility: "public", employeeVisible: false, employeeEditable: false, order: 20 }),
  "system.uniforms.summary": field({ label: "Uniformes", section: "Uniformes", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 10 }),
  "system.vacations.summary": field({ label: "Férias", section: "Férias", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 10 }),
  "system.aso.summary": field({ label: "Resumo de ASOs", section: "Controle de ASOs", type: "multiline", visibility: "confidential", employeeVisible: false, employeeEditable: false, order: 10 }),
  "system.family_salary.summary": field({ label: "Resumo do salário-família", section: "Dependentes e salário-família", type: "multiline", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 10 }),
  "system.transport_voucher.enabled": field({ label: "Vale-transporte", section: "Vale-transporte", type: "boolean", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 10 }),
  "system.behavior.operational": field({ label: "Usuário operacional", section: "Comportamento no sistema", type: "boolean", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 10 }),
  "system.behavior.goals": field({ label: "Participa de metas", section: "Comportamento no sistema", type: "boolean", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 20 }),
};

export const DEFAULT_COMPLEMENTARY_FIELDS: Record<string, FieldMapEntry> = {
  ...DEFAULT_SYSTEM_FIELDS,
  "employee.name": field({ label: "Nome completo", section: "Dados pessoais", type: "text", required: true, visibility: "public", employeeVisible: true, employeeEditable: false, order: 10 }),
  "employee.state": field({ label: "Estado (UF)", section: "Dados pessoais", type: "single_select", visibility: "public", employeeVisible: true, employeeEditable: true, order: 20, options: UF_OPTIONS }),
  "employee.city": field({ label: "Cidade", section: "Dados pessoais", type: "text", visibility: "public", employeeVisible: true, employeeEditable: true, order: 30 }),
  "employee.address": field({ label: "Endereço", section: "Dados pessoais", type: "text", visibility: "restricted_partial", employeeVisible: true, employeeEditable: true, order: 40 }),
  "employee.phone": field({ label: "Telefone celular", section: "Dados pessoais", type: "text", required: true, visibility: "restricted_partial", employeeVisible: true, employeeEditable: false, order: 50 }),
  "employee.personal_email": field({ label: "E-mail pessoal", section: "Dados pessoais", type: "text", required: true, visibility: "restricted_partial", employeeVisible: true, employeeEditable: false, order: 60 }),
  "employee.nationality": field({ label: "Nacionalidade", section: "Dados pessoais", type: "text", visibility: "public", employeeVisible: true, employeeEditable: false, order: 70 }),
  "employee.birth_date": field({ label: "Data de nascimento", section: "Dados pessoais", type: "date", required: true, visibility: "public", employeeVisible: true, employeeEditable: true, order: 80 }),
  "employee.marital_status": field({ label: "Estado civil", section: "Dados pessoais", type: "single_select", visibility: "public", employeeVisible: true, employeeEditable: false, order: 90, options: ["Solteiro(a)", "Casado(a)", "Divorciado(a)", "Viúvo(a)", "União estável"] }),
  "employee.mother_name": field({ label: "Nome da mãe", section: "Dados pessoais", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 100 }),
  "employee.father_name": field({ label: "Nome do pai", section: "Dados pessoais", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 110 }),
  "employee.children_under_14": field({ label: "Filhos menores de 14 anos", section: "Dependentes e salário-família", type: "single_select", visibility: "restricted_partial", employeeVisible: true, employeeEditable: true, order: 10, options: ["Nenhum", "1", "2", "3", "4 ou mais"] }),

  "employee.cpf": field({ label: "CPF", section: "Documentos", type: "text", required: true, visibility: "restricted_partial", employeeVisible: true, employeeEditable: false, order: 10 }),
  "employee.pis": field({ label: "PIS", section: "Documentos", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 20 }),
  "employee.ctps_number": field({ label: "CTPS - Número", section: "Documentos", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 30 }),
  "employee.ctps_series": field({ label: "CTPS - Série", section: "Documentos", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 40 }),
  "employee.ctps_date": field({ label: "CTPS - Data de emissão", section: "Documentos", type: "date", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 50 }),
  "employee.has_cnh": field({ label: "Possui CNH?", section: "Documentos", type: "boolean", visibility: "public", employeeVisible: true, employeeEditable: true, order: 55 }),
  "employee.cnh_number": field({ label: "Número de registro", section: "Documentos", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 60, group: CNH_GROUP, conditionals: HAS_CNH_CONDITION }),
  "employee.cnh_type": field({ label: "Categoria", section: "Documentos", type: "multi_select", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 70, options: ["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"], group: CNH_GROUP, conditionals: HAS_CNH_CONDITION }),
  "employee.cnh_expiry": field({ label: "Data de validade", section: "Documentos", type: "date", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 80, group: CNH_GROUP, subgroup: CNH_VALIDITY_SUBGROUP, conditionals: HAS_CNH_CONDITION }),
  "employee.cnh_first_date": field({ label: "1ª habilitação", section: "Documentos", type: "date", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 90, group: CNH_GROUP, subgroup: CNH_VALIDITY_SUBGROUP, conditionals: HAS_CNH_CONDITION }),

  "employee.employer_cnpj": field({ label: "CNPJ do empregador", section: "Dados contratuais", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 10 }),
  "employee.employer_name": field({ label: "Razão social", section: "Dados contratuais", type: "single_select", visibility: "public", employeeVisible: true, employeeEditable: false, order: 20, options: ["CT Sorvetes Ltda", "Coala Shakes"] }),
  "employee.job_role_id": field({ label: "Cargo / Função", section: "Dados contratuais", type: "ref:jobRoles", visibility: "public", employeeVisible: true, employeeEditable: false, order: 30 }),
  "employee.probation_eval_1": field({ label: "Experiência - 1ª avaliação", section: "Dados contratuais", type: "date", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 40 }),
  "employee.probation_eval_2": field({ label: "Experiência - 2ª avaliação", section: "Dados contratuais", type: "date", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 50 }),

  "employee.has_vt": field({ label: "Tem VT?", section: "Benefícios", type: "boolean", visibility: "restricted_partial", employeeVisible: true, employeeEditable: false, order: 10 }),
  "employee.vt_daily_value": field({ label: "Valor do VT diário", section: "Benefícios", type: "currency", visibility: "restricted_partial", employeeVisible: true, employeeEditable: false, order: 20 }),
  "employee.vt_notes": field({ label: "Observação sobre VT", section: "Benefícios", type: "multiline", visibility: "confidential", employeeVisible: false, employeeEditable: false, order: 30 }),
  "employee.has_va_vr": field({ label: "Tem VA/VR?", section: "Benefícios", type: "boolean", visibility: "restricted_partial", employeeVisible: true, employeeEditable: false, order: 40 }),
  "employee.va_vr_daily_value": field({ label: "Valor do VA/VR", section: "Benefícios", type: "currency", visibility: "restricted_partial", employeeVisible: true, employeeEditable: false, order: 50 }),
  "employee.has_health_plan": field({ label: "Convênio médico?", section: "Benefícios", type: "boolean", visibility: "restricted_partial", employeeVisible: true, employeeEditable: false, order: 60 }),
  "employee.has_dental_plan": field({ label: "Convênio odontológico?", section: "Benefícios", type: "boolean", visibility: "restricted_partial", employeeVisible: true, employeeEditable: false, order: 70 }),

  "employee.education_level": field({ label: "Grau de instrução", section: "Formação acadêmica", type: "single_select", visibility: "public", employeeVisible: true, employeeEditable: false, order: 10, options: ["Fundamental incompleto", "Fundamental completo", "Médio incompleto", "Médio completo", "Superior incompleto", "Superior completo", "Pós-graduação", "Mestrado", "Doutorado"] }),
  "employee.education_course": field({ label: "Curso", section: "Formação acadêmica", type: "text", visibility: "public", employeeVisible: true, employeeEditable: false, order: 20 }),
  "employee.education_institution": field({ label: "Instituição", section: "Formação acadêmica", type: "text", visibility: "public", employeeVisible: true, employeeEditable: false, order: 30 }),
  "employee.education_end_date": field({ label: "Data de conclusão", section: "Formação acadêmica", type: "date", visibility: "public", employeeVisible: true, employeeEditable: false, order: 40 }),

  "employee.gender_identity": field({ label: "Identidade de gênero", section: "Inclusão e diversidade", type: "single_select", visibility: "confidential", employeeVisible: false, employeeEditable: false, order: 10, options: ["Mulher cis", "Homem cis", "Mulher trans", "Homem trans", "Não binário", "Prefiro não informar"] }),
  "employee.sexual_orientation": field({ label: "Orientação sexual", section: "Inclusão e diversidade", type: "single_select", visibility: "confidential", employeeVisible: false, employeeEditable: false, order: 20, options: ["Heterossexual", "Homossexual", "Bissexual", "Pansexual", "Assexual", "Prefiro não informar"] }),
  "employee.is_pcd": field({ label: "É PCD?", section: "Inclusão e diversidade", type: "boolean", visibility: "confidential", employeeVisible: false, employeeEditable: false, order: 30 }),
  "employee.disability": field({ label: "Deficiência", section: "Inclusão e diversidade", type: "multi_select", visibility: "confidential", employeeVisible: false, employeeEditable: false, order: 40, options: ["Física", "Auditiva", "Visual", "Intelectual", "Psicossocial", "Múltipla"] }),
  "employee.ethnicity": field({ label: "Etnia", section: "Inclusão e diversidade", type: "single_select", visibility: "confidential", employeeVisible: false, employeeEditable: false, order: 50, options: ["Branca", "Preta", "Parda", "Amarela", "Indígena", "Prefiro não informar"] }),

  "employee.emergency_name": field({ label: "Nome", section: "Contatos de emergência", type: "text", required: true, visibility: "public", employeeVisible: true, employeeEditable: true, order: 10 }),
  "employee.emergency_phone": field({ label: "Celular (com DDD)", section: "Contatos de emergência", type: "text", required: true, visibility: "public", employeeVisible: true, employeeEditable: true, order: 20 }),
  "employee.emergency_relation": field({ label: "Grau de parentesco", section: "Contatos de emergência", type: "single_select", visibility: "public", employeeVisible: true, employeeEditable: true, order: 30, options: ["Mãe/Pai", "Cônjuge", "Filho(a)", "Irmão/Irmã", "Parente", "Amigo(a)", "Outro"] }),
  "employee.emergency_medical": field({ label: "Alergias e dados médicos", section: "Contatos de emergência", type: "multiline", visibility: "restricted_partial", employeeVisible: true, employeeEditable: true, order: 40 }),

  "employee.dependent_name": field({ label: "Nome do dependente", section: "Dependentes e salário-família", type: "text", visibility: "public", employeeVisible: false, employeeEditable: false, order: 20, group: DEPENDENT_GROUP }),
  "employee.dependent_relation": field({ label: "Grau de parentesco", section: "Dependentes e salário-família", type: "single_select", visibility: "public", employeeVisible: false, employeeEditable: false, order: 30, options: ["Filho(a)", "Enteado(a)", "Cônjuge", "Outro"], group: DEPENDENT_GROUP }),
  "employee.dependent_cpf": field({ label: "CPF do dependente", section: "Dependentes e salário-família", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 40, group: DEPENDENT_GROUP }),
  "employee.dependent_rg": field({ label: "RG do dependente", section: "Dependentes e salário-família", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 50, group: DEPENDENT_GROUP }),

  "employee.bank_name": field({ label: "Banco", section: "Dados bancários", type: "single_select", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 10, options: ["Banco do Brasil", "Bradesco", "Caixa", "Itaú", "Santander", "Nubank", "Inter", "Outro"] }),
  "employee.bank_agency": field({ label: "Agência", section: "Dados bancários", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 20 }),
  "employee.bank_account": field({ label: "Conta corrente", section: "Dados bancários", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 30 }),
  "employee.pix_key": field({ label: "Chave Pix", section: "Dados bancários", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 40 }),

  "employee.aso_admission_date": field({ label: "Exame admissional", section: "Controle de ASOs", type: "date", required: true, visibility: "confidential", employeeVisible: false, employeeEditable: false, order: 10 }),
  "employee.aso_dismissal_date": field({ label: "Exame demissional", section: "Controle de ASOs", type: "date", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 20 }),
  "employee.aso_periodic_1": field({ label: "Exame periódico 1", section: "Controle de ASOs", type: "date", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 30 }),
  "employee.aso_periodic_2": field({ label: "Exame periódico 2", section: "Controle de ASOs", type: "date", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 40 }),

  "employee.uniform_shirt_size": field({ label: "Tamanho de camisa", section: "Uniforme", type: "single_select", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 10, options: SHIRT_OPTIONS }),
  "employee.uniform_pants_size": field({ label: "Tamanho da calça", section: "Uniforme", type: "single_select", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 20, options: SHIRT_OPTIONS }),
  "employee.uniform_shoe_size": field({ label: "Numeração do calçado", section: "Uniforme", type: "single_select", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 30, options: SHOE_OPTIONS }),
  "employee.uniform_shirt_qty": field({ label: "Camisa - Quantidade entregue", section: "Uniforme", type: "number", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 40 }),
  "employee.uniform_apron_qty": field({ label: "Avental - Quantidade entregue", section: "Uniforme", type: "number", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 50 }),
  "employee.uniform_sash_qty": field({ label: "Faixa - Quantidade entregue", section: "Uniforme", type: "number", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 60 }),
  "employee.uniform_cap_qty": field({ label: "Boné - Quantidade entregue", section: "Uniforme", type: "number", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 70 }),
  "employee.uniform_last_delivery": field({ label: "Data da última entrega", section: "Uniforme", type: "date", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 80 }),

  "employee.has_family_salary": field({ label: "Tem salário-família?", section: "Dependentes e salário-família", type: "boolean", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 60 }),
  "employee.family_salary_end_1": field({ label: "Data de encerramento do filho 1", section: "Dependentes e salário-família", type: "date", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 70 }),
  "employee.family_salary_birth_1": field({ label: "Nascimento do filho 1", section: "Dependentes e salário-família", type: "date", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 80 }),
  "employee.family_salary_name_1": field({ label: "Nome do filho 1", section: "Dependentes e salário-família", type: "text", visibility: "restricted_partial", employeeVisible: false, employeeEditable: false, order: 90 }),
};
