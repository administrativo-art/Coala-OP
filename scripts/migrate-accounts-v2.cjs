/**
 * migrate-accounts-v2.js
 * Reorganização do plano de contas — idempotente (pode rodar N vezes).
 * Estratégia: antes de criar, verifica se já existe por nome+parentId.
 * Se existir, atualiza. Se não existir, cria.
 */

const admin = require("firebase-admin");
const serviceAccount = require("./smart-converter-752gf-firebase-adminsdk-fbsvc-aaa18b4778.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.settings({ databaseId: "coala-financeiro" });
const col = db.collection("accounts");
const { FieldValue } = require("firebase-admin/firestore");

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getAllAccounts() {
  const snap = await col.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Upsert: cria se não existe (mesmo nome + mesmo parentId), ou atualiza se existe */
async function upsert(accounts, { name, parentId = null, ...fields }) {
  const existing = accounts.find(
    (a) => a.name === name && (a.parentId ?? null) === (parentId ?? null)
  );
  const now = FieldValue.serverTimestamp();
  if (existing) {
    await col.doc(existing.id).update({ ...fields, updatedAt: now });
    console.log(`  ✓ atualizado  "${name}" (${existing.id})`);
    return existing.id;
  } else {
    const ref = await col.add({ name, parentId: parentId ?? null, ...fields, createdAt: now, updatedAt: now });
    console.log(`  + criado      "${name}" (${ref.id})`);
    // Refresh accounts list so subsequent upserts within same run find new docs
    accounts.push({ id: ref.id, name, parentId: parentId ?? null, ...fields });
    return ref.id;
  }
}

/** Atualiza diretamente por ID */
async function updateById(id, fields, label) {
  await col.doc(id).update({ ...fields, updatedAt: FieldValue.serverTimestamp() });
  console.log(`  ✓ updateById  "${label}" (${id})`);
}

// ─── IDs fixos conhecidos ──────────────────────────────────────────────────────
const IDS = {
  // Grupos raiz
  receita:          "NpcxtFTHl32Ps6uqp0yW",
  impostosDeducoes: "up2PMc0mBAebiMY8WPf6",
  insumos:          "iY5kCB0AlUUQ3qp9dSZR",   // → renomear para Custos Variáveis Complementares
  rh:               "7t4lyWptModFanNqFslF",
  administrativo:   "rtmp6WKQJnfCckGln7cb",
  tecnologia:       "M2i1rNAK8o7LvIXABcHa",
  ocupacao:         "eJSGpy4FPRVnVVAfm5h6",
  financeiro:       "FdRh9aU1Z6UYqNyNJKP0",
  naoOperacional:   "H4OaY9v17K6om2edji0N",
  irCsll:           "EU4LpX30R0oVs4Z15cti",
  ativoImobilizado: "CDqq0Jokn59O0tWf2AVX",
  aplicacoes:       "LWspK5UYcB9ehd3IIh2F",

  // Contas específicas
  cmvConta:         "IqaYLNxMtwflZgy5kL3S",   // CMV — Custo de mercadoria → renomear
  insumosComposicao:"OofGtZoVn15nmmy2xaI8",   // → mover para estoque
  folhaPagamento:   "XVP0TluLmvkBpHrnfpZ3",
  manutencao:       "0wikce520QUhEVsv37E7",
  marketing:        "jY3tReCGgBnFlOG3mnOF",
  terceirizados:    "N5ROKLTPcH6mOXOiBDat",

  // Patrimoniais — filhos de ativoImobilizado
  equip:            "6KgVwllAo3unPAaIvspW",
  moveis:           "xo8Y6XtHjpRvCKN8yXoI",
  ti:               "4AANIpelMFaw9QJdcRGX",
  obras:            "gzxmUClqou6F1SKaa6G1",

  // Patrimoniais — filhos de aplicacoes
  rendaFixa:        "yEsWZSVtl5fIU4fVaWOp",
  reservaCaixa:     "e3Zhtk5bL1CjmPBE2jal",
  cdb:              "p3yNvBlcIOGJsAVxMWMi",

  // Marketing — duplicatas
  publicidadePropaganda: "bT7aoZU0ElkpUDNddE5i",  // → inativar
  propagandaPublicidade: "Y0iZa4LzOFFg0eJAzNHN",  // → manter
  terceirizadoMarketing: "pus3owlnyqoBh9kGIUdi",  // → corrigir typo
};

// ─── main ──────────────────────────────────────────────────────────────────────

async function run() {
  let accounts = await getAllAccounts();
  console.log(`\n📋 Total de contas encontradas: ${accounts.length}\n`);

  // ════════════════════════════════════════════════════════
  // 1. RENOMEAR "Insumos" → "Custos Variáveis Complementares"
  // ════════════════════════════════════════════════════════
  console.log("1. Renomeando grupo Insumos → Custos Variáveis Complementares...");
  await updateById(IDS.insumos, { name: "Custos Variáveis Complementares" }, "Insumos");

  // ════════════════════════════════════════════════════════
  // 2. RENOMEAR "CMV — Custo de mercadoria" → "Ajustes de CMV / perdas não previstas"
  // ════════════════════════════════════════════════════════
  console.log("\n2. Renomeando CMV manual...");
  await updateById(IDS.cmvConta, {
    name: "Ajustes de CMV / perdas não previstas",
    dre_position: "custos_variaveis",
    is_dre_account: true,
  }, "CMV — Custo de mercadoria");

  // ════════════════════════════════════════════════════════
  // 3. CRIAR GRUPO "Estoque / Compras de Insumos" (patrimonial)
  //    Usar ID fixo para facilitar verificação futura
  // ════════════════════════════════════════════════════════
  console.log("\n3. Criando/atualizando grupo Estoque / Compras de Insumos...");
  const estoqueGroupId = "estoque_compras_insumos_v2";
  const estoqueSnap = await col.doc(estoqueGroupId).get();
  if (!estoqueSnap.exists) {
    await col.doc(estoqueGroupId).set({
      name: "Estoque / Compras de Insumos",
      parentId: null,
      isGroup: true,
      order: 5,
      active: true,
      dre_position: null,
      is_dre_account: false,
      group: "estoque",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`  + criado (ID fixo: ${estoqueGroupId})`);
    accounts.push({ id: estoqueGroupId, name: "Estoque / Compras de Insumos", parentId: null });
  } else {
    await col.doc(estoqueGroupId).update({
      is_dre_account: false,
      group: "estoque",
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`  ✓ já existe, atualizado`);
  }

  // ════════════════════════════════════════════════════════
  // 4. MOVER "Insumos composição" → grupo Estoque
  // ════════════════════════════════════════════════════════
  console.log("\n4. Movendo Insumos composição para grupo Estoque...");
  await updateById(IDS.insumosComposicao, {
    parentId: estoqueGroupId,
    dre_position: null,
    is_dre_account: false,
    group: "estoque",
  }, "Insumos composição");

  // ════════════════════════════════════════════════════════
  // 5. NOVOS FILHOS do grupo Estoque
  // ════════════════════════════════════════════════════════
  console.log("\n5. Adicionando contas de estoque...");
  // Refresh accounts (Insumos composição agora tem parentId diferente)
  accounts = await getAllAccounts();
  const estoqueFilhos = [
    { name: "Embalagens de venda compradas para estoque", order: 1 },
    { name: "Toppings, caldas e complementos", order: 2 },
    { name: "Produtos de revenda", order: 3 },
    { name: "Compras de mercadorias para estoque", order: 4 },
  ];
  for (const f of estoqueFilhos) {
    await upsert(accounts, {
      name: f.name,
      parentId: estoqueGroupId,
      order: f.order,
      active: true,
      dre_position: null,
      is_dre_account: false,
      group: "estoque",
    });
  }

  // ════════════════════════════════════════════════════════
  // 6. NOVOS FILHOS do grupo Custos Variáveis Complementares
  // ════════════════════════════════════════════════════════
  console.log("\n6. Adicionando contas de Custos Variáveis Complementares...");
  accounts = await getAllAccounts();
  const custVarFilhos = [
    { name: "Perdas extraordinárias de insumos", order: 2 },
    { name: "Ajustes de inventário", order: 3 },
    { name: "Fretes variáveis não incluídos no produto", order: 4 },
    { name: "Embalagens avulsas fora da ficha técnica", order: 5 },
    { name: "Outros custos variáveis complementares", order: 6 },
  ];
  for (const f of custVarFilhos) {
    await upsert(accounts, {
      name: f.name,
      parentId: IDS.insumos,
      order: f.order,
      active: true,
      dre_position: "custos_variaveis",
      is_dre_account: true,
      group: "insumos",
    });
  }

  // ════════════════════════════════════════════════════════
  // 7. RECURSOS HUMANOS — comissões e bonificações sob Folha
  // ════════════════════════════════════════════════════════
  console.log("\n7. Adicionando Comissões e Bonificações em Folha de Pagamento...");
  accounts = await getAllAccounts();
  await upsert(accounts, {
    name: "Comissões de colaboradores",
    parentId: IDS.folhaPagamento,
    order: 3,
    active: true,
    dre_position: "pessoal",
    is_dre_account: true,
    group: "rh",
  });
  await upsert(accounts, {
    name: "Bonificações / premiações de equipe",
    parentId: IDS.folhaPagamento,
    order: 4,
    active: true,
    dre_position: "pessoal",
    is_dre_account: true,
    group: "rh",
  });

  // ════════════════════════════════════════════════════════
  // 8. OCUPAÇÃO — energia, água, condomínio, IPTU
  // ════════════════════════════════════════════════════════
  console.log("\n8. Adicionando contas de Ocupação...");
  accounts = await getAllAccounts();
  const ocupacaoFilhos = [
    { name: "Condomínio", order: 1 },
    { name: "Energia elétrica", order: 2 },
    { name: "Água", order: 3 },
    { name: "IPTU / taxas do ponto", order: 4 },
  ];
  for (const f of ocupacaoFilhos) {
    await upsert(accounts, {
      name: f.name,
      parentId: IDS.ocupacao,
      order: f.order,
      active: true,
      dre_position: "ocupacao",
      is_dre_account: true,
      group: "ocupacao",
    });
  }

  // ════════════════════════════════════════════════════════
  // 9. FINANCEIRO — taxas de cartão e antecipação
  // ════════════════════════════════════════════════════════
  console.log("\n9. Adicionando Taxas de cartão e Antecipação ao Financeiro...");
  accounts = await getAllAccounts();
  await upsert(accounts, {
    name: "Taxas de cartão",
    parentId: IDS.financeiro,
    order: 3,
    active: true,
    dre_position: "despesas_financeiras",
    is_dre_account: true,
    group: "financeiro",
  });
  await upsert(accounts, {
    name: "Taxas de antecipação de recebíveis",
    parentId: IDS.financeiro,
    order: 4,
    active: true,
    dre_position: "despesas_financeiras",
    is_dre_account: true,
    group: "financeiro",
  });

  // ════════════════════════════════════════════════════════
  // 10. MANUTENÇÃO — novos filhos
  // ════════════════════════════════════════════════════════
  console.log("\n10. Adicionando contas de Manutenção...");
  accounts = await getAllAccounts();
  await upsert(accounts, {
    name: "Manutenção de equipamentos",
    parentId: IDS.manutencao,
    order: 1,
    active: true,
    dre_position: "despesas_operacionais",
    is_dre_account: true,
    group: "administrativo",
  });
  await upsert(accounts, {
    name: "Pequenos reparos da unidade",
    parentId: IDS.manutencao,
    order: 2,
    active: true,
    dre_position: "despesas_operacionais",
    is_dre_account: true,
    group: "administrativo",
  });

  // ════════════════════════════════════════════════════════
  // 11. ADMINISTRATIVO — novos filhos operacionais
  // ════════════════════════════════════════════════════════
  console.log("\n11. Adicionando Materiais de limpeza e consumo...");
  accounts = await getAllAccounts();
  const adminFilhos = [
    { name: "Materiais de limpeza", order: 5 },
    { name: "Utensílios e itens operacionais", order: 6 },
    { name: "Materiais de consumo da operação", order: 7 },
  ];
  for (const f of adminFilhos) {
    await upsert(accounts, {
      name: f.name,
      parentId: IDS.administrativo,
      order: f.order,
      active: true,
      dre_position: "despesas_operacionais",
      is_dre_account: true,
      group: "administrativo",
    });
  }

  // ════════════════════════════════════════════════════════
  // 12. DEPRECIAÇÃO (inativa, prevista para o futuro)
  // ════════════════════════════════════════════════════════
  console.log("\n12. Criando conta de Depreciação (inativa)...");
  accounts = await getAllAccounts();
  await upsert(accounts, {
    name: "Depreciação de ativo imobilizado",
    parentId: IDS.administrativo,
    order: 99,
    active: false,
    dre_position: "despesas_operacionais",
    is_dre_account: true,
    group: "administrativo",
  });

  // ════════════════════════════════════════════════════════
  // 13. CORRIGIR TYPO: "Tercerizado" → "Terceirizado"
  // ════════════════════════════════════════════════════════
  console.log("\n13. Corrigindo typo Tercerizado...");
  await updateById(IDS.terceirizadoMarketing, {
    name: "Terceirizado - Propaganda e Marketing",
  }, "Tercerizado - Propaganda e Marketing");

  // ════════════════════════════════════════════════════════
  // 14. DEDUPLICAR Marketing — inativar "Publicidade e propaganda"
  //     Manter "Propaganda e publicidade" (Y0iZa4LzOFFg0eJAzNHN)
  //     Nota: contas inativas continuam resolvidas no accountDrePosMap (sem filtro active)
  // ════════════════════════════════════════════════════════
  console.log("\n14. Inativando conta duplicada de Publicidade...");
  await updateById(IDS.publicidadePropaganda, { active: false }, "Publicidade e propaganda");

  // ════════════════════════════════════════════════════════
  // 15. MARCAR is_dre_account: false em ATIVO IMOBILIZADO e filhos
  // ════════════════════════════════════════════════════════
  console.log("\n15. Marcando Ativo Imobilizado como patrimonial...");
  const ativoIds = [
    IDS.ativoImobilizado,
    IDS.equip,
    IDS.moveis,
    IDS.ti,
    IDS.obras,
  ];
  for (const id of ativoIds) {
    await updateById(id, { is_dre_account: false }, id);
  }

  // ════════════════════════════════════════════════════════
  // 16. MARCAR is_dre_account: false em APLICAÇÕES FINANCEIRAS e filhos
  // ════════════════════════════════════════════════════════
  console.log("\n16. Marcando Aplicações Financeiras como patrimonial...");
  const aplicIds = [
    IDS.aplicacoes,
    IDS.rendaFixa,
    IDS.reservaCaixa,
    IDS.cdb,
  ];
  for (const id of aplicIds) {
    await updateById(id, { is_dre_account: false }, id);
  }

  // ════════════════════════════════════════════════════════
  // 17. MARCAR is_dre_account: true em TODOS os outros grupos raiz
  //     (garante consistência em contas antigas sem o campo)
  // ════════════════════════════════════════════════════════
  console.log("\n17. Garantindo is_dre_account: true em grupos de resultado...");
  const dreRootIds = [
    IDS.receita,
    IDS.impostosDeducoes,
    IDS.insumos,
    IDS.rh,
    IDS.administrativo,
    IDS.tecnologia,
    IDS.ocupacao,
    IDS.financeiro,
    IDS.naoOperacional,
    IDS.irCsll,
  ];
  for (const id of dreRootIds) {
    await col.doc(id).update({ is_dre_account: true, updatedAt: FieldValue.serverTimestamp() });
  }
  // Propagar is_dre_account: true para todos os filhos desses grupos raiz
  accounts = await getAllAccounts();
  const dreRootSet = new Set(dreRootIds);

  function getTopLevelParentId(acc, accountsMap) {
    let current = acc;
    while (current.parentId) {
      current = accountsMap.get(current.parentId) || current;
      if (!current.parentId) break;
    }
    return current.id;
  }

  const accountsMap = new Map(accounts.map((a) => [a.id, a]));
  const toMarkTrue = accounts.filter((a) => {
    if (!a.parentId) return false; // já tratado acima
    const topId = getTopLevelParentId(a, accountsMap);
    return dreRootSet.has(topId) && a.is_dre_account !== true;
  });

  if (toMarkTrue.length > 0) {
    console.log(`   Propagando is_dre_account:true em ${toMarkTrue.length} contas filhas...`);
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    for (const a of toMarkTrue) {
      batch.update(col.doc(a.id), { is_dre_account: true, updatedAt: now });
    }
    await batch.commit();
    console.log("   ✓ propagado");
  } else {
    console.log("   ✓ nada a propagar");
  }

  // ════════════════════════════════════════════════════════
  // RESUMO FINAL
  // ════════════════════════════════════════════════════════
  const finalAccounts = await getAllAccounts();
  const patrimoniais = finalAccounts.filter((a) => a.is_dre_account === false);
  const dreAccounts = finalAccounts.filter((a) => a.is_dre_account === true);
  const semCampo = finalAccounts.filter((a) => a.is_dre_account === undefined);

  console.log("\n════════════════════════════════════════");
  console.log("✅ MIGRAÇÃO CONCLUÍDA");
  console.log(`   Total de contas:   ${finalAccounts.length}`);
  console.log(`   DRE (true):        ${dreAccounts.length}`);
  console.log(`   Patrimoniais(false):${patrimoniais.length}`);
  console.log(`   Sem campo:         ${semCampo.length}`);
  if (semCampo.length > 0) {
    console.log("   Contas sem is_dre_account:");
    semCampo.forEach((a) => console.log(`     - ${a.name} (${a.id})`));
  }
  console.log("════════════════════════════════════════\n");

  process.exit(0);
}

run().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
