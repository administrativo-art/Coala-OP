import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  computeBatchCounters,
  deriveBatchStatus,
  canFileItem,
  type UploadItemStatus,
} from "../../../src/lib/hr/employee-document-batch";

function items(...statuses: UploadItemStatus[]) {
  return statuses.map((status) => ({ status }));
}

describe("computeBatchCounters", () => {
  test("conta por categoria", () => {
    const c = computeBatchCounters(items("ready", "ready", "review", "filed", "failed", "blocked"));
    assert.equal(c.totalFiles, 6);
    assert.equal(c.readyFiles, 2);
    assert.equal(c.pendingFiles, 2); // review + blocked
    assert.equal(c.filedFiles, 1);
    assert.equal(c.failedFiles, 1);
    assert.equal(c.analyzedFiles, 6);
  });

  test("itens em análise reduzem analyzedFiles", () => {
    const c = computeBatchCounters(items("analyzing", "ready"));
    assert.equal(c.analyzedFiles, 1);
  });
});

describe("deriveBatchStatus", () => {
  test("ainda analisando", () => {
    assert.equal(deriveBatchStatus(computeBatchCounters(items("analyzing", "ready"))), "ANALYZING");
  });
  test("aguardando revisão", () => {
    assert.equal(deriveBatchStatus(computeBatchCounters(items("ready", "review"))), "AWAITING_REVIEW");
  });
  test("parcialmente arquivado", () => {
    assert.equal(deriveBatchStatus(computeBatchCounters(items("filed", "review"))), "PARTIALLY_FILED");
  });
  test("totalmente arquivado", () => {
    assert.equal(deriveBatchStatus(computeBatchCounters(items("filed", "filed"))), "FILED");
  });
  test("tudo falhou", () => {
    assert.equal(deriveBatchStatus(computeBatchCounters(items("failed", "failed"))), "FAILED");
  });
});

describe("canFileItem (idempotência)", () => {
  test("só arquiva 'ready'", () => {
    assert.equal(canFileItem({ status: "ready" }), true);
    assert.equal(canFileItem({ status: "filed" }), false);
    assert.equal(canFileItem({ status: "filing" }), false);
    assert.equal(canFileItem({ status: "review" }), false);
  });
});
