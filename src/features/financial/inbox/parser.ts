import type {
  FinancialInboxBillingIdentity,
  FinancialInboxClassification,
  FinancialInboxDocumentHints,
  FinancialInboxDocumentType,
  FinancialInboxFiscalDocumentKind,
  FinancialInboxFiscalIdentity,
  FinancialInboxFiscalRevenueItem,
  FinancialInboxServiceType,
} from "./types";

const MAX_LINKS = 20;
const MAX_TEXT_LENGTH = 80_000;
const BILLING_SUBJECT_TERMS = /(?:boleto|fatura|cobran[cç]a|conta\s+(?:digital|mensal)|vencimento|nota\s+fiscal|guia|recibo|demonstrativo)/i;
const MARKETING_SUBJECT_TERMS = /(?:\b(?:oferta|promo[cç][aã]o|ganhe|benef[ií]cios?|assine|contrate|carrinho|produtividade)\b|por\s+apenas|faltou\s+pouco|volte\s+aqui|ainda\s+d[aá]\s+tempo|tenha\s+a\s+melhor|gerencie\s+os\s+dados|microsoft\s*365.*(?:nuvem|arquivos|clique)|plano\s+standard)/i;

function decodeBasicEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function htmlToPlainText(value: string) {
  return decodeBasicEntities(
    value
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>|<\/div>|<\/li>|<\/tr>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

export function extractEmailAddress(value: string) {
  const angle = value.match(/<([^<>\s]+@[^<>\s]+)>/);
  const plain = value.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return (angle?.[1] ?? plain?.[0] ?? "").trim().toLowerCase() || null;
}

function normalizeUrl(raw: string) {
  const trimmed = decodeBasicEntities(raw).replace(/[),.;]+$/, "").trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractExternalLinks(text: string, html: string) {
  const candidates: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) candidates.push(match[1]);
  for (const match of `${text}\n${html}`.matchAll(/https?:\/\/[^\s<>"']+/gi)) candidates.push(match[0]);
  const result: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (!normalized || result.includes(normalized)) continue;
    result.push(normalized);
    if (result.length >= MAX_LINKS) break;
  }
  return result;
}

function isoDate(day: string, month: string, year: string) {
  const parsedDay = Number(day);
  const parsedMonth = Number(month);
  const parsedYear = Number(year);
  if (parsedYear < 2000 || parsedYear > 2100 || parsedMonth < 1 || parsedMonth > 12 || parsedDay < 1 || parsedDay > 31) return null;
  return `${String(parsedYear).padStart(4, "0")}-${String(parsedMonth).padStart(2, "0")}-${String(parsedDay).padStart(2, "0")}`;
}

function extractDueDate(value: string) {
  const labeled = value.match(/(?:venc(?:imento|e(?:\s+em)?)|data\s+de\s+vencimento)\s*[:\-]?\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i);
  if (labeled) return isoDate(labeled[1], labeled[2], labeled[3]);
  const contextual = value.match(/(?:vencimento|boleto)[^\n\r]{0,100}?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i);
  if (contextual) return isoDate(contextual[1], contextual[2], contextual[3]);
  return null;
}

function extractCompetence(value: string) {
  const match = value.match(/(?:compet[eê]ncia|refer[eê]ncia|m[eê]s\s+de\s+refer[eê]ncia)(?:\s+de)?\s*[:\-]?\s*(0?[1-9]|1[0-2])[\/.-](20\d{2})/i);
  if (!match) return null;
  return `${match[2]}-${String(Number(match[1])).padStart(2, "0")}`;
}

function amountToCents(raw: string) {
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function extractAmount(value: string) {
  const labeled = value.match(/(?:valor(?:\s+(?:total|da\s+(?:fatura|guia|cobran[cç]a)))?|total)\s*[:\-]?\s*R\$\s*([\d.]+,\d{2})/i);
  if (labeled) return amountToCents(labeled[1]);
  const currency = value.match(/R\$\s*([\d.]+,\d{2})/i);
  return currency ? amountToCents(currency[1]) : null;
}

export function normalizePaymentBarcode(value: string) {
  const digits = value.replace(/\D/g, "");
  return [44, 46, 47, 48].includes(digits.length) ? digits : null;
}

export function extractPaymentBarcode(value: string) {
  const labeled = value.match(/(?:linha\s+digit[aá]vel|c[oó]digo\s+de\s+barras|c[oó]d(?:igo)?\s+barra)\s*[:\-]?\s*([\d.\s-]{44,70})/i);
  const formattedBankSlip = value.match(/(?<!\d)(\d{5}\.\d{5}\s+\d{5}\.\d{6}\s+\d{5}\.\d{6}\s+\d\s+\d{14})(?!\d)/);
  const generic = Array.from(value.matchAll(/(?<!\d)([\d][\d.\s-]{42,68}[\d])(?!\d)/g))
    .filter((match) => !/chave\s+de\s+acesso\s*[:\-]?\s*$/i.test(value.slice(Math.max(0, (match.index ?? 0) - 40), match.index)));
  const candidates = [
    labeled?.[1],
    formattedBankSlip?.[1],
    ...generic.map((match) => match[1]),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    const normalized = normalizePaymentBarcode(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function maskPaymentBarcode(value: string | null) {
  if (!value) return null;
  return `${value.slice(0, 5)}••••••••••••••••••••••••••••••••••${value.slice(-5)}`;
}

function documentType(value: string): { type: FinancialInboxDocumentType; confidence: "high" | "medium" | "low" } {
  const fiscalKind = detectFiscalDocumentKind(value);
  if (fiscalKind === "fgts") return { type: "fgts", confidence: "high" };
  if (fiscalKind === "das" || fiscalKind === "dare" || fiscalKind === "municipal_tax") {
    return { type: "tax", confidence: "high" };
  }
  if (fiscalKind === "darf" || fiscalKind === "dctfweb") return { type: "inss_darf", confidence: "high" };
  if (/honor[aá]rio\s+cont[aá]bil|mensalidade\s+cont[aá]bil/i.test(value)) return { type: "accounting_fee", confidence: "high" };
  if (/\b(?:das|dare|iss|icms|simples\s+nacional|tributo|imposto)\b/i.test(value)) return { type: "tax", confidence: "medium" };
  if (/\b(?:energia|telefone|telefonia|internet|[aá]gua|fatura\s+vivo)\b/i.test(value)) return { type: "utility_bill", confidence: "medium" };
  if (/\b(?:boleto|cobran[cç]a|fatura|vencimento|pagar)\b/i.test(value)) return { type: "charge", confidence: "medium" };
  return { type: "other", confidence: "low" };
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function detectFiscalDocumentKind(value: string): FinancialInboxFiscalDocumentKind | null {
  if (/documento\s+de\s+arrecada[cç][aã]o\s+do\s+simples\s+nacional|\bDAS\b[^\n]{0,80}\bsimples\s+nacional\b/i.test(value)) return "das";
  if (/\bDCTFWEB\b/i.test(value)) return "dctfweb";
  if (/documento\s+de\s+arrecada[cç][aã]o\s+de\s+receitas\s+federais|\bDARF\b/i.test(value)) return "darf";
  if (/documento\s+de\s+arrecada[cç][aã]o\s+de\s+receitas\s+estaduais|\bDARE\b/i.test(value)) return "dare";
  if (/\bFGTS\b|guia\s+do\s+fgts\s+digital|\bGFD\b/i.test(value)) return "fgts";
  if (/documento\s+de\s+arrecada[cç][aã]o\s+municipal|guia\s+de\s+recolhimento\s+municipal/i.test(value)) return "municipal_tax";
  return null;
}

function firstLineValue(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1]?.replace(/\s{2,}/g, " ").trim().slice(0, 180) || null;
}

function fiscalCollectorName(kind: FinancialInboxFiscalDocumentKind, value: string) {
  if (["das", "darf", "dctfweb"].includes(kind)) return "Receita Federal do Brasil";
  if (kind === "fgts") return "FGTS";
  if (kind === "dare") {
    const named = firstLineValue(value, /(SECRETARIA\s+DE\s+ESTADO\s+DA\s+FAZENDA(?:\s+DO\s+[A-ZÀ-Ý ]+)?)/i);
    if (named) return named;
    const state = firstLineValue(value, /ESTADO\s+DO\s+([A-ZÀ-Ý ]{2,40})(?:\n|—|-)/i);
    return state ? `Secretaria de Estado da Fazenda do ${state}` : "Secretaria de Estado da Fazenda";
  }
  if (kind === "municipal_tax") {
    return firstLineValue(value, /((?:PREFEITURA|MUNIC[IÍ]PIO)\s+DE\s+[A-ZÀ-Ý][A-ZÀ-Ý ]{2,80})(?:\n|$)/i);
  }
  return null;
}

function fiscalRevenueDescriptions(kind: FinancialInboxFiscalDocumentKind, value: string) {
  const descriptions = new Set<string>();
  if (kind === "das") descriptions.add("Simples Nacional");
  if (/ICMS\s+ANTECIPADO/i.test(value)) descriptions.add("ICMS antecipado");
  else if (/\bICMS\b/i.test(value)) descriptions.add("ICMS");
  if (/\bISS(?:QN)?\b/i.test(value)) descriptions.add("ISS");
  if (/CONTR(?:IBUI[CÇ][AÃ]O)?\s+PREV|\bINSS\b/i.test(value)) descriptions.add("Contribuição previdenciária");
  if (/FGTS\s+RESCIS[OÓ]RIO|RESCIS[OÓ]RIO[^\n]{0,40}FGTS/i.test(value)) descriptions.add("FGTS rescisório");
  else if (kind === "fgts") descriptions.add("FGTS");
  if (/\bIRRF\b|IMPOSTO\s+DE\s+RENDA\s+RETIDO/i.test(value)) descriptions.add("IRRF");
  if (/\bIRPJ\b/i.test(value)) descriptions.add("IRPJ");
  if (/\bCOFINS\b/i.test(value)) descriptions.add("COFINS");
  if (/\bPIS(?:\/PASEP)?\b/i.test(value)) descriptions.add("PIS/Pasep");
  if (/\bCSLL\b/i.test(value)) descriptions.add("CSLL");
  if (/(?:CONSULTA|TAXA)\s+DE\s+ALVAR[AÁ]/i.test(value)) descriptions.add("Alvará");
  return [...descriptions].slice(0, 20);
}

function fiscalRevenueItems(
  kind: FinancialInboxFiscalDocumentKind,
  value: string,
  revenueCodes: string[],
  revenueDescriptions: string[],
): FinancialInboxFiscalRevenueItem[] {
  const items: FinancialInboxFiscalRevenueItem[] = [];
  if (kind === "das") {
    for (const line of value.split(/\r?\n/)) {
      const match = line.match(/^\s*(\d{4})\s+(.+?)\s+((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})(?:\s+((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}))*\s*$/i);
      if (!match) continue;
      const amounts = Array.from(line.matchAll(/(?:^|\s)((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})(?=\s|$)/g));
      const amountCents = amountToCents(amounts.at(-1)?.[1] ?? match[3]);
      const description = match[2].replace(/\s{2,}/g, " ").trim().slice(0, 180);
      items.push({ code: match[1], description, amountCents });
    }
  }
  if (items.length === 0 && revenueDescriptions.length === 1) {
    items.push({ code: revenueCodes.length === 1 ? revenueCodes[0] : null, description: revenueDescriptions[0], amountCents: null });
  }
  return items.filter((item, index, all) => all.findIndex((candidate) => (
    candidate.code === item.code && normalizedFiscalToken(candidate.description) === normalizedFiscalToken(item.description)
  )) === index).slice(0, 20);
}

export function extractFiscalIdentity(value: string): FinancialInboxFiscalIdentity | null {
  const documentKind = detectFiscalDocumentKind(value);
  if (!documentKind) return null;
  const taxpayerTaxIdRaw = firstLineValue(
    value,
    /(?:CPF\s*\/\s*CNPJ(?:\s+DO\s+(?:EMPREGADOR|CONTRIBUINTE))?|CNPJ)\s*[:#-]?\s*(\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2})/i,
  );
  const taxpayerTaxId = digits(taxpayerTaxIdRaw);
  const documentNumber = firstLineValue(
    value,
    /(?:n[uú]mero\s+do\s+documento|nosso\s+n[uú]mero|n[uú]mero\s+da\s+guia)\s*[:#-]?\s*([0-9][0-9.\/-]{2,39})/i,
  );
  const revenueCodes = [...new Set(Array.from(value.matchAll(
    /(?:c[oó]digo(?:\s+da\s+receita)?|c[oó]d\.\s+receita)\s*[:#-]?\s*(\d{3,10})(?!\d)/gi,
  ), (match) => match[1]))].slice(0, 20);
  const revenueDescriptions = fiscalRevenueDescriptions(documentKind, value);
  const revenueItems = fiscalRevenueItems(documentKind, value, revenueCodes, revenueDescriptions);
  return {
    documentKind,
    collectorName: fiscalCollectorName(documentKind, value),
    taxpayerName: firstLineValue(
      value,
      /(?:nome\s*\/\s*raz[aã]o\s+social|raz[aã]o\s+social|contribuinte|sacado)\s*[:#-]?\s*([^\n\r]{3,180})/i,
    ),
    taxpayerTaxId: taxpayerTaxId.length === 11 || taxpayerTaxId.length === 14 ? taxpayerTaxId : null,
    taxpayerRegistration: firstLineValue(
      value,
      /(?:inscri[cç][aã]o\s+estadual|inscri[cç][aã]o\s+municipal)\s*[:#-]?\s*([A-Z0-9.\/-]{3,40})/i,
    ),
    documentNumber,
    revenueCodes: [...new Set([...revenueCodes, ...revenueItems.flatMap((item) => item.code ? [item.code] : [])])].slice(0, 20),
    revenueDescriptions,
    revenueItems,
  };
}

function normalizedFiscalToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function compareFiscalIdentities(
  source: FinancialInboxFiscalIdentity | null | undefined,
  target: FinancialInboxFiscalIdentity | null | undefined,
) {
  if (!source) return { required: false, compatible: true, reasons: [] as string[] };
  if (!target || source.documentKind !== target.documentKind) {
    return { required: true, compatible: false, reasons: [] as string[] };
  }
  const sourceDescriptions = source.revenueDescriptions.map(normalizedFiscalToken).filter(Boolean);
  const targetDescriptions = new Set(target.revenueDescriptions.map(normalizedFiscalToken).filter(Boolean));
  if (sourceDescriptions.length && targetDescriptions.size
    && !sourceDescriptions.some((description) => targetDescriptions.has(description))) {
    return { required: true, compatible: false, reasons: [] as string[] };
  }
  if (source.revenueCodes.length && target.revenueCodes.length
    && !source.revenueCodes.some((code) => target.revenueCodes.includes(code))) {
    return { required: true, compatible: false, reasons: [] as string[] };
  }
  const nature = [source.documentKind.toUpperCase(), ...source.revenueDescriptions].join(" / ");
  return {
    required: true,
    compatible: true,
    reasons: [`mesma natureza fiscal: ${nature}`],
  };
}

function mergeFiscalIdentities(
  extracted: FinancialInboxFiscalIdentity | null,
  hints: FinancialInboxDocumentHints[],
) {
  const identities = hints
    .filter((hint) => hint.confidence !== "low" && hint.fiscalIdentity)
    .map((hint) => hint.fiscalIdentity!);
  if (!extracted && identities.length === 0) return null;
  const base = extracted ?? identities[0];
  return identities.reduce<FinancialInboxFiscalIdentity>((current, identity) => ({
    documentKind: current.documentKind || identity.documentKind,
    collectorName: current.collectorName || identity.collectorName,
    taxpayerName: current.taxpayerName || identity.taxpayerName,
    taxpayerTaxId: current.taxpayerTaxId || identity.taxpayerTaxId,
    taxpayerRegistration: current.taxpayerRegistration || identity.taxpayerRegistration,
    documentNumber: current.documentNumber || identity.documentNumber,
    revenueCodes: [...new Set([...current.revenueCodes, ...identity.revenueCodes])].slice(0, 20),
    revenueDescriptions: [...new Set([...current.revenueDescriptions, ...identity.revenueDescriptions])].slice(0, 20),
    revenueItems: [...(current.revenueItems ?? []), ...(identity.revenueItems ?? [])].filter((item, index, all) => all.findIndex((candidate) => (
      candidate.code === item.code && normalizedFiscalToken(candidate.description) === normalizedFiscalToken(item.description)
    )) === index).slice(0, 20),
  }), base);
}

export function normalizeBrazilianServiceNumber(value: unknown) {
  const normalized = digits(value);
  if (normalized.length === 10 || normalized.length === 11) return `+55${normalized}`;
  if ((normalized.length === 12 || normalized.length === 13) && normalized.startsWith("55")) return `+${normalized}`;
  return null;
}

export function extractTelecomServiceNumbers(value: string) {
  const matches = Array.from(value.matchAll(
    /(?:n[uú]mero\s+(?:da\s+)?linha|linha(?!\s+digit[aá]vel)|telefone\s+principal|telefone|terminal|celular|n[uú]mero\s+de\s+acesso)\s*(?:n[ºo°.]|n[uú]mero)?\s*[:#\-]?\s*(\+?55\s*)?(\(?\d{2}\)?[\s.-]*\d{4,5}[\s.-]*\d{4})(?!\d)/gi,
  ));
  return [...new Set(matches.flatMap((match) => {
    const normalized = normalizeBrazilianServiceNumber(`${match[1] ?? ""}${match[2] ?? ""}`);
    return normalized ? [normalized] : [];
  }))].slice(0, 20);
}

function labeledIdentifier(value: string, labels: string[]) {
  const pattern = new RegExp(`(?:${labels.join("|")})\\s*(?:n[ºo°.]|n[uú]mero)?\\s*[:#\\-]?\\s*([A-Z0-9][A-Z0-9.\\/-]{2,39})`, "gi");
  for (const match of value.matchAll(pattern)) {
    const candidate = match[1]?.replace(/[.,;:]$/, "").trim() || "";
    if (/\d/.test(candidate)) return candidate;
  }
  return null;
}

function supplierTaxId(value: string) {
  const match = value.match(/(?:benefici[aá]rio|cedente|fornecedor)[^\n\r]{0,100}?CNPJ\s*[:\-]?\s*(\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2})/i);
  const normalized = digits(match?.[1]);
  if (normalized.length === 14) return normalized;
  const accessKey = value.match(/(?:chave\s+(?:de\s+)?acesso|chave\s+nf-?e)[^\d]{0,20}(\d{44})(?!\d)/i)?.[1];
  return accessKey ? accessKey.slice(6, 20) : null;
}

export function extractFinancialDocumentReferences(value: string) {
  const references = new Set<string>();
  const patterns = [
    /(?:NF(?:-?e)?|NFS(?:-?e)?|nota\s+fiscal|pedido|documento)\s*(?:n[ºo°.]|n[uú]mero)?\s*[:#\-]?\s*(\d{3,20})(?!\d)/gi,
    /(?:^|[_\-\s])(?:NF(?:-?e)?|NFS(?:-?e)?|BOLETO)[_\-\s]+[^\n\r]{0,50}?[_\-\s](\d{3,20})(?=[_.\-\s]|$)/gi,
    /(?:n[uú]mero\s+do\s+documento|nosso\s+n[uú]mero|n[uú]mero\s+da\s+guia)\s*[:#\-]?\s*([0-9][0-9.\/-]{2,39})/gi,
  ];
  for (const [index, pattern] of patterns.entries()) {
    for (const match of value.matchAll(pattern)) {
      const reference = index === 2 ? digits(match[1]) : match[1];
      if (reference.length >= 3) references.add(reference);
    }
  }
  return [...references].slice(0, 20);
}

export function extractFinancialInstallmentReference(value: string) {
  const match = value.match(
    /(?:parcela|parcelamento)\s*(?:n[ºo°.]|n[uú]mero)?\s*[:#\-]?\s*(\d{1,3})\s*(?:\/|de)\s*(\d{1,3})(?!\d)/i,
  );
  if (!match) return { installmentNumber: null, installmentTotal: null };
  const installmentNumber = Number(match[1]);
  const installmentTotal = Number(match[2]);
  if (!Number.isInteger(installmentNumber)
    || !Number.isInteger(installmentTotal)
    || installmentNumber < 1
    || installmentTotal < installmentNumber
    || installmentTotal > 999) {
    return { installmentNumber: null, installmentTotal: null };
  }
  return { installmentNumber, installmentTotal };
}

function detectServiceType(value: string): FinancialInboxServiceType | null {
  if (/\b(?:m[oó]vel|celular|linha\s+m[oó]vel)\b/i.test(value)) return "mobile";
  if (/\b(?:telefone\s+fixo|telefonia\s+fixa)\b/i.test(value)) return "landline";
  if (/\b(?:internet|banda\s+larga|fibra)\b/i.test(value)) return "internet";
  if (/\b(?:energia|conta\s+de\s+luz)\b/i.test(value)) return "energy";
  if (/\b(?:[aá]gua|saneamento)\b/i.test(value)) return "water";
  return null;
}

export function extractBillingIdentity(value: string): FinancialInboxBillingIdentity {
  return {
    supplierTaxId: supplierTaxId(value),
    customerAccount: labeledIdentifier(value, ["conta", "c[oó]digo\\s+do\\s+cliente", "n[uú]mero\\s+do\\s+cliente"]),
    contractNumber: labeledIdentifier(value, ["contrato", "n[uú]mero\\s+do\\s+contrato"]),
    serviceType: detectServiceType(value),
    serviceNumbers: extractTelecomServiceNumbers(value),
  };
}

export function mergeBillingIdentities(
  extracted: FinancialInboxBillingIdentity,
  additions: Array<Partial<FinancialInboxBillingIdentity> | FinancialInboxDocumentHints | null | undefined>,
): FinancialInboxBillingIdentity {
  return additions.reduce<FinancialInboxBillingIdentity>((current, hint) => ({
    supplierTaxId: current.supplierTaxId || hint?.supplierTaxId || null,
    customerAccount: current.customerAccount || hint?.customerAccount || null,
    contractNumber: current.contractNumber || hint?.contractNumber || null,
    serviceType: current.serviceType || hint?.serviceType || null,
    serviceNumbers: [...new Set([
      ...current.serviceNumbers,
      ...(hint?.serviceNumbers ?? []).map(normalizeBrazilianServiceNumber).filter((entry): entry is string => Boolean(entry)),
    ])].slice(0, 20),
  }), extracted);
}

function supplierName(senderDomain: string | null, value: string) {
  if (senderDomain === "grupomse.com" || /maximus\s+contabilidade/i.test(value)) return "Maximus Contabilidade / Grupo MSE";
  const labels = String(senderDomain ?? "").toLowerCase().split(".").filter(Boolean);
  const rootIndex = labels.at(-1) === "br" && ["com", "net", "org"].includes(labels.at(-2) ?? "")
    ? labels.length - 3
    : labels.length - 2;
  const root = labels[rootIndex] ?? "";
  if (root && !["gmail", "hotmail", "outlook", "yahoo", "resend"].includes(root)) {
    return root.charAt(0).toUpperCase() + root.slice(1);
  }
  return null;
}

function isLikelyMarketingEmail(input: {
  subject: string;
  combined: string;
  documentText: string;
  hints: FinancialInboxDocumentHints[];
  barcode: string | null;
}) {
  if (BILLING_SUBJECT_TERMS.test(input.subject)) return false;
  const hasBillingEvidence = Boolean(
    input.barcode
    || extractDueDate(input.combined)
    || extractCompetence(input.combined)
    || input.hints.some((hint) => (
      hint.barcode
      || hint.dueDate
      || hint.competence
      || (hint.amountCents != null && Boolean(hint.customerAccount || hint.contractNumber || hint.serviceNumbers.length))
    ))
    || /(?:total\s+a\s+pagar|valor\s+da\s+fatura|linha\s+digit[aá]vel|data\s+de\s+vencimento)/i.test(input.documentText)
  );
  return !hasBillingEvidence && MARKETING_SUBJECT_TERMS.test(input.subject);
}

function agreedDocumentHint<T extends string | number>(
  hints: FinancialInboxDocumentHints[],
  selector: (hint: FinancialInboxDocumentHints) => T | null | undefined,
) {
  const values = hints
    .filter((hint) => hint.confidence !== "low")
    .map(selector)
    .filter((value): value is T => value !== null && value !== undefined);
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
}

export function classifyFinancialEmail(input: {
  subject: string;
  text?: string | null;
  html?: string | null;
  senderDomain?: string | null;
  documentText?: string | null;
  documentHints?: FinancialInboxDocumentHints[];
  documentReferences?: string[];
}): { textContent: string; textPreview: string; classification: FinancialInboxClassification } {
  const textContent = (input.text?.trim() || htmlToPlainText(input.html ?? "")).slice(0, MAX_TEXT_LENGTH);
  const documentText = String(input.documentText ?? "").slice(0, MAX_TEXT_LENGTH);
  const hints = input.documentHints ?? [];
  const hintText = hints.map((hint) => hint.documentText || "").join("\n").slice(0, MAX_TEXT_LENGTH);
  const documentEvidence = `${documentText}\n${hintText}`.trim().slice(0, MAX_TEXT_LENGTH * 2);
  const combined = `${input.subject}\n${textContent}\n${documentText}\n${hintText}`.slice(0, MAX_TEXT_LENGTH * 2);
  const documentIdentification = documentEvidence ? documentType(documentEvidence) : null;
  const identified = documentIdentification && documentIdentification.confidence === "high"
    ? documentIdentification
    : documentType(combined);
  const barcode = agreedDocumentHint(hints, (hint) => hint.barcode) || extractPaymentBarcode(combined);
  const documentSupplier = agreedDocumentHint(hints, (hint) => hint.supplierName);
  const documentCompetence = agreedDocumentHint(hints, (hint) => hint.competence);
  const documentDueDate = agreedDocumentHint(hints, (hint) => hint.dueDate);
  const documentAmountCents = agreedDocumentHint(hints, (hint) => hint.amountCents);
  const fiscalIdentity = mergeFiscalIdentities(extractFiscalIdentity(documentEvidence || combined), hints);
  const extractedBillingIdentity = mergeBillingIdentities(
    extractBillingIdentity(fiscalIdentity ? documentEvidence || combined : combined),
    hints,
  );
  const billingIdentity = fiscalIdentity
    ? {
        supplierTaxId: extractedBillingIdentity.supplierTaxId,
        customerAccount: null,
        contractNumber: null,
        serviceType: "other" as const,
        serviceNumbers: [],
      }
    : extractedBillingIdentity;
  const installment = extractFinancialInstallmentReference(combined);
  const marketingLikely = isLikelyMarketingEmail({
    subject: input.subject,
    combined,
    documentText,
    hints,
    barcode,
  });
  return {
    textContent,
    textPreview: textContent.replace(/\s+/g, " ").trim().slice(0, 500),
    classification: {
      documentType: identified.type,
      financeLikely: !marketingLikely && identified.type !== "other",
      marketingLikely,
      confidence: identified.confidence,
      supplierName: fiscalIdentity?.collectorName
        || documentSupplier
        || (fiscalIdentity ? null : supplierName(input.senderDomain ?? null, combined)),
      competence: documentCompetence || extractCompetence(combined),
      dueDate: documentDueDate || extractDueDate(combined),
      amountCents: documentAmountCents ?? extractAmount(combined),
      barcode,
      barcodeMasked: maskPaymentBarcode(barcode),
      documentReferences: [...new Set([
        ...extractFinancialDocumentReferences(combined),
        ...(fiscalIdentity?.documentNumber ? [digits(fiscalIdentity.documentNumber)] : []),
        ...(input.documentReferences ?? []).flatMap(extractFinancialDocumentReferences),
      ].filter((reference) => reference.length >= 3))].slice(0, 20),
      installmentNumber: installment.installmentNumber,
      installmentTotal: installment.installmentTotal,
      links: extractExternalLinks(input.text ?? "", input.html ?? ""),
      billingIdentity,
      fiscalIdentity,
    },
  };
}
