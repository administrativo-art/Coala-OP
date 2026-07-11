export const TERMINATION_REASONS = [
  "Dispensa sem justa causa",
  "Dispensa por justa causa",
  "Pedido de demissão (resilição pelo empregado)",
  "Rescisão indireta",
  "Rescisão por culpa recíproca",
  "Rescisão por acordo entre as partes",
  "Extinção legal ou por motivo de ordem pública",
] as const;

export const JUST_CAUSE_TYPES = [
  "Abandono de emprego",
  "Incontinência de conduta ou mau comportamento",
  "Negociação habitual por conta própria ou de terceiros",
  "Condenação criminal",
  "Desídia no desempenho das funções",
  "Embriaguez habitual ou em serviço",
  "Violação de segredo da empresa",
  "Ato de indisciplina ou de insubordinação",
  "Ato lesivo da honra ou boa fama",
  "Ofensas físicas",
  "Prática constante de jogos de azar",
  "Perda de habilitação ou requisitos legais para o exercício da função",
  "Ato fraudulento em detrimento do empregador",
  "Redução dolosa da produção ou produtividade",
] as const;

export type TerminationReason = (typeof TERMINATION_REASONS)[number];

export function requiresTerminationSubtype(reason: string | null | undefined) {
  return reason === "Dispensa por justa causa";
}
