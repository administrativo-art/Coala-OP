export type FinancialDescriptionKind =
  | "internet"
  | "mobile_phone_bill"
  | "hr_system"
  | "dental_plan"
  | "rent"
  | "accounting_fee"
  | "das"
  | "salary"
  | "payroll_loan"
  | "fgts"
  | "inss"
  | "shopping_cart"
  | "gpt_codex"
  | "digital_signage"
  | "pdv_system"
  | "pdv_implementation"
  | "ride_hailing"
  | "card_revolving_charge"
  | "card_financed_balance_charge"
  | "card_iof"
  | "card_late_interest"
  | "card_late_fee";

export type CardStatementFinancialChargeKind = Extract<FinancialDescriptionKind,
  | "card_revolving_charge"
  | "card_financed_balance_charge"
  | "card_iof"
  | "card_late_interest"
  | "card_late_fee"
>;

export const FINANCIAL_DESCRIPTION_PATTERNS = {
  internet: "Internet - {unidade} | {favorecido}",
  mobile_phone_bill: "Conta de celular - {MM/AAAA} | {favorecido}",
  hr_system: "Sistema RH - Bizneo",
  dental_plan: "Plano odontológico - Odontoprev | {vinculado}",
  rent: "Aluguel - {unidade} | {favorecido}",
  accounting_fee: "Honorário contábil - {unidade} | {favorecido}",
  das: "DAS - Única - {MM/AAAA}",
  salary: "Salário - {MM/AAAA} | {colaborador}",
  payroll_loan: "Empréstimo consignado - {MM/AAAA} | {colaborador}",
  fgts: "FGTS - {MM/AAAA} | FGTS + empréstimo consignado",
  inss: "INSS - {MM/AAAA} | Folha de pagamento",
  shopping_cart: "Compra do carrinho - Shopping do Automóvel",
  gpt_codex: "GPT/Codex | {favorecido}",
  digital_signage: "Publicidade digital - Signage | {favorecido}",
  pdv_system: "Sistema PDV - {unidade} | {favorecido}",
  pdv_implementation: "Implantação do Sistema PDV - {unidade} | {favorecido}",
  ride_hailing: "Corrida por aplicativo - {DD/MM/AAAA} | {favorecido} - {passageiro}",
  card_revolving_charge: "Encargos do crédito rotativo - {MM/AAAA} | {instituição}",
  card_financed_balance_charge: "Encargos do saldo financiado - {MM/AAAA} | {instituição}",
  card_iof: "IOF do cartão - {MM/AAAA} | {instituição}",
  card_late_interest: "Juros de mora do cartão - {MM/AAAA} | {instituição}",
  card_late_fee: "Multa por atraso do cartão - {MM/AAAA} | {instituição}",
} as const satisfies Record<FinancialDescriptionKind, string>;

function requiredText(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} é obrigatório para montar a descrição financeira.`);
  return text;
}

export function displayFinancialMonth(value: string) {
  const text = requiredText(value, "Competência");
  const iso = text.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (iso) return `${iso[2]}/${iso[1]}`;
  const br = text.match(/^(\d{2})\/(\d{4})$/);
  if (br) return `${br[1]}/${br[2]}`;
  throw new Error("A competência deve estar em AAAA-MM, AAAA-MM-DD ou MM/AAAA.");
}

export function displayFinancialDate(value: string) {
  const text = requiredText(value, "Data");
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[1]}/${br[2]}/${br[3]}`;
  throw new Error("A data deve estar em AAAA-MM-DD ou DD/MM/AAAA.");
}

export function canonicalFinancialInstitution(value: string) {
  const institution = requiredText(value, "Instituição financeira");
  const normalized = comparableText(institution);
  if (normalized.includes("inter")) return "Banco Inter";
  return institution;
}

export function canonicalFinancialUnit(value: string) {
  const unit = requiredText(value, "Unidade");
  const normalized = unit
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  if (normalized.includes("joao paulo")) return "João Paulo";
  if (normalized.includes("tirirical")) return "Tirirical";
  if (normalized.includes("shopping do automovel")) return "Shopping do Automóvel";
  if (normalized.includes("administrativo") || normalized.includes("matriz")) return "Administrativo";
  return unit;
}

