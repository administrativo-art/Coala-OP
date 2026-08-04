import assert from "node:assert/strict";
import test from "node:test";

import {
  addBusinessDays,
  buildInterCobrancaIssueInput,
  deterministicSeuNumero,
  mapInterSituation,
  parseInterMoneyToCents,
} from "../../src/features/financial/cash-deposits/inter-cobranca";
import type { CashDepositBatch } from "../../src/features/financial/cash-deposits/types";
import { interCobrancaPayerFromCompany } from "../../src/features/financial/cash-deposits/payer";
import type { NormalizedCompanyData } from "../../src/lib/company/company-lookup-types";

function batch(totalCents = 250): CashDepositBatch {
  return {
    id: "coala_tirirical_000001",
    workspaceId: "coala",
    kioskId: "tirirical",
    kioskName: "Tirirical",
    sequence: 1,
    status: "locked",
    maxCents: 500_000,
    totalCents,
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

test("D+2 útil pula fim de semana e feriado configurado", () => {
  assert.equal(addBusinessDays("2026-08-07", 2), "2026-08-11");
  assert.equal(addBusinessDays("2026-08-07", 2, ["2026-08-10"]), "2026-08-12");
});

test("valor mínimo de 250 centavos é aceito e convertido sem drift", () => {
  const input = buildInterCobrancaIssueInput({
    batch: batch(250),
    attempt: 1,
    payer,
    dueBusinessDays: 2,
    numDiasAgenda: 30,
    today: "2026-08-03",
  });
  assert.equal(input.valorNominal, 2.5);
  assert.equal(input.dataVencimento, "2026-08-05");
  assert.equal(parseInterMoneyToCents("2.5"), 250);
});

test("valor abaixo do mínimo não é emitido", () => {
  assert.throws(() => buildInterCobrancaIssueInput({
    batch: batch(249),
    attempt: 1,
    payer,
    dueBusinessDays: 2,
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
