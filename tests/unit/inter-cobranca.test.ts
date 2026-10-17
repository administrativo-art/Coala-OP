import assert from "node:assert/strict";
import test from "node:test";

import {
  addBusinessDays,
  buildInterCobrancaIssueInput,
  deterministicSeuNumero,
  INTER_COBRANCA_DUE_BUSINESS_DAYS,
  mapInterSituation,
  parseInterMoneyToCents,
} from "../../src/features/financial/cash-deposits/inter-cobranca";
import { issueCashDepositSchema } from "../../src/features/financial/cash-deposits/schemas";
import type { CashDepositBatch } from "../../src/features/financial/cash-deposits/types";
import {
  INTER_COBRANCA_PAYER_MAX_LENGTHS,
  interCobrancaPayerFromCompany,
} from "../../src/features/financial/cash-deposits/payer";
import type { NormalizedCompanyData } from "../../src/lib/company/company-lookup-types";
import {
  classifyInterCobrancaApiError,
  InterCobrancaApiError,
} from "../../src/lib/integrations/inter/cobranca-error";

function batch(totalCents = 250): CashDepositBatch {
  return {
    id: "coala_tirirical_000001",
    workspaceId: "coala",
    kioskId: "tirirical",
    kioskName: "Tirirical",
    sequence: 1,
    status: "locked",
    maxCents: 500_000,
    grossTotalCents: totalCents,
    totalCents,
    coinHoldCents: 0,
    coinPreparedAt: "2026-08-02T12:00:00.000Z",
    coinPreparedBy: "user-1",
    remainingCapacityCents: 500_000 - totalCents,
    periodStartDate: "2026-08-01",
    periodEndDate: "2026-08-02",
    closureIds: ["tirirical_2026-08-02"],
    dates: ["2026-08-02"],
    itemCount: 1,
    lockReason: "manual_issue_requested",
    nextRejectedClosureId: null,
    nextRejectedCents: null,
    bankProvider: null,
    interCobrancaId: null,
    interCobrancaIds: [],
    bankWarning: null,
    lastBankSyncAt: null,
    ledgerTransactionId: null,
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z",
    issuedAt: null,
    issuedBy: null,
    paidAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
  };
}

const payer = {
  cpfCnpj: "01123456789",
  tipoPessoa: "FISICA" as const,
  nome: "Pagador",
  endereco: "Avenida Brasil",
  numero: "1200",
  bairro: "Centro",
  cidade: "Belo Horizonte",
  uf: "MG",
  cep: "30110000",
};

test("resolve o pagador institucional pelo cadastro canônico da entidade", () => {
  const company: NormalizedCompanyData = {
    id: "ct-sorvetes",
    cnpj: "14276603000125",
    razao_social: "C T SORVETES LTDA",
    nome_fantasia: "C T Sorvetes",
    situacao_cadastral: "ATIVA",
    data_abertura: "",
    natureza_juridica: "",
    cnae_principal_codigo: "",
    cnae_principal_descricao: "",
    cnaes_secundarios: [],
    inscricao_estadual: "",
    contribuinte_icms: "nao_informado",
    situacao_inscricao_estadual: "nao_consultada",
    cep: "65075440",
    logradouro: "Avenida Coronel Colares Moreira",
    numero: "1",
    complemento: "QD 121 1 ANDAR EDIFICIO ADRIANA",
    bairro: "Jardim Renascença",
    cidade: "São Luís",
    uf: "MA",
    telefone: "",
    email: "",
    tipo_empresa: "",
    origem_dados: "internal",
    data_ultima_consulta: "",
    observacoes: "",
  };
  const resolved = interCobrancaPayerFromCompany(company);
  assert.equal(resolved.cpfCnpj, "14276603000125");
  assert.equal(resolved.tipoPessoa, "JURIDICA");
  assert.equal(resolved.nome, "C T SORVETES LTDA");
  assert.equal(resolved.cep, "65075440");
  assert.equal(resolved.complemento, company.complemento.slice(0, INTER_COBRANCA_PAYER_MAX_LENGTHS.complemento));
  assert.equal(resolved.complemento?.length, 30);
});

