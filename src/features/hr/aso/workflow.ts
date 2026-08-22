import { createHash, randomBytes } from 'node:crypto';

export function createAsoToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashAsoToken(token) };
}

export function hashAsoToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function isoAfterDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function extractAppointmentProposal(value: string) {
  const text = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12_000);
  const dateMatch = text.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
  const timeMatch = text.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/i);
  const addressMatch = text.match(/(?:endere[cç]o|local|cl[ií]nica)\s*[:\-]\s*([^.;]{8,220})/i);
  let date: string | null = null;
  if (dateMatch) {
    const year = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
    date = `${year}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
  }
  const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : null;
  const location = addressMatch?.[1]?.trim() ?? null;
  const found = [date, time, location].filter(Boolean).length;
  return { date, time, location, responseText: text, confidence: found / 3 };
}

export function formatAsoAppointment(date: string, time: string) {
  const instant = new Date(`${date}T${time}:00-03:00`);
  if (!Number.isFinite(instant.getTime())) return `${date} às ${time}`;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Belem', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(instant) + ` às ${time}`;
}

export function missingAsoEmailPrerequisites(input: {
  expectedAdmissionDate?: string | null;
  essentialFormDataReady: boolean;
  paymentPaid: boolean;
  requestPdfReady: boolean;
}) {
  const missing: string[] = [];
  if (!input.essentialFormDataReady) missing.push('dados essenciais do formulário');
  if (!input.expectedAdmissionDate) missing.push('data de admissão');
  if (!input.paymentPaid) missing.push('confirmação do pagamento do ASO');
  if (!input.requestPdfReady) missing.push('solicitação do ASO em PDF');
  return missing;
}
