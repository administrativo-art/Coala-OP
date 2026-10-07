import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../../../scripts/financial/coala-authenticated-payment.mts", import.meta.url));
const order = {
  id: "request_demo_123", sourceType: "expense_boleto", sourceId: "expense_demo_123",
  expenseId: "expense_demo_123", paymentRail: "barcode", amount: 50,
  barcodeSnapshot: { code: "1".repeat(47), scheduledFor: "2026-10-10", beneficiaryDocument: "12345678000195" },
};
const inboxMessage = {
  id: "inbox_demo_123", status: "linked", linkedExpenseId: "expense_demo_123", paymentRequestId: null,
  classification: { amountCents: 3999, dueDate: "2026-10-10", barcode: "8".repeat(48) },
  existingBankPayment: null, existingSettlement: null,
};
const preparedOrder = {
  id: "inbox_inbox_demo_123", sourceType: "financial_inbox", sourceId: inboxMessage.id,
  expenseId: inboxMessage.linkedExpenseId, paymentRail: "barcode", amount: 39.99,
  barcodeSnapshot: { code: inboxMessage.classification.barcode, dueDate: inboxMessage.classification.dueDate,
    scheduledFor: "2026-10-10", beneficiaryDocument: "11222333000181" },
  status: "awaiting_financial_authorization",
};

// Run the real command dispatcher in a child with all network and Keychain calls replaced.
// No Swift process, credentials, emulator, browser or real API can be reached.
function runFixture(input: { action: "authorize" | "send" | "retry-send"; state: string; outcome?: string; amount?: string; started?: boolean; errorCode?: string; attemptCount?: number; posts: number }) {
  const args = [input.action, "--email", "demo@example.invalid", "--id", order.id,
    "--amount-cents", input.amount ?? "5000", "--scheduled-for", order.barcodeSnapshot.scheduledFor,
    "--beneficiary-document", order.barcodeSnapshot.beneficiaryDocument,
    "--expense-id", order.expenseId, "--barcode", order.barcodeSnapshot.code];
  const source = `
    import assert from 'node:assert/strict';
    import childProcess from 'node:child_process';
    import {syncBuiltinESMExports} from 'node:module';
    import {pathToFileURL} from 'node:url';
    const scenario = ${JSON.stringify(input)};
    const order = ${JSON.stringify(order)};
    let posts = 0, reads = 0;
    childProcess.spawnSync = (bin, args) => {
      assert.equal(bin, '/usr/bin/swift');
      assert.equal(args.at(-2), 'read');
      assert.equal(args.at(-1), 'demo@example.invalid');
      reads++;
      return {status:0, stdout:'REFRESH_FICTICIO', stderr:''};
    };
    syncBuiltinESMExports();
    globalThis.fetch = async (url, init) => {
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal instanceof AbortSignal);
      const target = new URL(url);
      if (target.hostname === 'securetoken.googleapis.com') {
        return Response.json({id_token:'ID_TOKEN_FICTICIO', refresh_token:'REFRESH_FICTICIO', user_id:'demo'});
      }
      if (target.hostname === 'identitytoolkit.googleapis.com' && target.pathname.endsWith('/accounts:lookup')) {
        return Response.json({users:[{email:'demo@example.invalid'}]});
      }
      assert.equal(target.hostname, 'op.coalashakes.com');
      assert.equal(init.headers.Authorization, 'Bearer ID_TOKEN_FICTICIO');
      if (target.pathname === '/api/financial/payment-requests' && !init.method) {
        return Response.json({requests:[{...order, status:scenario.state,
          ...(scenario.started ? {submissionStartedAt:'2026-09-27T00:00:00Z'} : {}),
          ...(scenario.errorCode ? {lastError:{code:scenario.errorCode}} : {}),
          ...(scenario.attemptCount == null ? {} : {submissionAttemptCount:scenario.attemptCount})}]});
      }
      assert.equal(init.method, 'POST');
      assert.equal(target.pathname, '/api/financial/payment-requests/' + order.id + '/' + (scenario.action === 'authorize' ? 'authorize' : 'submit'));
      posts++;
      if (scenario.outcome === 'timeout') throw new Error('SEGREDO_FICTICIO: falha após envio');
      if (scenario.outcome === 'http500') return new Response('SEGREDO_FICTICIO', {status:500});
      if (scenario.outcome === 'invalid-json') return new Response('SEGREDO_FICTICIO');
      return Response.json({request:{...order,
        id:scenario.outcome === 'wrong-id' ? 'wrong_order' : order.id,
        status:scenario.action === 'authorize' ? 'ready_to_submit' : 'awaiting_bank_approval',
        ...(scenario.action !== 'authorize' ? {interRequestId:'inter_demo', bankStatus:'AGUARDANDO_APROVACAO'} : {})}});
    };
    process.on('exit', () => {
      assert.equal(posts, scenario.posts, 'quantidade exata de escritas');
      assert.equal(reads, 1, 'somente helper simulado');
    });
    process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}];
    await import(pathToFileURL(${JSON.stringify(cli)}).href);
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
    encoding: "utf8", timeout: 15_000,
  });
  assert.equal(result.error, undefined);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /REFRESH_FICTICIO|ID_TOKEN_FICTICIO|SEGREDO_FICTICIO/);
  return result;
}

function runPreparationFixture(input: { mismatch?: "amount" | "existing"; outcome?: "timeout" | "wrong-document"; posts: number }) {
  const args = ["prepare", "--email", "demo@example.invalid", "--id", inboxMessage.id,
    "--amount-cents", "3999", "--scheduled-for", preparedOrder.barcodeSnapshot.scheduledFor,
    "--beneficiary-document", preparedOrder.barcodeSnapshot.beneficiaryDocument,
    "--expense-id", preparedOrder.expenseId, "--barcode", preparedOrder.barcodeSnapshot.code];
  const source = `
    import assert from 'node:assert/strict';
    import childProcess from 'node:child_process';
    import {syncBuiltinESMExports} from 'node:module';
    import {pathToFileURL} from 'node:url';
    const scenario = ${JSON.stringify(input)};
    const message = ${JSON.stringify(inboxMessage)};
    const prepared = ${JSON.stringify(preparedOrder)};
    let posts = 0, reads = 0;
    childProcess.spawnSync = (bin, args) => {
      assert.equal(bin, '/usr/bin/swift');
      assert.equal(args.at(-2), 'read');
      reads++;
      return {status:0, stdout:'REFRESH_FICTICIO', stderr:''};
    };
    syncBuiltinESMExports();
    globalThis.fetch = async (url, init) => {
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal instanceof AbortSignal);
      const target = new URL(url);
      if (target.hostname === 'securetoken.googleapis.com') return Response.json({id_token:'ID_TOKEN_FICTICIO', refresh_token:'REFRESH_FICTICIO', user_id:'demo'});
      if (target.hostname === 'identitytoolkit.googleapis.com') return Response.json({users:[{email:'demo@example.invalid'}]});
      assert.equal(target.hostname, 'op.coalashakes.com');
      if (target.pathname === '/api/financial/inbox/' + message.id && !init.method) {
        return Response.json({message:{...message,
          ...(scenario.mismatch === 'existing' ? {paymentRequestId:'request_existing'} : {}),
          classification:{...message.classification, ...(scenario.mismatch === 'amount' ? {amountCents:4000} : {})}}});
      }
      assert.equal(target.pathname, '/api/financial/inbox/' + message.id + '/payment');
      assert.equal(init.method, 'POST');
      posts++;
      if (scenario.outcome === 'timeout') throw new Error('SEGREDO_FICTICIO');
      return Response.json({request:{...prepared,
        barcodeSnapshot:{...prepared.barcodeSnapshot,
          ...(scenario.outcome === 'wrong-document' ? {beneficiaryDocument:'64433090000197'} : {})}}});
    };
    process.on('exit', () => {
      assert.equal(posts, scenario.posts, 'quantidade exata de preparações');
      assert.equal(reads, 1, 'somente helper simulado');
    });
    process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}];
    await import(pathToFileURL(${JSON.stringify(cli)}).href);
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
    encoding: "utf8", timeout: 15_000,
  });
  assert.equal(result.error, undefined);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /REFRESH_FICTICIO|ID_TOKEN_FICTICIO|SEGREDO_FICTICIO/);
  return result;
}

