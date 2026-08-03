export type ResignationNoticePreference = "work" | "request_waiver";

export const HANDWRITTEN_LETTER_CHECKLIST = [
  { id: "handwritten", label: "Escrevi toda a carta à mão." },
  { id: "dated", label: "Informei a cidade e a data." },
  { id: "notice", label: "Incluí minha preferência sobre o aviso-prévio." },
  { id: "signed", label: "Assinei a carta." },
  { id: "legible", label: "A carta está completa e legível." },
] as const;

export type HandwrittenLetterChecklistId = (typeof HANDWRITTEN_LETTER_CHECKLIST)[number]["id"];

function guideValue(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized || fallback;
}

export function buildHandwrittenResignationGuide(input: {
  employeeName?: string | null;
  employeeCpf?: string | null;
  companyName?: string | null;
  jobRoleName?: string | null;
  city?: string | null;
  noticePreference: ResignationNoticePreference;
}) {
  const noticeParagraph = input.noticePreference === "work"
    ? "Declaro que cumprirei o aviso-prévio de 30 dias, com início em __/__/____ e término previsto para __/__/____."
    : "Solicito a dispensa do cumprimento do aviso-prévio, ciente de que dependerá da concordância da empresa e de eventual desconto legal.";

  return `PEDIDO DE DEMISSÃO

À
${guideValue(input.companyName, "[NOME DA EMPRESA]")}

Eu, ${guideValue(input.employeeName, "[NOME COMPLETO DO COLABORADOR]")}, inscrito(a) no CPF sob o nº ${guideValue(input.employeeCpf, "[CPF]")}, ocupante do cargo de ${guideValue(input.jobRoleName, "[CARGO]")}, venho, por minha livre e espontânea vontade, comunicar formalmente meu pedido de demissão do emprego que atualmente ocupo nesta empresa.

${noticeParagraph}

Solicito as providências necessárias para a formalização do desligamento e pagamento das verbas rescisórias devidas.

${guideValue(input.city, "[CIDADE]")}, ____ de __________________ de ________.

________________________________
Assinatura`;
}

export function handwrittenLetterWasConfirmed(value: unknown) {
  return value === true || value === "true";
}
