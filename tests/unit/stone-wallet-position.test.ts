import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../src/lib/observability/app-error";
import { MAX_STONE_WALLETS, parseStoneWalletPosition } from "../../src/lib/integrations/stone/wallet-position-parser";
import { STONE_AGENDA_MAX_BYTES } from "../../src/lib/integrations/stone/agenda-transport";
import { queryStoneWalletPosition } from "../../src/features/financial/receivables/wallet-position";

const scope = { stoneCode: "123", referenceDate: "2026-09-20" };
const wallet = (nature = "1", amount = "123.456789012345", category = "Sale", type = "3") =>
  `<Wallet><WalletTypeId>${type}</WalletTypeId><WalletNatureId>${nature}</WalletNatureId><Category>${category}</Category><Amount>${amount}</Amount></Wallet>`;
const position = (rows = wallet()) => `<WalletPosition><Wallets>${rows}</Wallets></WalletPosition>`;
const file = (section = position()) => `<Conciliation><Header><StoneCode>000123</StoneCode><ReferenceDate>20260920</ReferenceDate><LayoutVersion>2.4</LayoutVersion><FileId>fixture-file</FileId><GenerationDateTime>20260921060000</GenerationDateTime></Header>${section}<Payments><Payment><FavoredBankAccount>private-bank-data</FavoredBankAccount></Payment></Payments></Conciliation>`;
const code = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof AppError);
  assert.equal(error.code, expected);
  assert.equal(error.cause, undefined);
  assert.deepEqual(error.metadata, {});
  return true;
};
const invalid = code("STONE_WALLET_INVALID_FILE");

test("wallet position preserves exact decimals and signed categories without exposing bank data", () => {
  const result = parseStoneWalletPosition(file(position(wallet() + wallet("1", "-10.01", "Other"))), scope);
  assert.equal(result.layout, "2.4");
  assert.equal(result.status, "reported");
  assert.equal(result.rows[0].amount, "123.456789012345");
  assert.equal(result.rows[1].amount, "-10.01");
  assert.equal(result.stoneCode, "000123");
  assert.match(result.sourceHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(result), /private-bank-data|FavoredBankAccount|<Conciliation/);
  assert.equal(result.availableBalance, null);
  assert.equal(result.portfolioBalanceConfirmed, false);
  assert.equal(result.bankReceiptConfirmed, false);
  assert.equal(result.writesPerformed, false);
});

test("regular, guarantees, assignments and Stone anticipations remain separate", () => {
  const result = parseStoneWalletPosition(file(position(["1", "5", "7", "8", "9"].map(n => wallet(n)).join(""))), scope);
  assert.deepEqual(result.rows.map(row => row.nature), ["regular", "warranty", "ownership_assignment", "stone_anticipation", "unknown"]);
  assert.equal(result.unknownNatureCount, 1);
  assert.equal("total" in result, false);
  assert.equal(result.portfolioBalanceConfirmed, false);
});

test("missing and empty sections are distinct, and neither proves zero portfolio", () => {
  for (const [section, status] of [["", "not_provided"], ["<WalletPosition/>", "empty"],
    ["<WalletPosition><Wallets/></WalletPosition>", "empty"]]) {
    const result = parseStoneWalletPosition(file(section), scope);
    assert.equal(result.status, status);
    assert.deepEqual(result.rows, []);
    assert.equal(result.availableBalance, null);
    assert.equal(result.portfolioBalanceConfirmed, false);
  }
  const zero = parseStoneWalletPosition(file(position(wallet("1", "0.00"))), scope);
  assert.equal(zero.status, "reported");
  assert.equal(zero.rows[0].amount, "0.00");
  assert.equal(zero.portfolioBalanceConfirmed, false);
});

test("wallet reader enforces merchant, calendar date, generation timestamp and layout", () => {
  for (const [from, to] of [["2.4", "2.2"], ["20260920", "20260230"], ["20260921060000", "20260921250000"]]) {
    assert.throws(() => parseStoneWalletPosition(file().replace(from, to), scope), invalid);
  }
  assert.throws(() => parseStoneWalletPosition(file(), { ...scope, stoneCode: "999" }), code("STONE_WALLET_SCOPE_MISMATCH"));
  assert.throws(() => parseStoneWalletPosition(file(), { ...scope, referenceDate: "2026-09-19" }), code("STONE_WALLET_SCOPE_MISMATCH"));
  assert.throws(() => parseStoneWalletPosition(file().replace("<FileId>fixture-file</FileId>", ""), scope), invalid);
});

