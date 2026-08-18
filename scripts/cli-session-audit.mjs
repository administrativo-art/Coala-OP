import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import path from "node:path";

import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const DATABASE_ID = process.env.MAIN_FIRESTORE_DATABASE || "coala";
const WORKSPACE_ID = "coala";
const RETENTION_DAYS = 365;
const command = process.argv[2];
const argumentsMap = parseArguments(process.argv.slice(3));

function parseArguments(values) {
  const parsed = new Map();
  for (const value of values) {
    if (!value.startsWith("--")) continue;
    const separator = value.indexOf("=");
    if (separator === -1) parsed.set(value.slice(2), "true");
    else parsed.set(value.slice(2, separator), value.slice(separator + 1));
  }
  return parsed;
}

function required(name) {
  const value = argumentsMap.get(name)?.trim();
  if (!value) throw new Error(`Argumento obrigatório ausente: --${name}.`);
  return value;
}

function safeText(value, limit = 160) {
  return String(value ?? "").trim().slice(0, limit);
}

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function repositoryContext(cwd) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return null;
  return {
    name: path.basename(root),
    rootHash: createHash("sha256").update(root).digest("hex").slice(0, 16),
    branch: git(cwd, ["branch", "--show-current"]) || null,
    commit: git(cwd, ["rev-parse", "HEAD"]) || null,
    dirty: Boolean(git(cwd, ["status", "--porcelain"])),
  };
}

function actor() {
  const localUsername = safeText(process.env.COALA_AUDIT_USERNAME || userInfo().username, 80);
  return {
    id: safeText(process.env.COALA_AUDIT_USER_ID || `local:${localUsername}`, 120),
    username: localUsername,
  };
}

function ttlFrom(date) {
  return Timestamp.fromDate(new Date(date.getTime() + RETENTION_DAYS * 86_400_000));
}

function app() {
  return getApps().find((candidate) => candidate.name === "coala-cli-session-audit")
    ?? initializeApp(
      { credential: applicationDefault(), projectId: PROJECT_ID },
      "coala-cli-session-audit",
    );
}

function sanitizedMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  );
}

async function writeActionLog(db, { id, user, action, metadata, occurredAt }) {
  await db.collection("actionLogs").doc(id).set({
    workspace_id: WORKSPACE_ID,
    user_id: user.id,
    username: user.username,
    module: "system.cli",
    action,
    metadata: sanitizedMetadata(metadata),
    ip_address: null,
    timestamp: Timestamp.fromDate(occurredAt),
    ttl: ttlFrom(occurredAt),
  });
}

async function startSession(db) {
  const cliName = safeText(required("cli"), 80);
  const cwd = path.resolve(argumentsMap.get("cwd") || process.cwd());
  const sessionId = `cli_${Date.now()}_${randomUUID()}`;
  const startedAt = new Date();
  const user = actor();
  const repository = repositoryContext(cwd);
  const session = {
    workspaceId: WORKSPACE_ID,
    sessionId,
    source: "shell_hook",
    client: cliName,
    status: "running",
    actorId: user.id,
    actorName: user.username,
    repository,
    shell: path.basename(process.env.SHELL || "unknown"),
    startedAt: Timestamp.fromDate(startedAt),
    updatedAt: Timestamp.fromDate(startedAt),
    ttl: ttlFrom(startedAt),
  };

  await Promise.all([
    db.collection("cliOperationSessions").doc(sessionId).create(session),
    writeActionLog(db, {
      id: `${sessionId}__started`,
      user,
      action: "cli_session_started",
      occurredAt: startedAt,
      metadata: {
        session_id: sessionId,
        cli_name: cliName,
        repository: repository?.name ?? null,
        branch: repository?.branch ?? null,
        commit: repository?.commit ?? null,
        dirty_worktree: repository?.dirty ?? null,
        target_type: "cli_session",
        target_id: sessionId,
        target_name: `${cliName} · ${repository?.name ?? "fora de repositório"}`,
      },
    }),
  ]);

  process.stdout.write(sessionId);
}

