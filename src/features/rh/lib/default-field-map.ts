import type { FieldMapEntry, FieldType, FieldVisibility, ProfileBlockConfig } from "@/types/rh";

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
  const isSensitiveCategory =
    section.includes("diversidade") ||
    section.includes("aso") ||
    section.includes("bancarios") ||
    section.includes("familia");
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
      category: isSensitiveCategory || config.visibility === "internal"
        ? "sensitive"
        : config.visibility === "sensitive"
          ? "confidential"
          : "personal",
      legal_basis: section.includes("diversidade") ? "consent" : "legal_obligation",
      retention: section.includes("bancarios")
        ? "termination_plus_90d"
        : section.includes("diversidade") || section.includes("aso")
          ? "termination_plus_2y"
          : "employment_plus_5y",
      requires_consent: section.includes("diversidade"),
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
const YES_NO = ["Sim", "Nao"];
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
  "system.documents_codes": { id: "system.documents_codes", label: "Bizneo, PDV e códigos", order: 1000, employee_visible: false, locked: true },
  "system.role_access": { id: "system.role_access", label: "Cargo, funções e acessos", order: 1010, employee_visible: false, locked: true },
  "system.schedule_units": { id: "system.schedule_units", label: "Escala e unidades", order: 1020, employee_visible: false, locked: true },
  "system.uniforms": { id: "system.uniforms", label: "Uniformes: entrega e devolução", order: 1030, employee_visible: false, locked: true },
  "system.vacations": { id: "system.vacations", label: "Férias", order: 1040, employee_visible: false, locked: true },
  "system.behavior": { id: "system.behavior", label: "Comportamento no sistema", order: 1050, employee_visible: false, locked: true },
};

