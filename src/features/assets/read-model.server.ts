import "server-only";

import { FieldPath } from "firebase-admin/firestore";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { mergeHistoryPages, type AssetCollectionCursor, type AssetHistoryRow } from "./history-pagination";

type CollectionCursor = AssetCollectionCursor;
type HistoryCursor = { version: 1; sources: Record<string, CollectionCursor> };

function encodeCursor(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor<T>(value: string | null, validate: (candidate: unknown) => candidate is T): T | null {
  if (!value) return null;
  try {
    const candidate: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (validate(candidate)) return candidate;
  } catch {
    // A mensagem pública não expõe detalhes do parser nem o cursor recebido.
  }
  throw new AppError({ code: "ASSET_CURSOR_INVALID", kind: "VALIDATION", safeMessage: "Cursor de paginação inválido." });
}

function isCollectionCursor(candidate: unknown): candidate is CollectionCursor {
  if (!candidate || typeof candidate !== "object") return false;
  const value = candidate as Record<string, unknown>;
  return typeof value.at === "string" && value.at.length > 0 && typeof value.id === "string" && value.id.length > 0;
}

function isHistoryCursor(candidate: unknown): candidate is HistoryCursor {
  if (!candidate || typeof candidate !== "object") return false;
  const value = candidate as Record<string, unknown>;
  if (value.version !== 1 || !value.sources || typeof value.sources !== "object") return false;
  return Object.values(value.sources as Record<string, unknown>).every(isCollectionCursor);
}

export const boundedLimit = (value: string | null, fallback = 25) => Math.min(Math.max(Number(value) || fallback, 1), 100);

export async function listAssetCollection(collection: string, assetId: string, limit: number, cursor: string | null, dateField = "createdAt") {
  const decoded = decodeCursor(cursor, isCollectionCursor);
  let query: FirebaseFirestore.Query = dbAdmin.collection(collection)
    .where("assetId", "==", assetId)
    .orderBy(dateField, "desc")
    .orderBy(FieldPath.documentId(), "desc");
  if (decoded) query = query.startAfter(decoded.at, decoded.id);
  const snapshot = await query.limit(limit + 1).get();
  const page = snapshot.docs.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((document) => ({ id: document.id, ...document.data() })),
    nextCursor: snapshot.size > limit && last
      ? encodeCursor({ at: String(last.get(dateField) ?? ""), id: last.id } satisfies CollectionCursor)
      : null,
  };
}

export function historyCsv(items: Array<Record<string, any>>) {
  const clean = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""').replace(/[\r\n]+/g, " ")}"`;
  return ["data,tipo,origem,descricao", ...items.map((item) => [item.at, item.type, item.source, item.description].map(clean).join(","))].join("\r\n");
}

export async function historyPdf(items: Array<Record<string, any>>) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  let y = 780;
  page.drawText("HISTÓRICO PATRIMONIAL", { x: 45, y, size: 14, font: bold });
  for (const item of items) {
    if (y < 70) { page = pdf.addPage([595, 842]); y = 790; }
    const line = `${String(item.at ?? "").slice(0, 19)}  ${item.type}  ${String(item.description ?? "").slice(0, 80)}`.replace(/[^\x20-\x7EÀ-ÿ]/g, "?");
    page.drawText(line, { x: 45, y: y -= 17, size: 7.5, font, maxWidth: 505 });
  }
  return Buffer.from(await pdf.save());
}

type HistorySource = { collection: string; date: string; kind: string; assetField?: string };
const historySources: HistorySource[] = [
  { collection: "assetMovements", date: "occurredAt", kind: "movement" },
  { collection: "assetCustodyTransfers", date: "createdAt", kind: "custody" },
  { collection: "assetAudits", date: "createdAt", kind: "audit" },
  { collection: "assetMaintenanceOccurrences", date: "createdAt", kind: "maintenance" },
  { collection: "generatedDocuments", date: "createdAt", kind: "document", assetField: "sourceAssetId" },
];

export async function consolidatedAssetHistory(assetId: string, options: { limit: number; cursor?: string | null; kind?: string | null; exportAll?: boolean }) {
  const take = options.exportAll ? 500 : options.limit;
  const prior = options.exportAll ? null : decodeCursor(options.cursor ?? null, isHistoryCursor);
  const selected = historySources.filter((source) => !options.kind || source.kind === options.kind || (options.kind === "lifecycle" && ["movement", "custody"].includes(source.kind)));
  const pages = await Promise.all(selected.map(async (source) => {
    let query: FirebaseFirestore.Query = dbAdmin.collection(source.collection)
      .where(source.assetField ?? "assetId", "==", assetId)
      .orderBy(source.date, "desc")
      .orderBy(FieldPath.documentId(), "desc");
    const sourceCursor = prior?.sources[source.kind];
    if (sourceCursor) query = query.startAfter(sourceCursor.at, sourceCursor.id);
    const snapshot = await query.limit(take + 1).get();
    return {
      source: source.kind,
      rows: snapshot.docs.slice(0, take + 1).map((document) => {
        const data = document.data();
        return {
          id: document.id,
          at: String(data[source.date] ?? ""),
          type: String(data.type ?? source.kind),
          source: source.kind,
          description: String(data.notes ?? data.description ?? data.templateName ?? data.status ?? ""),
        } satisfies AssetHistoryRow;
      }),
    };
  }));
  const merged = mergeHistoryPages(pages, take, prior?.sources);
  return {
    items: merged.items,
    nextCursor: !options.exportAll && merged.hasMore
      ? encodeCursor({ version: 1, sources: merged.sources } satisfies HistoryCursor)
      : null,
  };
}
