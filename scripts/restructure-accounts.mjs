/**
 * Reestrutura a coleção `accounts` no Firestore `coala-financeiro`.
 *
 * Uso:
 *   node scripts/restructure-accounts.mjs --dry   → imprime estado atual
 *   node scripts/restructure-accounts.mjs         → aplica as mudanças
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const sa = JSON.parse(
  readFileSync("scripts/smart-converter-752gf-firebase-adminsdk-fbsvc-aaa18b4778.json", "utf8")
);
const app =
  getApps().find((a) => a.name === "fin") ??
  initializeApp({ credential: cert(sa) }, "fin");
const db = getFirestore(app, "coala-financeiro");

const DRY = process.argv.includes("--dry");
const ts = FieldValue.serverTimestamp();

// ── batch helpers ─────────────────────────────────────────────────────────────

const batches = [];
let cur = db.batch();
let opCount = 0;

function b() {
  if (opCount >= 480) { batches.push(cur); cur = db.batch(); opCount = 0; }
  opCount++;
  return cur;
}

function up(id, data) { b().update(db.collection("accounts").doc(id), { ...data, updatedAt: ts }); }
function del(id) { b().delete(db.collection("accounts").doc(id)); }
function mk(data) {
  const ref = db.collection("accounts").doc();
  b().set(ref, { ...data, createdAt: ts, updatedAt: ts });
  return ref.id;
}

async function commit() {
  batches.push(cur);
  for (const bt of batches) await bt.commit();
  console.log(`\n✓ Committed ${batches.length} batch(es).`);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const snap = await db.collection("accounts").get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`\nLoaded ${all.length} accounts\n`);

  // ── helpers ───────────────────────────────────────────────────────────────

  function byName(name) {
    const k = name.trim().toLowerCase();
    return all.find((a) => a.name?.trim().toLowerCase() === k) ?? null;
  }

  function rootGroup(key) {
    const k = key.trim().toLowerCase();
    return (
      all.find(
        (a) =>
          !a.parentId &&
          (a.name?.trim().toLowerCase() === k || a.group?.trim().toLowerCase() === k)
      ) ?? null
    );
  }

  // ── print tree (always available) ────────────────────────────────────────

  function printTree(parentId, depth) {
    const children = all
      .filter((a) => (a.parentId ?? null) === (parentId ?? null))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const c of children) {
      console.log(`${"  ".repeat(depth)}• ${c.name}  [${c.id.slice(0, 7)}]  dre=${c.dre_position ?? "—"}`);
      printTree(c.id, depth + 1);
    }
  }

  if (DRY) {
    console.log("=== ÁRVORE ATUAL ===\n");
    printTree(null, 0);
    console.log("\n[DRY] Nenhuma alteração feita.");
    return;
  }

  // ── validate roots ────────────────────────────────────────────────────────

  const rhRoot = rootGroup("recursos humanos") ?? rootGroup("rh");
  const adminRoot = rootGroup("administrativo");
  const mktRoot = rootGroup("marketing");
  const techRoot = rootGroup("tecnologia");
  const ocupRoot = rootGroup("ocupação") ?? rootGroup("ocupacao");
  const fiscalRoot = rootGroup("impostos e deduções") ?? rootGroup("impostos e deducoes") ?? rootGroup("fiscal");
  const insumosRoot = rootGroup("custos variáveis") ?? rootGroup("custos variaveis") ?? rootGroup("insumos");

  const required = { rhRoot, adminRoot, mktRoot, techRoot, ocupRoot, fiscalRoot, insumosRoot };
  for (const [k, v] of Object.entries(required)) {
    if (!v) throw new Error(`Root group not found: ${k}`);
  }

  // ── helper: ensure sub-group ──────────────────────────────────────────────

  const sgCache = {};
  function ensureSg(name, parentId, order, dre = null) {
    const cacheKey = `${parentId}:${name}`;
    if (sgCache[cacheKey]) return sgCache[cacheKey];
    const existing = all.find(
      (a) => a.name?.trim().toLowerCase() === name.trim().toLowerCase() && a.parentId === parentId
    );
    if (existing) {
      up(existing.id, { order, dre_position: dre });
      sgCache[cacheKey] = existing.id;
      return existing.id;
    }
    const id = mk({ name, parentId, order, dre_position: dre, active: true });
    sgCache[cacheKey] = id;
    console.log(`  + sub-grupo criado: ${name}`);
    return id;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 1. RECURSOS HUMANOS
  // ════════════════════════════════════════════════════════════════════════════
  console.log("→ Recursos Humanos");

  const folhaId = ensureSg("Folha de pagamento", rhRoot.id, 0, "pessoal");

  for (const [name, ord] of [["Salários", 0], ["INSS patronal", 1], ["FGTS", 2]]) {
    const a = byName(name);
    if (a) up(a.id, { parentId: folhaId, order: ord, dre_position: "pessoal" });
    else console.warn(`  [!] Não encontrado: ${name}`);
  }

  for (const [name, ord] of [["Vale-transporte", 1], ["Plano odontológico", 2], ["Vale alimentação", 3]]) {
    const a = byName(name);
    if (a) up(a.id, { parentId: rhRoot.id, order: ord, dre_position: "pessoal" });
    else console.warn(`  [!] Não encontrado: ${name}`);
  }

  const contrib = byName("Contribuição sindical");
  if (contrib) up(contrib.id, { parentId: rhRoot.id, order: 4, dre_position: "pessoal" });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. ADMINISTRATIVO
  // ════════════════════════════════════════════════════════════════════════════
  console.log("→ Administrativo");

  // Manutenção e conservação vira sub-grupo (mantém o id — despesas existentes ok)
  const manutId = byName("Manutenção e conservação")?.id;
  if (manutId) {
    up(manutId, { parentId: adminRoot.id, order: 0, dre_position: "despesas_operacionais" });
    mk({ name: "Manutenção da máquina de sorvete", parentId: manutId, order: 0, dre_position: "despesas_operacionais", active: true });
    console.log("  + Manutenção da máquina de sorvete");
  }

  // Terceirizados
  const terceId = ensureSg("Terceirizados", adminRoot.id, 1, "despesas_operacionais");
  const terRH = byName("Terceirizados — RH / financeiro") ?? byName("Terceirizados - RH / financeiro");
  if (terRH) up(terRH.id, { name: "Recursos Humanos", parentId: terceId, order: 0, dre_position: "despesas_operacionais" });
  mk({ name: "Publicidade e propaganda", parentId: terceId, order: 1, dre_position: "despesas_operacionais", active: true });
  const terLog = byName("Terceirizados — Logística") ?? byName("Terceirizados - Logística");
  if (terLog) up(terLog.id, { name: "Logística", parentId: terceId, order: 2, dre_position: "despesas_operacionais" });

  // Marketing (sub-grupo sob Admin) ← absorve filhos do root de marketing
  const mktSubId = ensureSg("Marketing", adminRoot.id, 2, "despesas_operacionais");
  const mktLeaves = all.filter((a) => a.parentId === mktRoot.id);
  const mktRenames = {
    "agência / terceirizado": "Tercerizado - Propaganda e Marketing",
    "mídia paga / redes sociais": "Redes sociais / mídia paga",
    "influenciadores / parcerias": "Influenciadores | parcerias",
  };
  mktLeaves.forEach((a, idx) => {
    const newName = mktRenames[a.name?.trim().toLowerCase()] ?? a.name;
    up(a.id, { name: newName, parentId: mktSubId, order: idx, dre_position: "despesas_operacionais" });
  });
  if (!mktLeaves.some((a) => a.name?.toLowerCase().includes("propaganda e publicidade"))) {
    mk({ name: "Propaganda e publicidade", parentId: mktSubId, order: mktLeaves.length, dre_position: "despesas_operacionais", active: true });
  }
  del(mktRoot.id); // root de marketing fica vazio; remove
  console.log("  − Marketing root deletado");

  // Frete
  const freteId = ensureSg("Frete", adminRoot.id, 3, "despesas_operacionais");
  const freteMoves = [
    ["Frete — distribuição de insumo",   "Frete de distribuição de insumo",  0],
    ["Frete — aquisição de insumos",     "Frete de adquirir insumos",        1],
    ["Frete — deslocamento de máquinas", "Frete de deslocamento de máquinas",2],
  ];
  for (const [old, novo, ord] of freteMoves) {
    const a = byName(old);
    if (a) up(a.id, { name: novo, parentId: freteId, order: ord, dre_position: "despesas_operacionais" });
    else console.warn(`  [!] Não encontrado: ${old}`);
  }

  // Honorários do contador → direto sob Admin
  const hon = byName("Honorários do contador");
  if (hon) up(hon.id, { parentId: adminRoot.id, order: 4, dre_position: "despesas_operacionais" });

  // ════════════════════════════════════════════════════════════════════════════
  // 3. TECNOLOGIA
  // ════════════════════════════════════════════════════════════════════════════
  console.log("→ Tecnologia");

  // "IA (Gemini, GPT, Claude)" vira "Inteligência artificial" (mantém id)
  const iaOld = byName("IA (Gemini, GPT, Claude)");
  let iaId;
  if (iaOld) {
    up(iaOld.id, { name: "Inteligência artificial", parentId: techRoot.id, order: 0, dre_position: "despesas_operacionais" });
    iaId = iaOld.id;
  } else {
    iaId = ensureSg("Inteligência artificial", techRoot.id, 0, "despesas_operacionais");
  }
  mk({ name: "Gemini",           parentId: iaId, order: 0, dre_position: "despesas_operacionais", active: true });
  mk({ name: "GPT/Codex",        parentId: iaId, order: 1, dre_position: "despesas_operacionais", active: true });
  mk({ name: "Claude/Claude code",parentId: iaId, order: 2, dre_position: "despesas_operacionais", active: true });

  // "Internet / conta de celular" → "Internet" + novo "Conta de celular"
  const intCel = byName("Internet / conta de celular");
  if (intCel) up(intCel.id, { name: "Internet", parentId: techRoot.id, order: 1, dre_position: "despesas_operacionais" });
  mk({ name: "Conta de celular", parentId: techRoot.id, order: 5, dre_position: "despesas_operacionais", active: true });

  for (const [name, ord] of [["Sistema PDV", 2], ["Sinalização digital", 3], ["Sistema RH", 4]]) {
    const a = byName(name);
    if (a) up(a.id, { parentId: techRoot.id, order: ord, dre_position: "despesas_operacionais" });
    else console.warn(`  [!] Não encontrado: ${name}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 4. OCUPAÇÃO
  // ════════════════════════════════════════════════════════════════════════════
  console.log("→ Ocupação");
  const alug = byName("Aluguel");
  if (alug) up(alug.id, { parentId: ocupRoot.id, order: 0, dre_position: "ocupacao" });

  // ════════════════════════════════════════════════════════════════════════════
  // 5. FISCAL
  // ════════════════════════════════════════════════════════════════════════════
  console.log("→ Fiscal");
  const fiscalItems = [
    ["DAS — Simples Nacional",    "DAS",                       0],
    ["DARE — ICMS / ISS avulso",  "DARE",                      1],
    ["Devoluções / cancelamentos","Devoluções / cancelamentos", 2],
    ["Descontos concedidos",      "Descontos concedidos",       3],
  ];
  for (const [old, novo, ord] of fiscalItems) {
    const a = byName(old);
    if (a) up(a.id, { name: novo, parentId: fiscalRoot.id, order: ord, dre_position: "impostos_deducoes" });
    else console.warn(`  [!] Não encontrado: ${old}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 6. INSUMOS
  // ════════════════════════════════════════════════════════════════════════════
  console.log("→ Insumos");
  const cmvAcc = byName("CMV — custo de mercadoria");
  if (cmvAcc) up(cmvAcc.id, { name: "CMV — Custo de mercadoria", parentId: insumosRoot.id, order: 0, dre_position: "custos_variaveis" });
  const insGerais = byName("Insumos gerais");
  if (insGerais) up(insGerais.id, { parentId: insumosRoot.id, order: 1, dre_position: "custos_variaveis" });
  // Frete — aquisição de insumos já foi movido para Admin > Frete acima

  // ── commit ────────────────────────────────────────────────────────────────
  await commit();
}

main().catch((e) => { console.error(e); process.exit(1); });
