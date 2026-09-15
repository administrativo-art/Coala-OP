/**
 * Valida e, após dupla confirmação, importa lotes canônicos da conciliação Stone.
 * O modo padrão é dry-run e não inicializa o Firebase Admin.
 *
 * Uso:
 *   npm run backfill:stone-reconciliation -- --input-dir=./tmp/stone --workspace=coala-shakes --approved-kiosk=tirirical
 *   npm run backfill:stone-reconciliation -- --input-dir=./tmp/stone --workspace=coala-shakes --approved-kiosk=tirirical \
 *     --execute --confirm-workspace=coala-shakes --reviewed-report=<hash-do-dry-run>
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { config } from "dotenv";

import { prepareStoneReconciliationBackfill } from "../src/features/financial/sales-reconciliation/backfill";

function argument(name: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function argumentsFor(name: string) {
  return process.argv
    .filter((value) => value.startsWith(`--${name}=`))
    .map((value) => value.slice(name.length + 3))
    .filter(Boolean);
}

const execute = process.argv.includes("--execute");
const inputDirectoryArgument = argument("input-dir");
const workspaceId = argument("workspace") ?? "";
const fromPeriod = argument("from") ?? "2026-08";
const confirmedWorkspace = argument("confirm-workspace");
const reviewedReport = argument("reviewed-report");
const approvedKioskIds = argumentsFor("approved-kiosk");
const maxFiles = Number(argument("max-files") ?? 1_000);

if (!inputDirectoryArgument) throw new Error("Informe --input-dir com os lotes canônicos JSON.");
if (!workspaceId) throw new Error("Informe --workspace.");
if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 1_000) {
  throw new Error("--max-files deve ser um inteiro entre 1 e 1000.");
}

const inputDirectory = resolve(inputDirectoryArgument);
const directoryEntries = (await readdir(inputDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase("pt-BR").endsWith(".json"))
  .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
if (directoryEntries.length === 0) throw new Error("Nenhum lote .json foi encontrado no diretório.");
if (directoryEntries.length > maxFiles) throw new Error(`O diretório excedeu o teto de ${maxFiles} arquivos.`);

const batches = [];
for (const entry of directoryEntries) {
  const filePath = resolve(inputDirectory, entry.name);
  const fileStats = await stat(filePath);
  if (fileStats.size > 5 * 1024 * 1024) throw new Error(`${entry.name}: arquivo maior que 5 MiB.`);
  const contents = await readFile(filePath, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch (cause) {
    throw new Error(`${entry.name}: JSON inválido.`, { cause });
  }
  batches.push({ fileName: entry.name, raw });
}

const plan = prepareStoneReconciliationBackfill({
  workspaceId,
  fromPeriod,
  approvedKioskIds,
  batches,
});
console.log(JSON.stringify({ mode: execute ? "EXECUTION_REQUESTED" : "DRY_RUN", ...plan.report }, null, 2));

if (!execute) {
  console.log(`Dry-run concluído sem acesso ao Firebase. Revise o relatório e guarde o hash ${plan.report.reviewHash}.`);
  process.exit(0);
}
if (!plan.report.readyToExecute) throw new Error("O relatório possui bloqueios; nenhuma escrita foi iniciada.");
if (confirmedWorkspace !== workspaceId) {
  throw new Error(`Confirme o destino com --confirm-workspace=${workspaceId}. Nenhuma escrita foi iniciada.`);
}
if (reviewedReport !== plan.report.reviewHash) {
  throw new Error("--reviewed-report não corresponde ao dry-run atual. Nenhuma escrita foi iniciada.");
}

config({ path: ".env.local" });
const [{ importCanonicalSalesBatch }, { importStoneFinancialBatch }] = await Promise.all([
  import("../src/features/financial/sales-reconciliation/service.server"),
  import("../src/features/financial/stone-receivables/service.server"),
]);
const approvedKiosks = new Set(approvedKioskIds);
const actor = {
  id: "migration:stone-reconciliation-backfill-v1",
  workspaceId,
  canAccessKiosk: (kioskId: string) => approvedKiosks.has(kioskId),
};
const results = [];
for (const batch of plan.preparedBatches) {
  const result = batch.source === "pdv" || batch.source === "stone_sales"
    ? await importCanonicalSalesBatch(batch.raw, actor)
    : await importStoneFinancialBatch(batch.raw, actor);
  results.push({ fileName: batch.fileName, source: batch.source, result });
}

console.log(JSON.stringify({
  mode: "EXECUTED",
  workspaceId,
  reviewHash: plan.report.reviewHash,
  batches: results,
  note: "O backfill não criou nem alterou fechamentos, sangrias, depósitos ou transações bancárias.",
}, null, 2));
