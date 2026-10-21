/**
 * Fusos brasileiros aceitos no cadastro da unidade (IANA). A batida usa o fuso da unidade de execução;
 * sem fuso válido na unidade, vale o do estabelecimento do empregador (decisão do programador, 19/10/2026).
 */
export const BRAZIL_TIME_ZONES = [
  { id: "America/Noronha", label: "Fernando de Noronha (UTC−02:00)" },
  { id: "America/Fortaleza", label: "Fortaleza, São Luís, Teresina, Natal (UTC−03:00)" },
  { id: "America/Recife", label: "Recife, João Pessoa (UTC−03:00)" },
  { id: "America/Maceio", label: "Maceió, Aracaju (UTC−03:00)" },
  { id: "America/Bahia", label: "Salvador (UTC−03:00)" },
  { id: "America/Belem", label: "Belém, Macapá (UTC−03:00)" },
  { id: "America/Santarem", label: "Santarém (UTC−03:00)" },
  { id: "America/Araguaina", label: "Palmas, Araguaína (UTC−03:00)" },
  { id: "America/Sao_Paulo", label: "Brasília, São Paulo, Rio, Sul e Sudeste (UTC−03:00)" },
  { id: "America/Campo_Grande", label: "Campo Grande (UTC−04:00)" },
  { id: "America/Cuiaba", label: "Cuiabá (UTC−04:00)" },
  { id: "America/Porto_Velho", label: "Porto Velho (UTC−04:00)" },
  { id: "America/Boa_Vista", label: "Boa Vista (UTC−04:00)" },
  { id: "America/Manaus", label: "Manaus (UTC−04:00)" },
  { id: "America/Rio_Branco", label: "Rio Branco (UTC−05:00)" },
  { id: "America/Eirunepe", label: "Eirunepé (UTC−05:00)" },
] as const;

export type BrazilTimeZone = (typeof BRAZIL_TIME_ZONES)[number]["id"];

export function isBrazilTimeZone(value: unknown): value is BrazilTimeZone {
  return typeof value === "string" && BRAZIL_TIME_ZONES.some((zone) => zone.id === value);
}

/** Instante de um timestamp fiscal (AAAA-MM-DDThh:mm:ss±hhmm), para ordenar batidas gravadas em fusos diferentes. */
export function repPInstantMs(markedAt: string) {
  return Date.parse(markedAt.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

/** Data civil (AAAA-MM-DD) de um instante no fuso informado. */
export function repPDateInZone(timeZone: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Fuso que vale para a batida: o da unidade de execução quando cadastrado, senão o do estabelecimento. */
export function repPMarkingTimeZone(unitTimeZone: unknown, establishmentTimeZone: string) {
  return isBrazilTimeZone(unitTimeZone) ? unitTimeZone : establishmentTimeZone;
}
