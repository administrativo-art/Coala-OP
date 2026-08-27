import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { saveEntityPaymentProfile } from "../src/features/financial/beneficiaries/repository.server";
import { dbAdmin } from "../src/lib/firebase-admin";
import { financialDbAdmin } from "../src/lib/firebase-financial-admin";
import { hrDbAdmin } from "../src/lib/firebase-rh-admin";

const EXECUTE = process.argv.includes("--execute");
const RESUME = process.argv.includes("--resume");
const SKIP_PAYMENT = process.argv.includes("--skip-payment");
const MIGRATION_ID = "company-department-contacts-v1-20260805";
const ACTOR = { uid: "system:codex", name: "Codex", email: null };
const MAXIMUS_EMAIL = "jessyca@grupomse.com";
const MEDCLINIC_EMAIL = "recepcao@medclinicsaoluis.com.br";
const MEDCLINIC_CNPJ = "29696755000154";
const MEDCLINIC_ENTITY_ID = `medclinic-${MEDCLINIC_CNPJ}`;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function upsertDepartmentEmail(
  contactValue: unknown,
  entry: { id: string; department: string; email: string; purposes: string[] },
) {
  const contact = asRecord(contactValue);
  const emails = Array.isArray(contact.emails)
    ? contact.emails.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const withoutCurrent = emails.filter((item) => normalized(item.email) !== normalized(entry.email));
  return { ...contact, emails: [...withoutCurrent, entry] };
}

const [entities, onboardingProcesses, terminationProcesses] = await Promise.all([
  dbAdmin.collection("entities").get(),
  hrDbAdmin.collection("onboardingProcesses").get(),
  hrDbAdmin.collection("terminationProcesses").get(),
]);

const maximusMatches = entities.docs.filter((document) => {
  const text = normalized([document.get("name"), document.get("fantasyName")].join(" "));
  return text.includes("maximus") && text.includes("contab");
});
if (maximusMatches.length !== 1) {
  throw new Error(`Esperado exatamente um cadastro da Máximus Contabilidade; encontrados ${maximusMatches.length}.`);
}
const maximus = maximusMatches[0];
const medclinicExisting = entities.docs.find((document) => {
  const documentNumber = String(document.get("cnpj") ?? document.get("document") ?? "").replace(/\D/g, "");
  return documentNumber === MEDCLINIC_CNPJ;
});
const medclinicId = medclinicExisting?.id ?? MEDCLINIC_ENTITY_ID;
const paymentProfile = await financialDbAdmin.collection("supplierPaymentProfiles").doc(medclinicId).get();

const activeOnboarding = onboardingProcesses.docs.filter((document) => !["completed", "cancelled"].includes(String(document.get("status") ?? "")));
const activeTerminations = terminationProcesses.docs.filter((document) => !["completed", "cancelled"].includes(String(document.get("status") ?? "")));

console.table([
  { item: "Máximus · Pessoal", cadastro: maximus.id, email: MAXIMUS_EMAIL, finalidade: "Integração e desligamento" },
  { item: "Medclinic · Recepção", cadastro: medclinicId, email: MEDCLINIC_EMAIL, finalidade: "ASO" },
  { item: "Medclinic · PIX CNPJ", cadastro: medclinicId, email: "29.696.755/0001-54", finalidade: paymentProfile.exists ? "Perfil já existe" : "Criar e validar" },
]);
console.log(`Backfill: ${activeOnboarding.length} integração(ões) ativa(s) e ${activeTerminations.length} desligamento(s) ativo(s).`);

if (!EXECUTE) {
  console.log(`DRY-RUN: a migração ${MIGRATION_ID} não gravou dados. Use --execute para aplicar.`);
  process.exit(0);
}

const backupRef = dbAdmin.collection("system_migration_backups").doc(MIGRATION_ID);
const backup = await backupRef.get();
if (backup.exists && !RESUME) throw new Error(`A migração ${MIGRATION_ID} já foi iniciada. Use --resume somente para concluir etapas pendentes.`);
if (paymentProfile.exists && paymentProfile.get("maskedPaymentDestination")) {
  throw new Error("A Medclinic já possui destino financeiro configurado; atualização automática bloqueada para evitar sobrescrita.");
}

const now = new Date();
const nowIso = now.toISOString();
const maximusContact = upsertDepartmentEmail(maximus.get("contact"), {
  id: "pessoal-processos-rh",
  department: "Pessoal",
  email: MAXIMUS_EMAIL,
  purposes: ["onboarding", "termination"],
});
const medclinicContact = upsertDepartmentEmail(medclinicExisting?.get("contact"), {
  id: "recepcao-aso",
  department: "Recepção",
  email: MEDCLINIC_EMAIL,
  purposes: ["aso"],
});

