export const EMPLOYMENT_RELATIONSHIP_TYPES = [
  { value: "clt", label: "CLT" },
  { value: "pj", label: "Pessoa jurídica (PJ)" },
  { value: "internship", label: "Estágio" },
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

export function employmentRelationshipLabel(value: unknown) {
  return EMPLOYMENT_RELATIONSHIP_TYPES.find((item) => item.value === value)?.label ?? "Vínculo não definido";
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
      action: value === "internship" ? "Desligamento de estágio" : "Definir vínculo para encerrar",
      title: value === "internship" ? "Desligamento de estágio" : "Tipo de vínculo obrigatório",
      description: value === "internship"
        ? "O fluxo específico de desligamento de estágio será implementado posteriormente."
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
