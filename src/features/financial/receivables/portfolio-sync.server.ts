import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { stoneAgendaQuerySchema } from "@/lib/integrations/stone/agenda-query";
import { parseStoneAgendaXml } from "@/lib/integrations/stone/agenda-parser";
import { fetchStoneAgendaXml } from "@/lib/integrations/stone/agenda-transport";
import { parseStoneWalletPosition } from "@/lib/integrations/stone/wallet-position-parser";
import { WORKSPACE_ID } from "@/lib/workspace";
import { latestPublishedDate } from "./period-review";
import { projectStonePortfolio } from "./portfolio-projection";

const date = stoneAgendaQuerySchema.shape.referenceDate;
export const portfolioSourceSchema = z.object({
  workspaceId: z.string().min(1), stoneCode: stoneAgendaQuerySchema.shape.stoneCode,
  kioskId: z.string().min(1), accountId: z.string().min(1), mappingId: z.string().min(1),
  firstCaptureDate: date, enabled: z.literal(true),
}).strict();
const sourceCollection = "stonePortfolioSources";
const fileCollection = "stonePortfolioFiles";
const rightsCollection = "stonePortfolioRightsFiles";
const snapshotCollection = "stonePortfolioSnapshots";
const lockCollection = "stonePortfolioSyncLocks";
const maxCachedXmlBytes = 800_000;
const maxDays = 731;
const projectionVersion = 2;
const rightsVersion = 1;
const rightsSchema = z.object({
  workspaceId: z.string().min(1), stoneCode: stoneAgendaQuerySchema.shape.stoneCode,
  referenceDate: date, rightsVersion: z.literal(rightsVersion),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  fileId: z.string().min(1).max(128), generatedAtProvider: z.string().regex(/^\d{14}$/),
  status: z.enum(["reported", "empty", "not_provided"]),
  rows: z.array(z.object({
    walletTypeId: z.string().regex(/^\d{1,2}$/), walletNatureId: z.string().regex(/^\d$/),
    nature: z.enum(["regular", "warranty", "ownership_assignment", "stone_anticipation", "unknown"]),
    category: z.string().min(1).max(80), amount: z.string().regex(/^-?\d{1,15}(?:\.\d{1,12})?$/),
  }).strict()).max(500),
  unknownNatureCount: z.number().int().nonnegative().max(500),
  cachedAt: z.string().datetime(),
}).strict();

const sourceId = (stoneCode: string) => createHash("sha256").update(`${WORKSPACE_ID}:${stoneCode}`).digest("hex");
const fileId = (stoneCode: string, referenceDate: string) => `${sourceId(stoneCode)}_${referenceDate}`;
const days = (first: string, last: string) => {
  const result: string[] = [];
  for (let time = Date.parse(`${first}T00:00:00Z`); time <= Date.parse(`${last}T00:00:00Z`); time += 86_400_000) {
    result.push(new Date(time).toISOString().slice(0, 10));
  }
  if (!result.length || result.length > maxDays || result[0] !== first || result.at(-1) !== last) {
    throw new AppError({ code: "STONE_PORTFOLIO_RANGE", kind: "VALIDATION" });
  }
  return result;
};

async function readSource(stoneCode: string) {
  const snapshot = await financialDbAdmin.collection(sourceCollection).doc(sourceId(stoneCode)).get();
  const parsed = portfolioSourceSchema.safeParse(snapshot.data());
  if (!parsed.success || parsed.data.workspaceId !== WORKSPACE_ID || parsed.data.stoneCode !== stoneCode) {
    throw new AppError({ code: "STONE_PORTFOLIO_SOURCE_MISSING", kind: "EXPECTED_BUSINESS",
      safeMessage: "A fonte automática da carteira Stone não está configurada." });
  }
  return parsed.data;
}

/** One read per day. Completed days are cached, so regular runs call Stone only
 * for newly published files and never consume the rate limit on every page view. */
