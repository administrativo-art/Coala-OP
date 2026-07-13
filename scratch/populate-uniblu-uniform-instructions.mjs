import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "smart-converter-752gf";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID ?? "coala";
const APPLY = process.argv.includes("--apply");

function getCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH && existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
    return cert(JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8")));
  }

  return applicationDefault();
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function step(id, text) {
  return { id, text };
}

const uniformCareInstructions = [
  {
    id: "lavagem-conservacao",
    name: "Segredos para lavar e conservar.",
    etapas: [
      step("lavar-agua-fria", "Lavar sempre em água fria."),
      step("lavar-avesso", "Lavar a peça do avesso."),
      step("nao-torcer", "Não torcer a roupa, só pressioná-la com suavidade."),
      step("enxaguar-bem", "Enxaguar bem para remover todo o resíduo de sabão ou detergente. O resíduo do sabão pode causar manchas."),
      step("evitar-alvejante", "Evite usar alvejante em camisas brancas. O ideal é deixá-la de molho, de 15 a 20 minutos, em um recipiente com bicarbonato de sódio. A medida é uma colher de bicarbonato para um litro de água."),
      step("evitar-excesso-sabao", "Evite o excesso de sabão em pó. Este produto em excesso acelera o aspecto de envelhecimento das peças."),
    ],
  },
  {
    id: "secagem",
    name: "Secagem",
    etapas: [
      step("secar-sombra-cabide", "Nada de sol. A peça, para continuar linda e impecável, deve secar à sombra e no cabide. É importante deixá-la como se estivesse no guarda-roupa, para que mantenha sua modelagem."),
    ],
  },
  {
    id: "para-guardar",
    name: "Para Guardar",
    etapas: [
      step("guardar-cabide", "Nunca dobre a camisa quando for guardá-la. Coloque-a em um cabide, de preferência um que não tenha abrasivos, que podem estragar a peça."),
    ],
  },
];

const app = getApps()[0] ?? initializeApp({ credential: getCredential(), projectId: PROJECT_ID });
const db = getFirestore(app, DATABASE_ID);

const snapshot = await db.collection("products").get();
const products = snapshot.docs
  .map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }))
  .filter((product) => {
    const brand = normalize(product.brand || product.marca);
    const destination = product.operationalDestination;
    const category = product.category;
    return brand === "uniblu" && (destination === "uniform" || category === "Vestimenta" || category === "Unidade");
  })
  .sort((left, right) => String(left.baseName ?? "").localeCompare(String(right.baseName ?? ""), "pt-BR"));

console.log(`[uniblu-instructions] modo: ${APPLY ? "apply" : "dry-run"}`);
console.log(`[uniblu-instructions] produtos encontrados: ${products.length}`);

for (const product of products) {
  console.log(`- ${product.id}: ${product.baseName} (${product.brand ?? product.marca ?? "sem marca"})`);
}

if (!APPLY || products.length === 0) {
  process.exit(0);
}

const now = new Date().toISOString();
const updates = [];
for (const product of products) {
  updates.push(db.collection("products").doc(product.id));

  for (const collectionName of ["lots", "uniformAssignments", "uniformEvents"]) {
    const relatedSnap = await db.collection(collectionName).where("productId", "==", product.id).get();
    for (const documentSnapshot of relatedSnap.docs) {
      updates.push(documentSnapshot.ref);
    }
  }
}

for (let index = 0; index < updates.length; index += 400) {
  const batch = db.batch();
  for (const ref of updates.slice(index, index + 400)) {
    batch.set(
      ref,
      {
        uniformCareInstructions,
        updatedAt: now,
        updatedBy: "codex-populate-uniblu-uniform-instructions",
      },
      { merge: true },
    );
  }
  await batch.commit();
}

console.log(`[uniblu-instructions] documentos atualizados: ${updates.length}`);
