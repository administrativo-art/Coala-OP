import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/lib/observability/app-error";
import { requestStonePixFile } from "../../src/lib/integrations/stone/pix-request-transport";
import {
  stonePixRequestDates,
  syncStonePixRequests,
  type StonePixRequestRepository,
  type StonePixReservation,
} from "../../src/features/financial/sales-reconciliation/pix-request";

test("seleciona somente dias publicados e limita o reprocessamento a 35 datas", () => {
  assert.deepEqual(stonePixRequestDates(new Date("2026-10-01T12:00:00Z"), "2026-09-20"), [
    "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24",
    "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29",
    "2026-09-30",
  ]);
  assert.deepEqual(stonePixRequestDates(new Date("2026-10-01T12:00:00Z"), "2026-01-01", 3), [
    "2026-09-28", "2026-09-29", "2026-09-30",
  ]);
  assert.deepEqual(stonePixRequestDates(new Date("2026-10-01T02:00:00Z"), "2026-09-29"), [
    "2026-09-29",
  ]);
});

test("solicita somente reservas novas e registra aceites", async () => {
  const reservations: StonePixReservation[] = [
    { status: "processed" }, { status: "waiting" },
    { status: "reserved", leaseId: "lease-1", attempt: 1 },
  ];
  const accepted: string[] = [];
  const repository: StonePixRequestRepository = {
    reserve: async () => reservations.shift()!,
    accepted: async input => { accepted.push(`${input.referenceDate}:${input.status}`); },
    failed: async () => { assert.fail("não deveria falhar"); },
  };
  const result = await syncStonePixRequests({
    document: "12345678000199", startDate: "2026-09-28",
    now: new Date("2026-10-01T12:00:00Z"), repository,
    requestFile: async () => ({ status: 202 }),
  });
  assert.deepEqual(result, { considered: 3, requested: 1, waiting: 1, processed: 1, failed: 0 });
  assert.deepEqual(accepted, ["2026-09-30:202"]);
});

test("falha de um dia não impede os demais e permanece observável", async () => {
  const failed: string[] = [];
  const repository: StonePixRequestRepository = {
    reserve: async input => ({ status: "reserved", leaseId: input.referenceDate, attempt: 1 }),
    accepted: async () => undefined,
    failed: async input => { failed.push(`${input.referenceDate}:${input.errorCode}`); },
  };
  let calls = 0;
  await assert.rejects(syncStonePixRequests({
    document: "12345678000199", startDate: "2026-09-29",
    now: new Date("2026-10-01T12:00:00Z"), repository,
    requestFile: async () => {
      calls += 1;
      if (calls === 1) throw new AppError({ code: "STONE_PIX_TEST_FAILURE", kind: "TRANSIENT_EXTERNAL" });
      return { status: 202 };
    },
  }), { code: "STONE_PIX_SYNC_PARTIAL_FAILURE" });
  assert.equal(calls, 2);
  assert.deepEqual(failed, ["2026-09-29:STONE_PIX_TEST_FAILURE"]);
});

test("transporte Pix usa Basic Auth, contrato V2 e não lê o corpo", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const result = await requestStonePixFile({
    document: "12345678000199", referenceDate: "2026-09-30",
  }, {
    apiKey: "test-api-key",
    fetcher: async (url, init) => {
      requestedUrl = String(url);
      requestedInit = init;
      return new Response(null, { status: 202 });
    },
  });
  assert.equal(result.status, 202);
  assert.equal(requestedUrl,
    "https://conciliation.stone.com.br/v2/merchant/12345678000199/conciliation-file/pix/2026-09-30");
  assert.equal(requestedInit?.method, "POST");
  const headers = new Headers(requestedInit?.headers);
  assert.equal(headers.get("x-user-type"), "client");
  assert.equal(headers.get("authorization"), `Basic ${Buffer.from("test-api-key:").toString("base64")}`);
});

test("transporte Pix rejeita credencial, data e respostas externas inválidas", async () => {
  await assert.rejects(requestStonePixFile({ document: "12345678000199", referenceDate: "2026-02-31" }, {
    apiKey: "test",
  }), { code: "STONE_PIX_REQUEST_INVALID_INPUT" });
  await assert.rejects(requestStonePixFile({ document: "12345678000199", referenceDate: "2026-09-30" }, {
    apiKey: "bad:key",
  }), { code: "STONE_PIX_REQUEST_NOT_CONFIGURED" });
  await assert.rejects(requestStonePixFile({ document: "12345678000199", referenceDate: "2026-09-30" }, {
    apiKey: "test",
    fetcher: async () => new Response(null, { status: 401 }),
  }), { code: "STONE_PIX_REQUEST_CREDENTIAL_REJECTED" });
});