export function buildFinancialDescription(
  kind: FinancialDescriptionKind,
  params: {
    /** Competência contábil da obrigação. Nunca usar o mês de vencimento. */
    competence?: string;
    unit?: string;
    beneficiary?: string;
    linkedPerson?: string;
    employee?: string;
    transactionDate?: string;
    passenger?: string;
    financialInstitution?: string;
    hasPayrollLoan?: boolean;
  } = {},
) {
  switch (kind) {
    case "internet":
      return `Internet - ${canonicalFinancialUnit(requiredText(params.unit, "Unidade"))} | ${requiredText(params.beneficiary, "Favorecido")}`;
    case "mobile_phone_bill":
      return `Conta de celular - ${displayFinancialMonth(requiredText(params.competence, "Competência"))} | ${requiredText(params.beneficiary, "Favorecido")}`;
    case "hr_system":
      return "Sistema RH - Bizneo";
    case "dental_plan":
      return `Plano odontológico - Odontoprev | ${requiredText(params.linkedPerson, "Vinculado")}`;
    case "rent":
      return `Aluguel - ${canonicalFinancialUnit(requiredText(params.unit, "Unidade"))} | ${requiredText(params.beneficiary, "Favorecido")}`;
    case "accounting_fee":
      return `Honorário contábil - ${canonicalFinancialUnit(requiredText(params.unit, "Unidade"))} | ${requiredText(params.beneficiary, "Favorecido")}`;
    case "das":
      return `DAS - Única - ${displayFinancialMonth(requiredText(params.competence, "Competência"))}`;
    case "salary":
      return `Salário - ${displayFinancialMonth(requiredText(params.competence, "Competência"))} | ${requiredText(params.employee, "Colaborador")}`;
    case "payroll_loan":
      return `Empréstimo consignado - ${displayFinancialMonth(requiredText(params.competence, "Competência"))} | ${requiredText(params.employee, "Colaborador")}`;
    case "fgts":
      return `FGTS - ${displayFinancialMonth(requiredText(params.competence, "Competência"))} | ${params.hasPayrollLoan === false ? "FGTS" : "FGTS + empréstimo consignado"}`;
    case "inss":
      return `INSS - ${displayFinancialMonth(requiredText(params.competence, "Competência"))} | Folha de pagamento`;
    case "shopping_cart":
      return "Compra do carrinho - Shopping do Automóvel";
    case "gpt_codex":
      return `GPT/Codex | ${requiredText(params.beneficiary, "Favorecido")}`;
    case "digital_signage":
      return `Publicidade digital - Signage | ${requiredText(params.beneficiary, "Favorecido")}`;
    case "pdv_system":
      return `Sistema PDV - ${canonicalFinancialUnit(requiredText(params.unit, "Unidade"))} | ${requiredText(params.beneficiary, "Favorecido")}`;
    case "pdv_implementation":
      return `Implantação do Sistema PDV - ${canonicalFinancialUnit(requiredText(params.unit, "Unidade"))} | ${requiredText(params.beneficiary, "Favorecido")}`;
    case "ride_hailing":
      return `Corrida por aplicativo - ${displayFinancialDate(requiredText(params.transactionDate, "Data"))} | ${requiredText(params.beneficiary, "Favorecido")} - ${requiredText(params.passenger, "Passageiro")}`;
    case "card_revolving_charge":
      return `Encargos do crédito rotativo - ${displayFinancialMonth(requiredText(params.competence, "Competência"))} | ${canonicalFinancialInstitution(requiredText(params.financialInstitution, "Instituição financeira"))}`;
    case "card_financed_balance_charge":
      return `Encargos do saldo financiado - ${displayFinancialMonth(requiredText(params.competence, "Competência"))} | ${canonicalFinancialInstitution(requiredText(params.financialInstitution, "Instituição financeira"))}`;
    case "card_iof":
      return `IOF do cartão - ${displayFinancialMonth(requiredText(params.competence, "Competência"))} | ${canonicalFinancialInstitution(requiredText(params.financialInstitution, "Instituição financeira"))}`;
    case "card_late_interest":
      return `Juros de mora do cartão - ${displayFinancialMonth(requiredText(params.competence, "Competência"))} | ${canonicalFinancialInstitution(requiredText(params.financialInstitution, "Instituição financeira"))}`;
    case "card_late_fee":
      return `Multa por atraso do cartão - ${displayFinancialMonth(requiredText(params.competence, "Competência"))} | ${canonicalFinancialInstitution(requiredText(params.financialInstitution, "Instituição financeira"))}`;
  }
}

function comparableText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

export function identifyCardStatementFinancialCharge(rawDescription: string): CardStatementFinancialChargeKind | null {
  const description = comparableText(rawDescription);
  if (/\brotativo saldo financia(?:do)?\b/.test(description)) return "card_financed_balance_charge";
  if (/\bencargos? rotativo\b/.test(description)) return "card_revolving_charge";
  if (/\bjuros? de mora\b/.test(description)) return "card_late_interest";
  if (/\bmulta por atraso\b/.test(description)) return "card_late_fee";
  if (/\biof\b/.test(description)) return "card_iof";
  return null;
}

export function resolveCardStatementFinancialCharge(params: {
  rawDescription: string;
  competence: string;
  financialInstitution: string;
}) {
  const kind = identifyCardStatementFinancialCharge(params.rawDescription);
  if (!kind) return null;
  const supplier = canonicalFinancialInstitution(params.financialInstitution);
  return {
    kind,
    description: buildFinancialDescription(kind, {
      competence: params.competence,
      financialInstitution: supplier,
    }),
    supplier,
    rawBankDescription: requiredText(params.rawDescription, "Descrição original"),
    accountPlanName: kind === "card_iof" ? "IOF | tarifas bancárias" : "Juros e multas",
  };
}