test("pagador respeita os limites da Cobrança Inter V3 antes da chamada externa", () => {
  const company: NormalizedCompanyData = {
    id: "long-company",
    cnpj: "14276603000125",
    razao_social: "N".repeat(110),
    nome_fantasia: "",
    situacao_cadastral: "ATIVA",
    data_abertura: "",
    natureza_juridica: "",
    cnae_principal_codigo: "",
    cnae_principal_descricao: "",
    cnaes_secundarios: [],
    inscricao_estadual: "",
    contribuinte_icms: "nao_informado",
    situacao_inscricao_estadual: "nao_consultada",
    cep: "65075440",
    logradouro: "L".repeat(110),
    numero: "123456789012",
    complemento: "C".repeat(31),
    bairro: "B".repeat(70),
    cidade: "M".repeat(70),
    uf: "MA",
    telefone: "",
    email: `${"e".repeat(45)}@example.com`,
    tipo_empresa: "",
    origem_dados: "internal",
    data_ultima_consulta: "",
    observacoes: "",
  };

  const resolved = interCobrancaPayerFromCompany(company);
  assert.equal(resolved.nome.length, INTER_COBRANCA_PAYER_MAX_LENGTHS.nome);
  assert.equal(resolved.endereco.length, INTER_COBRANCA_PAYER_MAX_LENGTHS.endereco);
  assert.equal(resolved.numero.length, INTER_COBRANCA_PAYER_MAX_LENGTHS.numero);
  assert.equal(resolved.bairro.length, INTER_COBRANCA_PAYER_MAX_LENGTHS.bairro);
  assert.equal(resolved.cidade.length, INTER_COBRANCA_PAYER_MAX_LENGTHS.cidade);
  assert.equal(resolved.complemento?.length, INTER_COBRANCA_PAYER_MAX_LENGTHS.complemento);
  assert.equal(resolved.email, undefined);
});

test("recusas determinísticas do Inter são classificadas sem propagar o corpo bancário", () => {
  assert.equal(classifyInterCobrancaApiError(new InterCobrancaApiError("sanitizado", 400)), "invalid-request");
  assert.equal(classifyInterCobrancaApiError(new InterCobrancaApiError("sanitizado", 422)), "invalid-request");
  assert.equal(classifyInterCobrancaApiError(new InterCobrancaApiError("sanitizado", 403)), "authorization");
  assert.equal(classifyInterCobrancaApiError(new InterCobrancaApiError("sanitizado", 500)), null);
  assert.equal(classifyInterCobrancaApiError(new Error("erro local")), null);
});

test("seuNumero é determinístico, único por tentativa e respeita 15 caracteres", () => {
  const first = deterministicSeuNumero({ kioskId: "joao-paulo", periodEndDate: "2026-08-02", batchSequence: 12, attempt: 1 });
  const same = deterministicSeuNumero({ kioskId: "joao-paulo", periodEndDate: "2026-08-02", batchSequence: 12, attempt: 1 });
  const retry = deterministicSeuNumero({ kioskId: "joao-paulo", periodEndDate: "2026-08-02", batchSequence: 12, attempt: 2 });
  assert.equal(first, same);
  assert.equal(first.length, 15);
  assert.notEqual(first, retry);
});

test("unidades com nomes iniciados por Quiosque recebem referências bancárias distintas", () => {
  const joaoPaulo = deterministicSeuNumero({ kioskId: "joao-paulo", periodEndDate: "2026-08-03", batchSequence: 1, attempt: 1 });
  const tirirical = deterministicSeuNumero({ kioskId: "tirirical", periodEndDate: "2026-08-03", batchSequence: 1, attempt: 1 });

  assert.match(joaoPaulo, /^CXJPA/);
  assert.match(tirirical, /^CXTRI/);
  assert.notEqual(joaoPaulo, tirirical);
});