const entityBatch = dbAdmin.batch();
const medclinicRef = dbAdmin.collection("entities").doc(medclinicId);
const auditRef = dbAdmin.collection("actionLogs").doc();
if (!backup.exists) {
  entityBatch.create(backupRef, {
    migration: MIGRATION_ID,
    createdAt: FieldValue.serverTimestamp(),
    maximus: { id: maximus.id, contactBefore: maximus.get("contact") ?? null },
    medclinic: { id: medclinicId, existed: Boolean(medclinicExisting), dataBefore: medclinicExisting?.data() ?? null },
    activeOnboardingIds: activeOnboarding.map((document) => document.id),
    activeTerminationIds: activeTerminations.map((document) => document.id),
  });
  entityBatch.set(maximus.ref, { contact: maximusContact, updatedAt: nowIso, updatedBy: ACTOR.uid }, { merge: true });
  entityBatch.set(medclinicRef, {
    type: "pessoa_juridica",
    name: "MEDCLINIC+ SAUDE E SEGURANCA DO TRABALHO LTDA",
    fantasyName: "Medclinic +",
    nickname: "Medclinic SLZ",
    document: "29.696.755/0001-54",
    documentNormalized: MEDCLINIC_CNPJ,
    cnpj: MEDCLINIC_CNPJ,
    razao_social: "MEDCLINIC+ SAUDE E SEGURANCA DO TRABALHO LTDA",
    nome_fantasia: "Medclinic +",
    status: "active",
    situacao_cadastral: "ATIVA",
    data_abertura: "2018-02-16",
    natureza_juridica: "206-2 - Sociedade Empresária Limitada",
    cnae_principal_codigo: "8660700",
    cnae_principal_descricao: "Atividades de apoio à gestão de saúde",
    address: {
      street: "Avenida Getúlio Vargas",
      number: "43",
      complement: "",
      neighborhood: "Monte Castelo",
      city: "São Luís",
      state: "MA",
      zipCode: "65030-005",
    },
    cep: "65030-005",
    logradouro: "Avenida Getúlio Vargas",
    numero: "43",
    bairro: "Monte Castelo",
    cidade: "São Luís",
    uf: "MA",
    contact: { ...medclinicContact, email: MEDCLINIC_EMAIL },
    email: MEDCLINIC_EMAIL,
    origem_dados: "manual",
    data_ultima_consulta_cnpj: nowIso,
    updatedAt: nowIso,
    updatedBy: ACTOR.uid,
    ...(medclinicExisting ? {} : { workspaceId: "coala", createdAt: nowIso, createdBy: ACTOR.uid }),
  }, { merge: true });
  entityBatch.set(auditRef, {
    workspace_id: "coala",
    user_id: ACTOR.uid,
    username: ACTOR.name,
    module: "entities.contacts",
    action: "company_department_contacts_migrated",
    metadata: { migration: MIGRATION_ID, maximusId: maximus.id, medclinicId },
    ip_address: null,
    timestamp: Timestamp.fromDate(now),
    ttl: Timestamp.fromDate(new Date(now.getTime() + 365 * 86400000)),
  });
  await entityBatch.commit();
} else {
  console.log(`RETOMADA: backup ${MIGRATION_ID} localizado; cadastros centrais não serão regravados.`);
}

if (!SKIP_PAYMENT) {
  await saveEntityPaymentProfile(medclinicId, {
    active: true,
    paymentMethod: "pix_key",
    pixKeyType: "cnpj",
    pixKey: MEDCLINIC_CNPJ,
    holderName: "MEDCLINIC+ SAUDE E SEGURANCA DO TRABALHO LTDA",
    holderDocument: MEDCLINIC_CNPJ,
    validated: true,
    keepExistingDestination: false,
  }, ACTOR);
} else {
  console.log("PENDENTE: perfil PIX não foi gravado porque o segredo de criptografia não está disponível localmente.");
}

const onboardingBatch = hrDbAdmin.batch();
for (const process of activeOnboarding) {
  const workflow = asRecord(process.get("accountantWorkflow"));
  onboardingBatch.set(process.ref, {
    accountantWorkflow: {
      ...workflow,
      suggestedRecipientEmail: MAXIMUS_EMAIL,
      suggestedRecipientDepartment: "Pessoal",
      suggestedRecipientCompanyId: maximus.id,
      suggestedRecipientCompanyName: String(maximus.get("fantasyName") ?? maximus.get("name") ?? "Máximus Contabilidade"),
    },
    updatedAt: process.get("updatedAt") ?? nowIso,
  }, { merge: true });
}
await onboardingBatch.commit();

const terminationBatch = hrDbAdmin.batch();
for (const process of activeTerminations) {
  const accountant = asRecord(process.get("accountant"));
  terminationBatch.set(process.ref, {
    accountant: {
      ...accountant,
      recipientEmail: String(accountant.recipientEmail ?? "").trim() || MAXIMUS_EMAIL,
    },
  }, { merge: true });
}
await terminationBatch.commit();

console.log(`APLICADO: contatos setoriais e vínculos dos processos. Backup ${MIGRATION_ID}.${SKIP_PAYMENT ? " Perfil PIX pendente." : " Perfil PIX da Medclinic validado."}`);
