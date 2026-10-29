export const EMPLOYMENT_RELATIONSHIP_TYPES = [
  { value: "clt", label: "CLT" },
  { value: "apprenticeship", label: "Aprendiz" },
  { value: "pj", label: "Pessoa jurídica (PJ)" },
  { value: "internship", label: "Estágio" },
  { value: "partner", label: "Societário" },
] as const;

export type EmploymentRelationshipType = (typeof EMPLOYMENT_RELATIONSHIP_TYPES)[number]["value"];

export const CLT_TERMINATION_REASONS = [
  "Dispensa sem justa causa",
  "Dispensa por justa causa",
  "Pedido de demissão (resilição pelo empregado)",
  "Rescisão indireta",
  "Rescisão por culpa recíproca",
  "Rescisão por acordo entre as partes",
  "Extinção legal ou por motivo de ordem pública",
] as const;

export const PJ_TERMINATION_REASONS = [
  "Encerramento por iniciativa da contratante",
  "Encerramento por iniciativa do prestador",
  "Encerramento por acordo entre as partes",
  "Término do prazo contratual",
  "Rescisão por descumprimento contratual",
  "Encerramento das atividades do prestador",
  "Força maior ou impossibilidade de execução",
] as const;

export type EmploymentTerminationReason =
  | (typeof CLT_TERMINATION_REASONS)[number]
  | (typeof PJ_TERMINATION_REASONS)[number];

export function isEmploymentRelationshipType(value: unknown): value is EmploymentRelationshipType {
  return EMPLOYMENT_RELATIONSHIP_TYPES.some((item) => item.value === value);
}

export function resolveEmploymentRelationshipType(
  value: unknown,
  personRecordType: unknown,
): EmploymentRelationshipType | undefined {
  if (isEmploymentRelationshipType(value)) return value;
  if (personRecordType === "employee") return "clt";
  if (personRecordType === "pj") return "pj";
  if (personRecordType === "internship") return "internship";
  if (personRecordType === "partner") return "partner";
  return undefined;
}

export function employmentRelationshipLabel(value: unknown) {
  return EMPLOYMENT_RELATIONSHIP_TYPES.find((item) => item.value === value)?.label ?? "Vínculo não definido";
}

/**
 * Vínculos com jornada: aparecem na escala da unidade, registram ponto e entram no fechamento. Substitui o antigo
 * interruptor "Operacional"; estar na escala não obriga a receber turno.
 */
export function isWorkforceEmploymentRelationship(
  value: unknown,
): value is Exclude<EmploymentRelationshipType, "pj" | "partner"> {
  return value === "clt" || value === "apprenticeship" || value === "internship";
}

/**
 * Fechamento de ponto: na dúvida, inclui. Cadastro sem vínculo entra (como entrava com o antigo "Operacional"),
 * para ninguém sair do controle de jornada em silêncio; só PJ e societário ficam fora.
 */
export function belongsToTimeClosureRoster(value: unknown) {
  return value === undefined || value === null || value === "" || isWorkforceEmploymentRelationship(value);
}

export function isEmploymentRelationshipEligibleForAbsence(
  value: unknown,
): value is Exclude<EmploymentRelationshipType, "pj" | "partner"> {
  return isWorkforceEmploymentRelationship(value);
}

export function terminationReasonsForRelationship(value: unknown): readonly EmploymentTerminationReason[] {
  if (value === "clt") return CLT_TERMINATION_REASONS;
  if (value === "pj") return PJ_TERMINATION_REASONS;
  return [];
}

export function terminationCopyForRelationship(value: unknown) {
  if (value === "pj") {
    return {
      action: "Encerrar contrato PJ",
      title: "Iniciar encerramento contratual",
      description: "Isso inicia o processo formal. O acesso será inativado somente na conclusão.",
      dateLabel: "Data do encerramento",
      reasonLabel: "Motivo do encerramento",
      missingDate: "Informe a data do encerramento.",
      missingReason: "Selecione o motivo do encerramento.",
      submit: "Iniciar encerramento",
      saving: "Iniciando...",
      success: "Processo de encerramento iniciado.",
    };
  }

  if (value !== "clt") {
    return {
      action: value === "internship"
        ? "Desligamento de estágio"
        : value === "apprenticeship"
          ? "Desligamento de aprendiz"
          : value === "partner"
            ? "Encerramento societário"
          : "Definir vínculo para encerrar",
      title: value === "internship"
        ? "Desligamento de estágio"
        : value === "apprenticeship"
          ? "Desligamento de aprendiz"
          : value === "partner"
            ? "Encerramento societário"
          : "Tipo de vínculo obrigatório",
      description: value === "internship" || value === "apprenticeship" || value === "partner"
        ? "O fluxo específico de encerramento deste vínculo será implementado posteriormente."
        : "Defina o tipo de vínculo antes de registrar o encerramento.",
      dateLabel: "Data do encerramento",
      reasonLabel: "Motivo do encerramento",
      missingDate: "Informe a data do encerramento.",
      missingReason: "Selecione o motivo do encerramento.",
      submit: "Encerramento indisponível",
      saving: "Salvando...",
      success: "Encerramento registrado.",
    };
  }

  return {
    action: "Rescisão",
    title: "Iniciar desligamento",
    description: "Isso cria o processo formal. O acesso será inativado somente na conclusão.",
    dateLabel: "Data da demissão",
    reasonLabel: "Tipo de demissão",
    missingDate: "Informe a data da demissão.",
    missingReason: "Selecione o tipo de demissão.",
    submit: "Iniciar desligamento",
    saving: "Iniciando...",
    success: "Processo de desligamento iniciado.",
  };
}
