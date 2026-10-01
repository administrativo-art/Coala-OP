import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  businessSuiteExportTitles,
  businessSuiteMetricFields,
  parseBusinessSuiteCsv,
  type InstagramBusinessSuiteMetricField,
} from "../src/features/instagram-scheduler/business-suite-insights";

type CliOptions = {
  apply: boolean;
  project: string;
  database: string;
  confirmProject: string | null;
  backupPath: string | null;
  files: Record<InstagramBusinessSuiteMetricField, string>;
};

const flagByMetric: Record<InstagramBusinessSuiteMetricField, string> = {
  views: "--views",
  reach: "--reach",
  contentInteractions: "--interactions",
  profileVisits: "--profile-visits",
  profileLinkClicks: "--profile-link-clicks",
  followers: "--followers",
};

function argumentValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1] || args[index + 1]!.startsWith("--")) return null;
  return args[index + 1]!;
}

function parseOptions(args: string[]): CliOptions {
  const files = Object.fromEntries(businessSuiteMetricFields.map((metric) => {
    const value = argumentValue(args, flagByMetric[metric]);
    if (!value) throw new Error(`Informe ${flagByMetric[metric]} com o CSV ${businessSuiteExportTitles[metric]}.`);
    return [metric, resolve(value)];
  })) as Record<InstagramBusinessSuiteMetricField, string>;
  return {
    apply: args.includes("--apply"),
    project: argumentValue(args, "--project") ?? "smart-converter-752gf",
    database: argumentValue(args, "--database") ?? "coala",
    confirmProject: argumentValue(args, "--confirm-project"),
    backupPath: argumentValue(args, "--backup"),
    files,
  };
}

function decodeMetaCsv(buffer: Buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  return buffer.toString("utf8");
}

function sum(values: Map<string, number>) {
  return [...values.values()].reduce((total, value) => total + value, 0);
}

async function prepareImport(options: CliOptions) {
  const buffers = new Map<InstagramBusinessSuiteMetricField, Buffer>();
  const parsed = new Map<InstagramBusinessSuiteMetricField, Map<string, number>>();
  for (const metric of businessSuiteMetricFields) {
    const buffer = await readFile(options.files[metric]);
    buffers.set(metric, buffer);
    parsed.set(metric, parseBusinessSuiteCsv(decodeMetaCsv(buffer), metric));
  }

  const denseMetrics = businessSuiteMetricFields.filter((metric) => metric !== "followers");
  const canonicalDates = [...parsed.get("views")!.keys()].sort();
  denseMetrics.forEach((metric) => {
    const dates = [...parsed.get(metric)!.keys()].sort();
    if (dates.length !== canonicalDates.length || dates.some((date, index) => date !== canonicalDates[index])) {
      throw new Error(`${businessSuiteExportTitles[metric]} não cobre as mesmas datas de Visualizações.`);
    }
  });
  const dateSet = new Set(canonicalDates);
  parsed.get("followers")!.forEach((_value, date) => {
    if (!dateSet.has(date)) throw new Error(`Seguidores contém uma data fora do período principal: ${date}.`);
  });

  const year = canonicalDates[0]?.slice(0, 4);
  if (!year || canonicalDates[0] !== `${year}-01-01`) throw new Error("O histórico deve começar em 1º de janeiro.");
  const fingerprint = createHash("sha256");
  businessSuiteMetricFields.forEach((metric) => fingerprint.update(buffers.get(metric)!));
  const importFingerprint = fingerprint.digest("hex");

  const rows = canonicalDates.map((date) => ({
    date,
    views: parsed.get("views")!.get(date)!,
    reach: parsed.get("reach")!.get(date)!,
    contentInteractions: parsed.get("contentInteractions")!.get(date)!,
    profileVisits: parsed.get("profileVisits")!.get(date)!,
    profileLinkClicks: parsed.get("profileLinkClicks")!.get(date)!,
    followers: parsed.get("followers")!.get(date) ?? 0,
  }));

  return {
    rows,
    importFingerprint,
    summary: {
      mode: options.apply ? "apply" : "dry-run",
      project: options.project,
      database: options.database,
      firstDate: canonicalDates[0],
      lastDate: canonicalDates.at(-1),
      days: canonicalDates.length,
      totals: Object.fromEntries(businessSuiteMetricFields.map((metric) => [metric, sum(parsed.get(metric)!)])),
      importFingerprint,
    },
  };
}

async function applyImport(options: CliOptions, prepared: Awaited<ReturnType<typeof prepareImport>>) {
  if (options.confirmProject !== options.project) {
    throw new Error(`Para aplicar, confirme o projeto com --confirm-project ${options.project}.`);
  }
  if (!options.backupPath) throw new Error("Para aplicar, informe --backup com um caminho privado para o backup prévio.");

  const [{ applicationDefault, getApps, initializeApp }, { FieldValue, getFirestore }] = await Promise.all([
    import("firebase-admin/app"),
    import("firebase-admin/firestore"),
  ]);
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId: options.project });
  const db = getFirestore(app, options.database);
  const collection = db.collection("instagramAccountInsightsDaily");
  const refs = prepared.rows.map((row) => collection.doc(row.date));
  const existing = await db.getAll(...refs);
  const backup = existing.map((snapshot) => ({ id: snapshot.id, exists: snapshot.exists, data: snapshot.exists ? snapshot.data() : null }));
  const backupPath = resolve(options.backupPath);
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, `${JSON.stringify({ project: options.project, database: options.database, capturedAt: new Date().toISOString(), documents: backup }, null, 2)}\n`, { mode: 0o600 });

  const pending = prepared.rows.filter((_row, index) => existing[index]?.get("businessSuite.importFingerprint") !== prepared.importFingerprint);
  for (let offset = 0; offset < pending.length; offset += 400) {
    const batch = db.batch();
    pending.slice(offset, offset + 400).forEach((row) => {
      batch.set(collection.doc(row.date), {
        date: row.date,
        settled: true,
        businessSuite: {
          views: row.views,
          reach: row.reach,
          contentInteractions: row.contentInteractions,
          profileVisits: row.profileVisits,
          profileLinkClicks: row.profileLinkClicks,
          followers: row.followers,
          source: "meta-business-suite-csv",
          importedAt: FieldValue.serverTimestamp(),
          importFingerprint: prepared.importFingerprint,
          schemaVersion: 1,
        },
      }, { merge: true });
    });
    await batch.commit();
  }
  return { backupPath, documentsRead: existing.length, documentsWritten: pending.length };
}

const options = parseOptions(process.argv.slice(2));
const prepared = await prepareImport(options);
console.log(JSON.stringify(prepared.summary, null, 2));
if (options.apply) console.log(JSON.stringify(await applyImport(options, prepared), null, 2));