test("dispatcher prepara a cobrança somente após o preflight completo", () => {
  const result = runPreparationFixture({ posts: 1 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "awaiting_financial_authorization");
  for (const mismatch of ["amount", "existing"] as const) {
    const blocked = runPreparationFixture({ mismatch, posts: 0 });
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /Nenhuma ação foi feita/);
  }
});

test("dispatcher não repete preparação incerta ou com snapshot divergente", () => {
  for (const outcome of ["timeout", "wrong-document"] as const) {
    const result = runPreparationFixture({ outcome, posts: 1 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /[Cc]onsulte/);
  }
});

test("dispatcher autoriza e envia em etapas separadas sem Chaves ou rede reais", () => {
  const authorization = runFixture({ action: "authorize", state: "awaiting_financial_authorization", posts: 1 });
  assert.equal(authorization.status, 0, authorization.stderr);
  assert.equal(JSON.parse(authorization.stdout).status, "ready_to_submit");
  const submission = runFixture({ action: "send", state: "ready_to_submit", posts: 1 });
  assert.equal(submission.status, 0, submission.stderr);
  assert.equal(JSON.parse(submission.stdout).status, "awaiting_bank_approval");
});

test("dispatcher impede escrita para ordem divergente ou tentativa anterior", () => {
  for (const scenario of [
    { state: "ready_to_submit", amount: "5001" },
    { state: "ready_to_submit", started: true },
    { state: "failed" },
  ]) {
    const result = runFixture({ action: "send", ...scenario, posts: 0 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Nenhuma ação foi feita/);
  }
});

test("dispatcher retoma somente a primeira rejeição HTTP 400 confirmada", () => {
  const retry = runFixture({
    action: "retry-send", state: "failed", started: true, errorCode: "INTER_HTTP_400", posts: 1,
  });
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(JSON.parse(retry.stdout).status, "awaiting_bank_approval");

  const blocked = runFixture({
    action: "retry-send", state: "failed", started: true, errorCode: "INTER_HTTP_400", attemptCount: 2, posts: 0,
  });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /Nenhuma ação foi feita/);
});

test("dispatcher nunca repete envio incerto nem expõe a resposta bruta", () => {
  for (const outcome of ["timeout", "http500", "invalid-json", "wrong-id"]) {
    const result = runFixture({ action: "send", state: "ready_to_submit", outcome, posts: 1 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /[Cc]onsulte o status/);
  }
});