export const DEFAULT_COMPLEMENTARY_FIELDS: Record<string, FieldMapEntry> = {
  "employee.name": field({ label: "Nome Completo", section: "Dados Pessoais", type: "text", required: true, visibility: "public", employeeVisible: true, employeeEditable: false, order: 10 }),
  "employee.state": field({ label: "Estado (UF)", section: "Dados Pessoais", type: "single_select", visibility: "public", employeeVisible: true, employeeEditable: true, order: 20, options: UF_OPTIONS }),
  "employee.city": field({ label: "Cidade", section: "Dados Pessoais", type: "text", visibility: "public", employeeVisible: true, employeeEditable: true, order: 30 }),
  "employee.address": field({ label: "Endereco", section: "Dados Pessoais", type: "text", visibility: "sensitive", employeeVisible: true, employeeEditable: true, order: 40 }),
  "employee.phone": field({ label: "Telefone Celular", section: "Dados Pessoais", type: "text", required: true, visibility: "sensitive", employeeVisible: true, employeeEditable: false, order: 50 }),
  "employee.personal_email": field({ label: "E-Mail Pessoal", section: "Dados Pessoais", type: "text", required: true, visibility: "sensitive", employeeVisible: true, employeeEditable: false, order: 60 }),
  "employee.nationality": field({ label: "Nacionalidade", section: "Dados Pessoais", type: "text", visibility: "public", employeeVisible: true, employeeEditable: false, order: 70 }),
  "employee.birth_date": field({ label: "Data de Nascimento", section: "Dados Pessoais", type: "date", required: true, visibility: "public", employeeVisible: true, employeeEditable: true, order: 80 }),
  "employee.marital_status": field({ label: "Estado Civil", section: "Dados Pessoais", type: "single_select", visibility: "public", employeeVisible: true, employeeEditable: false, order: 90, options: ["Solteiro(a)", "Casado(a)", "Divorciado(a)", "Viuvo(a)", "Uniao Estavel"] }),
  "employee.mother_name": field({ label: "Nome da Mae", section: "Dados Pessoais", type: "text", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 100 }),
  "employee.father_name": field({ label: "Nome do Pai", section: "Dados Pessoais", type: "text", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 110 }),
  "employee.children_under_14": field({ label: "Filhos menores de 14 anos", section: "Dados Pessoais", type: "single_select", visibility: "sensitive", employeeVisible: true, employeeEditable: true, order: 120, options: ["Nenhum", "1", "2", "3", "4 ou mais"] }),

  "employee.cpf": field({ label: "CPF", section: "Documentos", type: "text", required: true, visibility: "sensitive", employeeVisible: true, employeeEditable: false, order: 10 }),
  "employee.pis": field({ label: "PIS", section: "Documentos", type: "text", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 20 }),
  "employee.ctps_number": field({ label: "CTPS - Numero", section: "Documentos", type: "text", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 30 }),
  "employee.ctps_series": field({ label: "CTPS - Serie", section: "Documentos", type: "text", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 40 }),
  "employee.ctps_date": field({ label: "CTPS - Data de Emissao", section: "Documentos", type: "date", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 50 }),
  "employee.has_cnh": field({ label: "Possui CNH?", section: "Documentos", type: "boolean", visibility: "public", employeeVisible: true, employeeEditable: true, order: 55 }),
  "employee.cnh_number": field({ label: "Número de registro", section: "Documentos", type: "text", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 60, group: CNH_GROUP, conditionals: HAS_CNH_CONDITION }),
  "employee.cnh_type": field({ label: "Categoria", section: "Documentos", type: "multi_select", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 70, options: ["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"], group: CNH_GROUP, conditionals: HAS_CNH_CONDITION }),
  "employee.cnh_expiry": field({ label: "Data de validade", section: "Documentos", type: "date", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 80, group: CNH_GROUP, subgroup: CNH_VALIDITY_SUBGROUP, conditionals: HAS_CNH_CONDITION }),
  "employee.cnh_first_date": field({ label: "1ª habilitação", section: "Documentos", type: "date", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 90, group: CNH_GROUP, subgroup: CNH_VALIDITY_SUBGROUP, conditionals: HAS_CNH_CONDITION }),

  "employee.employer_cnpj": field({ label: "CNPJ Empregador", section: "Dados Contratuais", type: "text", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 10 }),
  "employee.employer_name": field({ label: "Razao Social", section: "Dados Contratuais", type: "single_select", visibility: "public", employeeVisible: true, employeeEditable: false, order: 20, options: ["CT Sorvetes Ltda", "Coala Shakes"] }),
  "employee.job_role_id": field({ label: "Cargo / Funcao", section: "Dados Contratuais", type: "ref:jobRoles", visibility: "public", employeeVisible: true, employeeEditable: false, order: 30 }),
  "employee.probation_eval_1": field({ label: "Exp. - 1a avaliacao", section: "Dados Contratuais", type: "date", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 40 }),
  "employee.probation_eval_2": field({ label: "Exp. - 2a avaliacao", section: "Dados Contratuais", type: "date", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 50 }),

  "employee.has_vt": field({ label: "Tem VT?", section: "Beneficios", type: "boolean", visibility: "sensitive", employeeVisible: true, employeeEditable: false, order: 10 }),
  "employee.vt_daily_value": field({ label: "Valor VT (Diario)", section: "Beneficios", type: "currency", visibility: "sensitive", employeeVisible: true, employeeEditable: false, order: 20 }),
  "employee.vt_notes": field({ label: "VT - Observacao", section: "Beneficios", type: "multiline", visibility: "internal", employeeVisible: false, employeeEditable: false, order: 30 }),
  "employee.has_va_vr": field({ label: "Tem VA/VR?", section: "Beneficios", type: "boolean", visibility: "sensitive", employeeVisible: true, employeeEditable: false, order: 40 }),
  "employee.va_vr_daily_value": field({ label: "Valor VA/VR", section: "Beneficios", type: "currency", visibility: "sensitive", employeeVisible: true, employeeEditable: false, order: 50 }),
  "employee.has_health_plan": field({ label: "Convenio Medico?", section: "Beneficios", type: "boolean", visibility: "sensitive", employeeVisible: true, employeeEditable: false, order: 60 }),
  "employee.has_dental_plan": field({ label: "Convenio Odontologico?", section: "Beneficios", type: "boolean", visibility: "sensitive", employeeVisible: true, employeeEditable: false, order: 70 }),

  "employee.education_level": field({ label: "Grau de Instrucao", section: "Formacao Academica", type: "single_select", visibility: "public", employeeVisible: true, employeeEditable: false, order: 10, options: ["Fundamental Incompleto", "Fundamental Completo", "Medio Incompleto", "Medio Completo", "Superior Incompleto", "Superior Completo", "Pos-Graduacao", "Mestrado", "Doutorado"] }),
  "employee.education_course": field({ label: "Curso", section: "Formacao Academica", type: "text", visibility: "public", employeeVisible: true, employeeEditable: false, order: 20 }),
  "employee.education_institution": field({ label: "Instituicao", section: "Formacao Academica", type: "text", visibility: "public", employeeVisible: true, employeeEditable: false, order: 30 }),
  "employee.education_end_date": field({ label: "Data de Conclusao", section: "Formacao Academica", type: "date", visibility: "public", employeeVisible: true, employeeEditable: false, order: 40 }),

  "employee.gender_identity": field({ label: "Identidade de Genero", section: "Inclusao & Diversidade", type: "single_select", visibility: "internal", employeeVisible: false, employeeEditable: false, order: 10, options: ["Mulher Cis", "Homem Cis", "Mulher Trans", "Homem Trans", "Nao-binario", "Prefiro nao informar"] }),
  "employee.sexual_orientation": field({ label: "Orientacao Sexual", section: "Inclusao & Diversidade", type: "single_select", visibility: "internal", employeeVisible: false, employeeEditable: false, order: 20, options: ["Heterossexual", "Homossexual", "Bissexual", "Pansexual", "Assexual", "Prefiro nao informar"] }),
  "employee.is_pcd": field({ label: "e PCD?", section: "Inclusao & Diversidade", type: "boolean", visibility: "internal", employeeVisible: false, employeeEditable: false, order: 30 }),
  "employee.disability": field({ label: "Deficiencia", section: "Inclusao & Diversidade", type: "multi_select", visibility: "internal", employeeVisible: false, employeeEditable: false, order: 40, options: ["Fisica", "Auditiva", "Visual", "Intelectual", "Psicossocial", "Multipla"] }),
  "employee.ethnicity": field({ label: "Etnia", section: "Inclusao & Diversidade", type: "single_select", visibility: "internal", employeeVisible: false, employeeEditable: false, order: 50, options: ["Branca", "Preta", "Parda", "Amarela", "Indigena", "Prefiro nao informar"] }),

  "employee.emergency_name": field({ label: "Nome", section: "Contatos de Emergencia", type: "text", required: true, visibility: "public", employeeVisible: true, employeeEditable: true, order: 10 }),
  "employee.emergency_phone": field({ label: "Celular (com DDD)", section: "Contatos de Emergencia", type: "text", required: true, visibility: "public", employeeVisible: true, employeeEditable: true, order: 20 }),
  "employee.emergency_relation": field({ label: "Grau de Parentesco", section: "Contatos de Emergencia", type: "single_select", visibility: "public", employeeVisible: true, employeeEditable: true, order: 30, options: ["Mae/Pai", "Conjuge", "Filho(a)", "Irmao/Irmã", "Parente", "Amigo(a)", "Outro"] }),
  "employee.emergency_medical": field({ label: "Alergias e Dados Medicos", section: "Contatos de Emergencia", type: "multiline", visibility: "sensitive", employeeVisible: true, employeeEditable: true, order: 40 }),

  "employee.dependent_name": field({ label: "Nome Dependente", section: "Dependentes", type: "text", visibility: "public", employeeVisible: false, employeeEditable: false, order: 10, group: DEPENDENT_GROUP }),
  "employee.dependent_relation": field({ label: "Grau de Parentesco", section: "Dependentes", type: "single_select", visibility: "public", employeeVisible: false, employeeEditable: false, order: 20, options: ["Filho(a)", "Enteado(a)", "Conjuge", "Outro"], group: DEPENDENT_GROUP }),
  "employee.dependent_cpf": field({ label: "CPF Dependente", section: "Dependentes", type: "text", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 30, group: DEPENDENT_GROUP }),
  "employee.dependent_rg": field({ label: "RG Dependente", section: "Dependentes", type: "text", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 40, group: DEPENDENT_GROUP }),

  "employee.bank_name": field({ label: "Banco", section: "Dados Bancarios", type: "single_select", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 10, options: ["Banco do Brasil", "Bradesco", "Caixa", "Itau", "Santander", "Nubank", "Inter", "Outro"] }),
  "employee.bank_agency": field({ label: "Agencia", section: "Dados Bancarios", type: "text", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 20 }),
  "employee.bank_account": field({ label: "Conta Corrente", section: "Dados Bancarios", type: "text", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 30 }),
  "employee.pix_key": field({ label: "Chave PIX", section: "Dados Bancarios", type: "text", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 40 }),

  "employee.aso_admission_date": field({ label: "Exame Admissional", section: "Controle de ASOs", type: "date", required: true, visibility: "internal", employeeVisible: false, employeeEditable: false, order: 10 }),
  "employee.aso_dismissal_date": field({ label: "Exame Demissional", section: "Controle de ASOs", type: "date", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 20 }),
  "employee.aso_periodic_1": field({ label: "Exame Periodico 1", section: "Controle de ASOs", type: "date", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 30 }),
  "employee.aso_periodic_2": field({ label: "Exame Periodico 2", section: "Controle de ASOs", type: "date", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 40 }),

  "employee.uniform_shirt_size": field({ label: "Tamanho de camisa", section: "Uniforme", type: "single_select", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 10, options: SHIRT_OPTIONS }),
  "employee.uniform_pants_size": field({ label: "Tamanho da calca", section: "Uniforme", type: "single_select", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 20, options: SHIRT_OPTIONS }),
  "employee.uniform_shoe_size": field({ label: "Numeracao do calcado", section: "Uniforme", type: "single_select", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 30, options: SHOE_OPTIONS }),
  "employee.uniform_shirt_qty": field({ label: "Camisa - Qtd entregue", section: "Uniforme", type: "number", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 40 }),
  "employee.uniform_apron_qty": field({ label: "Avental - Qtd entregue", section: "Uniforme", type: "number", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 50 }),
  "employee.uniform_sash_qty": field({ label: "Faixa - Qtd entregue", section: "Uniforme", type: "number", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 60 }),
  "employee.uniform_cap_qty": field({ label: "Bone - Qtd entregue", section: "Uniforme", type: "number", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 70 }),
  "employee.uniform_last_delivery": field({ label: "Data ultima entrega", section: "Uniforme", type: "date", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 80 }),

  "employee.has_family_salary": field({ label: "Tem salario familia?", section: "Salario Familia", type: "boolean", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 10 }),
  "employee.family_salary_end_1": field({ label: "Data encerramento filho 1", section: "Salario Familia", type: "date", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 20 }),
  "employee.family_salary_birth_1": field({ label: "Nascimento filho 1", section: "Salario Familia", type: "date", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 30 }),
  "employee.family_salary_name_1": field({ label: "Nome filho 1", section: "Salario Familia", type: "text", visibility: "sensitive", employeeVisible: false, employeeEditable: false, order: 40 }),
};
