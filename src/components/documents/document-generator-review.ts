import { resolveDocumentFormSchema, type DocumentFormSchema } from "@/features/hr/documents/document-form-schema";

const brlFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBrl(value: unknown) {
  const amount = Number(value);
  return value === "" || value == null || !Number.isFinite(amount) ? "" : brlFormatter.format(amount);
}

export function parseBrl(value: string): number | "" {
  const clean = value.replace(/[^\d,.-]/g, "");
  if (!clean) return "";
  const decimal = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean.replace(/\./g, "");
  const amount = Number(decimal);
  return Number.isFinite(amount) ? amount : "";
}

export function formatIntegerReais(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return (digits.replace(/^0+(?=\d)/, "") || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function amountFromParts(reais: string, cents: string): number | "" {
  const whole = reais.replace(/\D/g, "");
  if (!whole && !cents.replace(/0/g, "")) return "";
  const fraction = cents.replace(/\D/g, "").slice(0, 2).padEnd(2, "0");
  return Number(whole || "0") + Number(fraction) / 100;
}

export type CurrencyEdit = { display: string; amount: number | ""; caret: number; selectionEnd?: number };

export function currencyDisplay(value: unknown): string {
  if (value === "" || value == null || !Number.isFinite(Number(value))) return "";
  const [whole, cents] = Number(value).toFixed(2).split(".");
  return `R$ ${formatIntegerReais(whole)},${cents}`;
}

function caretAfterDigits(prefix: string, count: number) {
  if (count === 0) return 3;
  let seen = 0;
  for (let index = 3; index < prefix.length; index += 1) {
    if (/\d/.test(prefix[index])) seen += 1;
    if (seen === count) return index + 1;
  }
  return prefix.length;
}

export function editCurrency(display: string, key: string, start: number, end = start): CurrencyEdit {
  const comma = display.indexOf(",");
  let whole = comma < 0 ? "" : display.slice(3, comma).replace(/\D/g, "");
  let cents = comma < 0 ? "00" : display.slice(comma + 1).padEnd(2, "0").slice(0, 2);
  if (start <= 3 && end === display.length && /^\d$/.test(key)) cents = "00";
  if (key === "," || key === ".") {
    const next = display || "R$ 0,00";
    const at = next.indexOf(",") + 1;
    return { display: next, amount: parseBrl(next), caret: at, selectionEnd: next.length };
  }
  const inCents = comma >= 0 && start > comma;
  if (inCents) {
    const offset = Math.min(2, start - comma - 1);
    if (/^\d$/.test(key)) {
      const finish = Math.max(offset + 1, Math.min(2, end - comma - 1));
      cents = (cents.slice(0, offset) + key + cents.slice(finish)).padEnd(2, "0").slice(0, 2);
    } else if (key === "Backspace" || key === "Delete") {
      const target = key === "Backspace" ? Math.max(0, offset - 1) : Math.min(1, offset);
      cents = cents.slice(0, target) + "0" + cents.slice(target + 1);
    }
    const next = `R$ ${formatIntegerReais(whole || "0")},${cents}`;
    const nextComma = next.indexOf(",");
    return { display: next, amount: amountFromParts(whole || "0", cents), caret: nextComma + 1 + Math.min(2, key === "Backspace" ? Math.max(0, offset - 1) : offset + 1) };
  }
  const digitStart = display.slice(3, Math.min(start, comma < 0 ? start : comma)).replace(/\D/g, "").length;
  const digitEnd = display.slice(3, Math.min(end, comma < 0 ? end : comma)).replace(/\D/g, "").length;
  let caretDigits = digitStart;
  if (/^\d$/.test(key)) {
    whole = whole.slice(0, digitStart) + key + whole.slice(digitEnd);
    caretDigits += 1;
  } else if (key === "Backspace") {
    const removeFrom = digitEnd > digitStart ? digitStart : Math.max(0, digitStart - 1);
    whole = whole.slice(0, removeFrom) + whole.slice(digitEnd);
    caretDigits = removeFrom;
  } else if (key === "Delete") {
    const removeTo = digitEnd > digitStart ? digitEnd : digitStart + 1;
    whole = whole.slice(0, digitStart) + whole.slice(removeTo);
  }
  if (!whole) return { display: "", amount: "", caret: 0 };
  const prefix = `R$ ${formatIntegerReais(whole)}`;
  return { display: `${prefix},${cents}`, amount: amountFromParts(whole, cents), caret: caretAfterDigits(prefix, caretDigits) };
}

/** Native/mobile input events can arrive without a usable keydown event. */
export function changeCurrencyInput(previous: string, raw: string, cursor: number): CurrencyEdit {
  if ((raw.match(/,/g) ?? []).length > 1) return editCurrency(previous, ",", cursor);
  const comma = raw.indexOf(",");
  const whole = (comma < 0 ? raw : raw.slice(0, comma)).replace(/\D/g, "");
  const cents = comma < 0 ? "00" : raw.slice(comma + 1).replace(/\D/g, "").slice(0, 2).padEnd(2, "0");
  const amount = amountFromParts(whole, cents);
  const display = currencyDisplay(amount);
  if (!display) return { display, amount: "", caret: 0 };
  if (comma >= 0 && cursor > comma) return { display, amount, caret: display.indexOf(",") + 1 + Math.min(2, cursor - comma - 1) };
  const digits = raw.slice(0, cursor).replace(/\D/g, "").length;
  return { display, amount, caret: caretAfterDigits(display.slice(0, display.indexOf(",")), digits) };
}

export function missingGeneratorFields(schema: DocumentFormSchema, values: Record<string, unknown>) {
  try { return [...new Set(resolveDocumentFormSchema(schema, values).missing)]; }
  catch { return ["Dados das partes inválidos"]; }
}

export function reviewActions(state: {
  pdfAvailable: boolean;
  missingRequired: string[];
  status: string;
  canReview: boolean;
}) {
  return {
    canApprove: state.canReview && state.pdfAvailable && state.missingRequired.length === 0 && ["draft", "review_pending"].includes(state.status),
    canStart: state.status === "approved" || state.status === "final",
  };
}

export function isCurrentPreviewResponse(startRevision: number, currentRevision: number) {
  return startRevision === currentRevision;
}
