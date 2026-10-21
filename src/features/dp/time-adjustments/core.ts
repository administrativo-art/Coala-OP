import { createHash } from 'node:crypto';

/**
 * Núcleo puro do ajuste de ponto (tratamento PTRP). A batida original nunca é alterada: "substituir" é
 * desconsiderar a original e incluir a nova, ambas identificadas e ligadas ao pedido (Portaria 671, arts. 74 IV,
 * 82 p.ú. e 84 V; leiaute AEJ registro 05: tpMarc D e fonteMarc I, motivo até 150 caracteres).
 */

export type AdjustmentKind = 'include' | 'discard' | 'correct';
export type AdjustmentStatus = 'in_review' | 'approved' | 'rejected' | 'cancelled';
export type AdjustmentAct = {
  action: 'requested' | 'approved' | 'rejected' | 'cancelled';
  actorUid: string;
  role: 'titular' | 'reviewer';
  at: string;
  clockSource: 'hora_legal' | 'server';
  reason?: string;
  previousHash: string | null;
  hash: string;
};

/** Primeiros 150 caracteres da justificativa vão para o campo `motivo` do AEJ; o texto completo fica no pedido. */
export const AEJ_REASON_LIMIT = 150;
export function aejReason(reason: string) {
  return reason.replace(/\|/g, '/').replace(/\s+/g, ' ').trim().slice(0, AEJ_REASON_LIMIT);
}

/** Código de verificação de cada ato, encadeado ao anterior: reversão ou nova decisão cria ato novo, nunca edita. */
export function adjustmentActHash(previousHash: string | null, act: Omit<AdjustmentAct, 'hash' | 'previousHash'>, payloadDigest: string) {
  return createHash('sha256').update(JSON.stringify([previousHash, act.action, act.actorUid, act.role, act.at,
    act.clockSource, act.reason ?? null, payloadDigest])).digest('hex');
}

export function adjustmentPayloadDigest(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** "AAAA-MM-DDThh:mm:00±hhmm" do horário civil informado no fuso da unidade (o mesmo formato da batida). */
export function zonedFiscalTimestamp(workDate: string, time: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !/^\d{2}:\d{2}$/.test(time)) throw new TypeError('Data ou hora inválida.');
  const guess = new Date(`${workDate}T${time}:00Z`);
  const offsetMinutes = (at: Date) => {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(at)
      .find((item) => item.type === 'timeZoneName')?.value ?? 'GMT';
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
    return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  };
  const offset = offsetMinutes(new Date(guess.getTime() - offsetMinutes(guess) * 60_000));
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${workDate}T${time}:00${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

export { applyTreatments, type EffectiveMarking } from "./effective";