async function readDay(stoneCode: string, referenceDate: string) {
  const ref = financialDbAdmin.collection(fileCollection).doc(fileId(stoneCode, referenceDate));
  const cached = await ref.get();
  let xml: string;
  if (cached.exists) {
    const value = cached.get("xml");
    if (typeof value !== "string" || cached.get("stoneCode") !== stoneCode ||
      cached.get("referenceDate") !== referenceDate ||
      cached.get("sourceHash") !== createHash("sha256").update(value).digest("hex")) {
      throw new AppError({ code: "STONE_PORTFOLIO_CACHE_INVALID", kind: "DATA_INTEGRITY" });
    }
    xml = value;
  } else {
    xml = await fetchStoneAgendaXml({ stoneCode, referenceDate }, { apiKey: process.env.STONE_CONCILIATION_API_KEY });
    if (Buffer.byteLength(xml, "utf8") > maxCachedXmlBytes) {
      throw new AppError({ code: "STONE_PORTFOLIO_CACHE_LIMIT", kind: "EXPECTED_BUSINESS",
        safeMessage: "Um arquivo diário excede o limite de armazenamento da carteira." });
    }
    // Validate before caching, including merchant, date and layout.
    parseStoneAgendaXml(xml, { stoneCode, referenceDate });
    await ref.create({ workspaceId: WORKSPACE_ID, stoneCode, referenceDate, xml,
      cachedAt: new Date().toISOString(), sourceHash: createHash("sha256").update(xml).digest("hex") })
      .catch(async error => {
        if (error?.code !== 6) throw error;
        const concurrent = await ref.get();
        const stored = concurrent.get("xml");
        if (stored !== xml) throw new AppError({ code: "STONE_PORTFOLIO_REVISION_CONFLICT", kind: "DATA_INTEGRITY" });
      });
  }
  return parseStoneAgendaXml(xml, { stoneCode, referenceDate });
}

/** Keep one validated 2.4 position per date. Its aggregate wallet natures are
 * evidence of guarantees/assignments, but cannot be allocated to sale parcels. */
async function readRightsPosition(stoneCode: string, referenceDate: string) {
  const ref = financialDbAdmin.collection(rightsCollection).doc(fileId(stoneCode, referenceDate));
  const cached = await ref.get();
  if (cached.exists) {
    const parsed = rightsSchema.safeParse(cached.data());
    if (!parsed.success || parsed.data.workspaceId !== WORKSPACE_ID ||
      parsed.data.stoneCode !== stoneCode || parsed.data.referenceDate !== referenceDate) {
      throw new AppError({ code: "STONE_PORTFOLIO_RIGHTS_CACHE_INVALID", kind: "DATA_INTEGRITY" });
    }
    return parsed.data;
  }
  const xml = await fetchStoneAgendaXml({ stoneCode, referenceDate },
    { apiKey: process.env.STONE_CONCILIATION_API_KEY, layout: "XML2_4" });
  const parsed = parseStoneWalletPosition(xml, { stoneCode, referenceDate });
  const value = rightsSchema.parse({ workspaceId: WORKSPACE_ID, stoneCode, referenceDate,
    rightsVersion, sourceHash: parsed.sourceHash, fileId: parsed.fileId,
    generatedAtProvider: parsed.generatedAtProvider, status: parsed.status,
    rows: parsed.rows, unknownNatureCount: parsed.unknownNatureCount,
    cachedAt: new Date().toISOString() });
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxCachedXmlBytes) {
    throw new AppError({ code: "STONE_PORTFOLIO_RIGHTS_CACHE_LIMIT", kind: "EXPECTED_BUSINESS" });
  }
  await ref.create(value).catch(async error => {
    if (error?.code !== 6) throw error;
    const concurrent = rightsSchema.safeParse((await ref.get()).data());
    if (!concurrent.success || concurrent.data.sourceHash !== value.sourceHash) {
      throw new AppError({ code: "STONE_PORTFOLIO_RIGHTS_REVISION_CONFLICT", kind: "DATA_INTEGRITY" });
    }
  });
  return value;
}

