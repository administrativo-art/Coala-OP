import { z } from 'zod';

function isCivilDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1900 && year <= 9999 && month >= 1 && month <= 12
    && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export const absenceCivilDateSchema = z.string().refine(isCivilDate, 'Informe uma data válida.');
const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Informe o horário em HH:mm.');

const previewFields = z.object({
  absenceTypeId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,180}$/, 'Tipo de ausência inválido.'),
  startDate: absenceCivilDateSchema,
  endDate: absenceCivilDateSchema,
  unit: z.enum(['day', 'hour']),
  startTime: clockTimeSchema.optional(),
  endTime: clockTimeSchema.optional(),
}).strict();
type PreviewFields = z.infer<typeof previewFields>;
function refinePreview(value: PreviewFields, context: z.RefinementCtx) {
  if (value.endDate < value.startDate) context.addIssue({ code: 'custom', path: ['endDate'], message: 'O fim deve ser igual ou posterior ao início.' });
  const days = (Date.parse(`${value.endDate}T00:00:00Z`) - Date.parse(`${value.startDate}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > 366) context.addIssue({ code: 'custom', path: ['endDate'], message: 'O período deve ter no máximo 366 dias civis.' });
  if (value.unit === 'hour' && (!value.startTime || !value.endTime)) context.addIssue({ code: 'custom', path: ['startTime'], message: 'Informe os dois horários para solicitação em horas.' });
  if (value.unit === 'day' && (value.startTime || value.endTime)) context.addIssue({ code: 'custom', path: ['unit'], message: 'Horários são permitidos apenas em horas.' });
  if (value.unit === 'hour' && value.startTime && value.endTime && value.startDate === value.endDate && value.endTime <= value.startTime) {
    context.addIssue({ code: 'custom', path: ['endTime'], message: 'Para período noturno, informe explicitamente a data seguinte de término.' });
  }
}

export const absenceRequestPreviewSchema = previewFields.superRefine(refinePreview);

export type AbsenceRequestPreviewInput = z.infer<typeof absenceRequestPreviewSchema>;
export const absenceRequestTargetUidSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const absenceRequestPreviewRouteSchema = previewFields.extend({ beneficiaryUid: absenceRequestTargetUidSchema.optional() }).strict().superRefine(refinePreview);
