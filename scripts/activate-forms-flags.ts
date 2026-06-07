/**
 * Ativa as feature flags do motor de formulários no Firestore.
 *
 * Modos:
 *   --pilot    Ativa apenas `forms_navigation_api_enabled` (dashboard visível, sem redirect do legado)
 *   --full     Ativa engine + dual-write + navigation (cutover completo)
 *   --finalize Ativa engine + navigation e encerra leitura/dual-write do legado
 *   --rollback Desativa todas as flags de forms (emergência)
 *
 * Uso:
 *   npx tsx scripts/activate-forms-flags.ts --pilot  --service-account=scripts/sa.json
 *   npx tsx scripts/activate-forms-flags.ts --full   --service-account=scripts/sa.json
 *   npx tsx scripts/activate-forms-flags.ts --finalize --service-account=scripts/sa.json
 *   npx tsx scripts/activate-forms-flags.ts --rollback --service-account=scripts/sa.json
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { existsSync, readFileSync } from "fs";

type Mode = "pilot" | "full" | "finalize" | "rollback";

function parseArgs(argv: string[]): { mode: Mode; serviceAccountPath: string | null } {
  const mode: Mode = argv.includes("--rollback")
    ? "rollback"
    : argv.includes("--finalize")
      ? "finalize"
    : argv.includes("--full")
      ? "full"
      : argv.includes("--pilot")
        ? "pilot"
        : (() => { throw new Error("Informe --pilot, --full, --finalize ou --rollback."); })();

  const saArg = argv.find((a) => a.startsWith("--service-account="));
  return { mode, serviceAccountPath: saArg ? saArg.split("=")[1] : null };
}

function initAdmin(serviceAccountPath: string | null) {
  const existing = getApps().find((a) => a.name === "flags-activation");
  if (existing) return existing;

  if (serviceAccountPath) {
    if (!existsSync(serviceAccountPath)) {
      throw new Error(`Service account não encontrada: ${serviceAccountPath}`);
    }
    const raw = JSON.parse(readFileSync(serviceAccountPath, "utf8"));
    return initializeApp({ credential: cert(raw) }, "flags-activation");
  }

  return initializeApp(undefined, "flags-activation");
}

const FLAG_SETS: Record<Mode, Record<string, boolean>> = {
  pilot: {
    forms_navigation_api_enabled: true,
  },
  full: {
    forms_navigation_api_enabled: true,
    forms_new_engine_enabled: true,
    forms_legacy_dual_write_enabled: true,
  },
  finalize: {
    forms_navigation_api_enabled: true,
    forms_new_engine_enabled: true,
    forms_legacy_dual_write_enabled: false,
    forms_read_from_legacy_enabled: false,
  },
  rollback: {
    forms_navigation_api_enabled: false,
    forms_new_engine_enabled: false,
    forms_legacy_dual_write_enabled: false,
    forms_read_from_legacy_enabled: false,
  },
};

async function main() {
  const { mode, serviceAccountPath } = parseArgs(process.argv.slice(2));
  const app = initAdmin(serviceAccountPath);
  const db = getFirestore(app, "coala");

  const flags = FLAG_SETS[mode];

  console.log(`\n🚀 Modo: ${mode.toUpperCase()}`);
  console.log("Flags a aplicar:");
  for (const [key, enabled] of Object.entries(flags)) {
    console.log(`  ${enabled ? "✅" : "❌"} ${key} = ${enabled}`);
  }

  const batch = db.batch();
  for (const [key, enabled] of Object.entries(flags)) {
    const ref = db.collection("feature_flags").doc(key);
    batch.set(ref, { key, enabled, updated_at: new Date().toISOString() }, { merge: true });
  }

  await batch.commit();
  console.log(`\n✅ ${Object.keys(flags).length} flag(s) gravada(s) com sucesso.`);

  if (mode === "pilot") {
    console.log("\nPróximo passo: valide o dashboard em /dashboard/forms por 48h.");
    console.log("Quando pronto, rode --full para ativar o cutover completo.");
  } else if (mode === "full") {
    console.log("\nCutover ativado. Dual-write ativo — mantenha por 2 semanas antes de desativar.");
    console.log("Para emergência: rode --rollback.");
  } else if (mode === "finalize") {
    console.log("\nMigração finalizada. Escritas e leituras do legado foram desligadas.");
    console.log("Para emergência: rode --rollback.");
  } else {
    console.log("\nTodas as flags de forms foram desativadas. Sistema retornou ao modo legado.");
  }
}

main().catch((err) => {
  console.error("ERRO:", err.message);
  process.exit(1);
});