export async function syncStonePortfolio(stoneCode: string, now = new Date()) {
  const source = await readSource(stoneCode);
  const asOf = latestPublishedDate(now);
  const dates = days(source.firstCaptureDate, asOf);
  const ref = financialDbAdmin.collection(snapshotCollection).doc(sourceId(stoneCode));
  const published = await ref.get();
  const publishedRights = rightsSchema.safeParse(published.get("rightsPosition"));
  if (published.get("asOf") === asOf && published.get("mappingId") === source.mappingId &&
    published.get("firstCaptureDate") === source.firstCaptureDate &&
    published.get("projectionVersion") === projectionVersion && publishedRights.success &&
    publishedRights.data.workspaceId === WORKSPACE_ID && publishedRights.data.stoneCode === stoneCode &&
    publishedRights.data.referenceDate === asOf) {
    return { stoneCode, asOf, summary: published.get("summary"), missingDates: published.get("missingDates") };
  }
  const lockRef = financialDbAdmin.collection(lockCollection).doc(sourceId(stoneCode));
  const runId = randomUUID();
  await financialDbAdmin.runTransaction(async tx => {
    const existing = await tx.get(lockRef);
    if (Number(existing.get("expiresAt") ?? 0) > Date.now()) {
      throw new AppError({ code: "STONE_PORTFOLIO_SYNC_BUSY", kind: "EXPECTED_BUSINESS",
        safeMessage: "A carteira Stone já está sendo atualizada." });
    }
    tx.set(lockRef, { runId, expiresAt: Date.now() + 360_000 });
  });
  try {
    const files: Awaited<ReturnType<typeof readDay>>[] = [];
    // Three distinct dates at a time; each exact StoneCode/date is called once.
    for (let offset = 0; offset < dates.length; offset += 3) {
      const batch = await Promise.all(dates.slice(offset, offset + 3).map(day => readDay(stoneCode, day)));
      files.push(...batch);
    }
    const rightsPosition = await readRightsPosition(stoneCode, asOf);
    const result = projectStonePortfolio({ stoneCode, firstCaptureDate: source.firstCaptureDate, asOf }, files);
    const snapshot = { workspaceId: WORKSPACE_ID, stoneCode, kioskId: source.kioskId,
      accountId: source.accountId, mappingId: source.mappingId, projectionVersion, ...result,
      rightsPosition,
      rows: result.rows.filter(row => row.status !== "paid"),
      updatedAt: new Date().toISOString() };
    if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > maxCachedXmlBytes) {
      throw new AppError({ code: "STONE_PORTFOLIO_SNAPSHOT_LIMIT", kind: "EXPECTED_BUSINESS",
        safeMessage: "A carteira excede o limite da visão consolidada." });
    }
    await ref.set(snapshot);
    return { stoneCode, asOf, summary: result.summary, missingDates: result.missingDates };
  } finally {
    await financialDbAdmin.runTransaction(async tx => {
      const lock = await tx.get(lockRef);
      if (lock.get("runId") === runId) tx.delete(lockRef);
    }).catch(() => undefined);
  }
}

export async function readStonePortfolio(stoneCode: string) {
  const source = await readSource(stoneCode);
  const latestAvailableDate = latestPublishedDate(new Date());
  const snapshot = await financialDbAdmin.collection(snapshotCollection).doc(sourceId(stoneCode)).get();
  if (!snapshot.exists) return { status: "not_synchronized" as const, stoneCode,
    kioskId: source.kioskId, accountId: source.accountId, mappingId: source.mappingId,
    firstCaptureDate: source.firstCaptureDate, asOf: null, latestAvailableDate,
    stale: true, summary: null, rows: [] };
  if (snapshot.get("workspaceId") !== WORKSPACE_ID || snapshot.get("stoneCode") !== stoneCode ||
    snapshot.get("mappingId") !== source.mappingId || snapshot.get("accountId") !== source.accountId ||
    snapshot.get("kioskId") !== source.kioskId || snapshot.get("firstCaptureDate") !== source.firstCaptureDate ||
    ![1, projectionVersion].includes(snapshot.get("projectionVersion"))) {
    throw new AppError({ code: "STONE_PORTFOLIO_SNAPSHOT_SCOPE", kind: "DATA_INTEGRITY" });
  }
  if (snapshot.get("projectionVersion") === projectionVersion) {
    const rights = rightsSchema.safeParse(snapshot.get("rightsPosition"));
    if (!rights.success || rights.data.workspaceId !== WORKSPACE_ID ||
      rights.data.stoneCode !== stoneCode || rights.data.referenceDate !== snapshot.get("asOf")) {
      throw new AppError({ code: "STONE_PORTFOLIO_RIGHTS_SNAPSHOT_SCOPE", kind: "DATA_INTEGRITY" });
    }
  }
  return { status: "synchronized" as const, ...snapshot.data(), latestAvailableDate,
    rightsPosition: snapshot.get("projectionVersion") === projectionVersion ? snapshot.get("rightsPosition") : null,
    stale: snapshot.get("asOf") !== latestAvailableDate };
}

export async function syncEnabledStonePortfolios(now = new Date()) {
  const sources = await financialDbAdmin.collection(sourceCollection)
    .where("enabled", "==", true).limit(21).get();
  if (sources.size > 20) throw new AppError({ code: "STONE_PORTFOLIO_SOURCE_LIMIT", kind: "EXPECTED_BUSINESS" });
  const stoneCodes = sources.docs.map(doc => portfolioSourceSchema.parse(doc.data()))
    .filter(source => source.workspaceId === WORKSPACE_ID).map(source => source.stoneCode);
  const results = [];
  for (const stoneCode of stoneCodes) results.push(await syncStonePortfolio(stoneCode, now));
  return results;
}