test("dias úteis pulam fim de semana e feriado configurado", () => {
  assert.equal(addBusinessDays("2026-08-07", 2), "2026-08-11");
  assert.equal(addBusinessDays("2026-08-07", 2, ["2026-08-10"]), "2026-08-12");
});

test("valor mínimo é aceito e a cobrança recebe vencimento padrão em D+7 útil", () => {
  const input = buildInterCobrancaIssueInput({
    batch: batch(250),
    attempt: 1,
    payer,
    numDiasAgenda: 30,
    today: "2026-08-03",
  });
  assert.equal(input.valorNominal, 2.5);
  assert.equal(INTER_COBRANCA_DUE_BUSINESS_DAYS, 7);
  assert.equal(input.dataVencimento, "2026-08-12");
  assert.equal(parseInterMoneyToCents("2.5"), 250);
});

test("D+7 útil respeita fim de semana e feriado configurado", () => {
  const input = buildInterCobrancaIssueInput({
    batch: batch(500_000),
    attempt: 1,
    payer,
    numDiasAgenda: 30,
    holidays: ["2026-08-10"],
    today: "2026-08-07",
  });
  assert.equal(input.dataVencimento, "2026-08-19");
});

test("uma data personalizada substitui D+7 sem alterar os demais dados da cobrança", () => {
  const input = buildInterCobrancaIssueInput({
    batch: batch(250),
    attempt: 1,
    payer,
    dueDate: "2026-08-20",
    numDiasAgenda: 30,
    today: "2026-08-03",
  });
  assert.equal(input.dataVencimento, "2026-08-20");
  assert.equal(input.valorNominal, 2.5);
});

test("a API aceita apenas data personalizada no formato canônico", () => {
  assert.equal(issueCashDepositSchema.safeParse({}).success, true);
  assert.equal(issueCashDepositSchema.safeParse({ dueDate: "2026-08-06" }).success, true);
  assert.equal(issueCashDepositSchema.safeParse({ dueBusinessDays: 1 }).success, false);
  assert.equal(issueCashDepositSchema.safeParse({ dueDate: "06/08/2026" }).success, false);
});

test("vencimento personalizado deve ficar entre hoje e os próximos 60 dias", () => {
  assert.throws(() => buildInterCobrancaIssueInput({
    batch: batch(250),
    attempt: 1,
    payer,
    dueDate: "2026-08-02",
    numDiasAgenda: 30,
    today: "2026-08-03",
  }), /entre hoje e os próximos 60 dias/i);
  assert.throws(() => buildInterCobrancaIssueInput({
    batch: batch(250),
    attempt: 1,
    payer,
    dueDate: "2026-10-03",
    numDiasAgenda: 30,
    today: "2026-08-03",
  }), /entre hoje e os próximos 60 dias/i);
});

test("valor abaixo do mínimo não é emitido", () => {
  assert.throws(() => buildInterCobrancaIssueInput({
    batch: batch(249),
    attempt: 1,
    payer,
    numDiasAgenda: 30,
    today: "2026-08-03",
  }), /valor mínimo/i);
});

test("situações bancárias nunca confundem marcação manual com liquidação", () => {
  assert.equal(mapInterSituation("RECEBIDO").closureDepositStatus, "paid");
  const manual = mapInterSituation("MARCADO_RECEBIDO");
  assert.equal(manual.status, "marked_received");
  assert.equal(manual.batchStatus, "issued");
  assert.equal(manual.closureDepositStatus, "issued");
  assert.match(manual.warning ?? "", /manualmente/i);
});

test("situação desconhecida é preservada como pendente e nunca causa baixa", () => {
  const result = mapInterSituation("STATUS_NOVO_DO_BANCO");
  assert.equal(result.status, "requested");
  assert.equal(result.batchStatus, null);
  assert.equal(result.closureDepositStatus, null);
});