test("malformed wallets and unsafe numeric representations do not become empty data", () => {
  for (const section of ["<WalletPosition><Unknown/></WalletPosition>",
    "<WalletPosition><Wallets><Unknown/></Wallets></WalletPosition>",
    position(wallet().replace("<Amount>123.456789012345</Amount>", "")),
    position(wallet().replace("<WalletNatureId>1</WalletNatureId>", "")),
    position(wallet("12")), position(wallet("1", "NaN")), position(wallet("1", "1e3")),
    position(wallet("1", "1,23")), position(wallet("1", "0.1234567890123")),
    position(wallet("1", "1", "")), position(wallet("1", "1", "Sale", "100")),
    position(wallet() + "unexpected-text")]) {
    assert.throws(() => parseStoneWalletPosition(file(section), scope), invalid);
  }
});

test("duplicate wallet tuples including zero-padded codes are rejected", () => {
  assert.throws(() => parseStoneWalletPosition(file(position(wallet() + wallet())), scope), invalid);
  assert.throws(() => parseStoneWalletPosition(file(position(wallet() + wallet("1", "5", "Sale", "03"))), scope), invalid);
});

test("wallet count, XML bytes, malformed XML and entities are bounded", () => {
  assert.throws(() => parseStoneWalletPosition(file(position(Array(MAX_STONE_WALLETS + 1).fill(wallet()).join(""))), scope), invalid);
  assert.throws(() => parseStoneWalletPosition(" ".repeat(STONE_AGENDA_MAX_BYTES + 1), scope), invalid);
  assert.throws(() => parseStoneWalletPosition(file().slice(0, -5), scope), invalid);
  assert.throws(() => parseStoneWalletPosition('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///private">]>' + file(), scope), invalid);
});

test("query requires admin, strict parameters and a published date before any provider call", async () => {
  const deps = { now: new Date("2026-09-22T12:00:00Z"), read: async () => { assert.fail("must not call provider"); } };
  await assert.rejects(queryStoneWalletPosition(scope, { isDefaultAdmin: false }, deps), code("STONE_WALLET_FORBIDDEN"));
  for (const input of [{ ...scope, layout: "XML2_2" }, { ...scope, workspaceId: "foreign" },
    { ...scope, referenceDate: "2026-02-30" }, { ...scope, limit: 201 }, { ...scope, stoneCode: "../secret" }]) {
    await assert.rejects(queryStoneWalletPosition(input, { isDefaultAdmin: true }, deps), code("STONE_WALLET_QUERY_INVALID"));
  }
  await assert.rejects(queryStoneWalletPosition({ ...scope, referenceDate: "2026-09-22" }, { isDefaultAdmin: true }, deps), code("STONE_WALLET_NOT_PUBLISHED"));
  await assert.rejects(queryStoneWalletPosition({ ...scope, referenceDate: "2026-09-21" }, { isDefaultAdmin: true },
    { ...deps, now: new Date("2026-09-22T07:59:59Z") }), code("STONE_WALLET_NOT_PUBLISHED"));
});

test("query paginates the validated file without changing its coverage or silently truncating", async () => {
  const deps = { now: new Date("2026-09-22T08:00:00Z"), read: async (input: typeof scope) => {
    assert.deepEqual(input, scope);
    return file(position(wallet("1") + wallet("7")));
  } };
  const first = await queryStoneWalletPosition({ ...scope, limit: 1 }, { isDefaultAdmin: true }, deps);
  const second = await queryStoneWalletPosition({ ...scope, offset: 1, limit: 1 }, { isDefaultAdmin: true }, deps);
  assert.equal(first.rows.length, 1); assert.equal(first.totalRowsInFile, 2);
  assert.equal(first.nextOffset, 1); assert.equal(second.nextOffset, null);
  assert.equal(second.rows[0].nature, "ownership_assignment");
  assert.equal(first.sourceHash, second.sourceHash);
  assert.equal(first.coverage, "daily_reported_wallet_position_not_complete_maturity_schedule");
});

test("retrieval failures remain errors rather than zero balances", async () => {
  await assert.rejects(queryStoneWalletPosition(scope, { isDefaultAdmin: true }, {
    now: new Date("2026-09-22T12:00:00Z"), read: async () => {
      throw new AppError({ code: "STONE_AGENDA_CREDENTIAL_REJECTED", kind: "PERMANENT_EXTERNAL" });
    },
  }), code("STONE_AGENDA_CREDENTIAL_REJECTED"));
});