async function finishSession(db) {
  const sessionId = required("session-id");
  const exitCode = Number(argumentsMap.get("exit-code") ?? 0);
  const finishedAt = new Date();
  const user = actor();
  const sessionRef = db.collection("cliOperationSessions").doc(sessionId);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(sessionRef);
    if (!snapshot.exists) throw new Error(`Sessão não encontrada: ${sessionId}.`);
    const startedAt = snapshot.get("startedAt")?.toDate?.();
    transaction.set(sessionRef, {
      status: exitCode === 0 ? "completed" : "failed",
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
      finishedAt: Timestamp.fromDate(finishedAt),
      durationMs: startedAt instanceof Date ? finishedAt.getTime() - startedAt.getTime() : null,
      updatedAt: Timestamp.fromDate(finishedAt),
    }, { merge: true });
  });

  await writeActionLog(db, {
    id: `${sessionId}__finished`,
    user,
    action: exitCode === 0 ? "cli_session_completed" : "cli_session_failed",
    occurredAt: finishedAt,
    metadata: {
      session_id: sessionId,
      exit_code: Number.isFinite(exitCode) ? exitCode : null,
      target_type: "cli_session",
      target_id: sessionId,
      target_name: sessionId,
    },
  });
}

async function recordOperation(db) {
  const sessionId = required("session-id");
  const operation = safeText(required("operation"), 120);
  const status = safeText(argumentsMap.get("status") || "recorded", 40);
  const occurredAt = new Date();
  const user = actor();
  const sessionRef = db.collection("cliOperationSessions").doc(sessionId);
  const session = await sessionRef.get();
  if (!session.exists) throw new Error(`Sessão não encontrada: ${sessionId}.`);

  const eventId = randomUUID();
  const targetType = safeText(argumentsMap.get("target-type"), 80) || null;
  const targetId = safeText(argumentsMap.get("target-id"), 160) || null;
  const targetName = safeText(argumentsMap.get("target-name"), 160) || null;
  const summary = safeText(argumentsMap.get("summary"), 500) || null;
  const amount = Number(argumentsMap.get("amount"));

  await Promise.all([
    sessionRef.collection("events").doc(eventId).create({
      operation,
      status,
      targetType,
      targetId,
      targetName,
      summary,
      amount: Number.isFinite(amount) ? amount : null,
      occurredAt: Timestamp.fromDate(occurredAt),
      actorId: user.id,
      actorName: user.username,
    }),
    writeActionLog(db, {
      id: `${sessionId}__event__${eventId}`,
      user,
      action: "cli_operation_recorded",
      occurredAt,
      metadata: {
        session_id: sessionId,
        operation,
        status,
        summary,
        amount: Number.isFinite(amount) ? amount : null,
        target_type: targetType,
        target_id: targetId,
        target_name: targetName,
      },
    }),
  ]);
}

function serialize(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serialize(entry)]));
  }
  return value;
}

async function showSession(db) {
  const sessionId = required("session-id");
  const sessionRef = db.collection("cliOperationSessions").doc(sessionId);
  const [session, events] = await Promise.all([
    sessionRef.get(),
    sessionRef.collection("events").orderBy("occurredAt", "asc").get(),
  ]);
  if (!session.exists) throw new Error(`Sessão não encontrada: ${sessionId}.`);
  console.log(JSON.stringify({
    id: session.id,
    ...serialize(session.data()),
    events: events.docs.map((document) => ({ id: document.id, ...serialize(document.data()) })),
  }, null, 2));
}

async function dryRun() {
  const cwd = path.resolve(argumentsMap.get("cwd") || process.cwd());
  console.log(JSON.stringify({
    mode: "dry-run",
    command: argumentsMap.get("command") || "start",
    cli: argumentsMap.get("cli") || null,
    actor: actor(),
    repository: repositoryContext(cwd),
    privacy: {
      commandArgumentsRecorded: false,
      promptsRecorded: false,
      environmentRecorded: false,
      retentionDays: RETENTION_DAYS,
    },
  }, null, 2));
}

if (argumentsMap.get("dry-run") === "true") {
  await dryRun();
  process.exit(0);
}

if (!["start", "finish", "event", "show"].includes(command)) {
  throw new Error("Uso: cli-session-audit.mjs <start|finish|event|show> [--chave=valor].");
}

const db = getFirestore(app(), DATABASE_ID);
if (command === "start") await startSession(db);
if (command === "finish") await finishSession(db);
if (command === "event") await recordOperation(db);
if (command === "show") await showSession(db);
