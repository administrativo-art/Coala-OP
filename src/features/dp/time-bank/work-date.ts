/**
 * A que dia de trabalho pertence uma batida (regra decidida em 27/11/2026). Pura. Todos os consumidores passam a
 * usá-la juntos, atrás de `DP_TIME_NIGHT_SHIFT_ENABLED`; com a chave desligada, o banco e o AEJ seguem com
 * `overnightWorkDate` e as demais leituras usam a data civil da batida.
 */
export const NIGHT_SHIFT_EXIT_LIMIT_MINUTES = 240;

export type WorkDateShift = {
  date: string; type: "work" | "day_off"; startTime: string | null; endTime: string | null; overnight?: boolean;
};

const dayShift = (date: string, offset: number) => new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const minutesOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** O turno termina no dia seguinte: marcado como noturno ou com fim igual ou anterior ao início. */
export function crossesMidnight(overnight: unknown, startTime: string | null, endTime: string | null) {
  return overnight === true || Boolean(startTime && endTime && minutesOf(endTime) <= minutesOf(startTime));
}

/**
 * A batida pertence ao turno da véspera quando é feita até 4h depois do fim previsto dele e antes do início do turno
 * do próprio dia. `civilDate` é a data em que a batida foi registrada; `markedAt` traz o horário local da unidade.
 * Vale para qualquer turno da véspera: um que termina 23h30 também recebe a saída à 00h20.
 */
export function attributeWorkDate(civilDate: string, markedAt: string, shifts: WorkDateShift[]) {
  const previous = dayShift(civilDate, -1);
  const clock = minutesOf(markedAt.slice(11, 16));
  // Fim em minutos contados a partir do início da véspera; passa de 1440 quando o turno atravessa a meia-noite.
  const ends = shifts.flatMap((shift) => {
    if (shift.date !== previous || shift.type !== "work" || !shift.endTime) return [];
    const end = minutesOf(shift.endTime);
    return [crossesMidnight(shift.overnight, shift.startTime, shift.endTime) ? end + 1440 : end];
  });
  if (!ends.length || clock + 1440 > Math.max(...ends) + NIGHT_SHIFT_EXIT_LIMIT_MINUTES) return civilDate;
  const starts = shifts.flatMap((shift) => shift.date === civilDate && shift.type === "work" && shift.startTime ? [minutesOf(shift.startTime)] : []);
  return starts.length && clock >= Math.min(...starts) ? civilDate : previous;
}

/**
 * Caminho inverso, para o pedido de inclusão: em que data caiu o horário `clock` ("HH:mm") informado no turno de
 * `workDate`. Usa a própria regra de atribuição; `null` = pela regra, esse horário é de outro dia de trabalho.
 */
export function civilDateForWorkDate(workDate: string, clock: string, shifts: WorkDateShift[]) {
  return [dayShift(workDate, 1), workDate]
    .find((civil) => attributeWorkDate(civil, `${civil}T${clock}`, shifts) === workDate) ?? null;
}

/** Datas de batida que precisam ser lidas para montar um período: a saída do último dia pode estar no dia seguinte. */
export function markingReadRange(start: string, end: string) {
  return { start, end: dayShift(end, 1) };
}

/** Datas de escala necessárias: a véspera decide se a batida do primeiro dia é do período; o dia seguinte limita a do último. */
export function shiftReadRange(start: string, end: string) {
  return { start: dayShift(start, -1), end: dayShift(end, 1) };
}

/**
 * Reatribui as batidas lidas em `markingReadRange` e mantém só as do período: o turno que passa de um mês para o outro
 * fica no mês em que começou. Só `workDate` muda: nenhum campo novo, para não alterar a conferência dos demais dias.
 */
export function attributeMarkings<T extends { workDate: string; markedAt: string }>(markings: T[], shifts: WorkDateShift[], start: string, end: string) {
  return markings.map((marking) => ({ ...marking, workDate: attributeWorkDate(marking.workDate, marking.markedAt, shifts) }))
    .filter((marking) => marking.workDate >= start && marking.workDate <= end);
}
