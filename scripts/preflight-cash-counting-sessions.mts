import * as dotenv from "dotenv";
import { FieldPath } from "firebase-admin/firestore";

import {
  analyzeCashCountingSessionPreflight,
  type CashCountingSessionPreflightLock,
  type CashCountingSessionPreflightSession,
} from "../src/features/financial/cash-counting-sessions/preflight";

dotenv.config({ path: ".env.local" });

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const workspaceId = argument("workspace")?.trim();
if (!workspaceId) {
  throw new Error("Informe explicitamente --workspace=<id>. O preflight é somente leitura e não escolhe ambiente por padrão.");
}
const parsedMax = Number(argument("max") ?? "5000");
if (!Number.isInteger(parsedMax) || parsedMax < 1 || parsedMax > 20_000) {
  throw new Error("--max deve ser um inteiro entre 1 e 20000.");
}

const { financialDbAdmin } = await import("../src/lib/firebase-financial-admin");

async function readBounded<T>(query: FirebaseFirestore.Query, max: number) {
  const pageSize = Math.min(250, max + 1);
  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (documents.length <= max) {
    const requestLimit = Math.min(pageSize, max + 1 - documents.length);
    let pageQuery = query.orderBy(FieldPath.documentId()).limit(requestLimit);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const snapshot = await pageQuery.get();
    documents.push(...snapshot.docs);
    cursor = snapshot.docs.at(-1) ?? null;
    if (snapshot.size < requestLimit) break;
  }
  return {
    rows: documents.slice(0, max).map((document) => ({ id: document.id, ...document.data() }) as T),
    truncated: documents.length > max,
  };
}

const [openPage, lockPage] = await Promise.all([
  readBounded<CashCountingSessionPreflightSession>(
    financialDbAdmin.collection("cashCountingSessions")
      .where("workspaceId", "==", workspaceId)
      .where("status", "==", "open"),
    parsedMax,
  ),
  readBounded<CashCountingSessionPreflightLock>(
    financialDbAdmin.collection("cashCountingSessionLocks")
      .where("workspaceId", "==", workspaceId),
    parsedMax,
  ),
]);

const referencedSessionIds = Array.from(new Set(lockPage.rows.map((lock) => lock.sessionId).filter(Boolean)));
const referencedSessions: CashCountingSessionPreflightSession[] = [];
for (let start = 0; start < referencedSessionIds.length; start += 100) {
  const references = referencedSessionIds.slice(start, start + 100)
    .map((sessionId) => financialDbAdmin.collection("cashCountingSessions").doc(sessionId));
  const snapshots = await financialDbAdmin.getAll(...references);
  referencedSessions.push(...snapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }) as CashCountingSessionPreflightSession));
}

const report = analyzeCashCountingSessionPreflight({
  workspaceId,
  openSessions: openPage.rows,
  referencedSessions,
  locks: lockPage.rows,
  truncated: openPage.truncated || lockPage.truncated,
});
process.stdout.write(`${JSON.stringify({ mode: "READ_ONLY_PREFLIGHT", ...report }, null, 2)}\n`);
if (report.blocking) process.exitCode = 2;
