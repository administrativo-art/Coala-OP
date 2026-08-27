import { authAdmin, dbAdmin } from "../src/lib/firebase-admin";
import { formatPersonName } from "../src/lib/person-name";

const apply = process.argv.includes("--apply");

async function main() {
  const snapshot = await dbAdmin.collection("users").get();
  const changes = snapshot.docs
    .map((doc) => {
      const data = doc.data();
      const current = typeof data.username === "string" ? data.username : "";
      const next = formatPersonName(current);
      return { id: doc.id, current, next };
    })
    .filter((item) => item.current && item.next && item.current !== item.next);

  console.log(`${changes.length} nome(s) para normalizar.`);
  for (const item of changes) {
    console.log(`- ${item.id}: "${item.current}" -> "${item.next}"`);
  }

  if (!apply || changes.length === 0) {
    console.log(apply ? "Nenhuma atualização necessária." : "Dry-run apenas. Rode com --apply para atualizar.");
    return;
  }

  let updatedUsers = 0;
  let updatedAuth = 0;
  for (let index = 0; index < changes.length; index += 500) {
    const chunk = changes.slice(index, index + 500);
    const batch = dbAdmin.batch();
    for (const item of chunk) {
      batch.update(dbAdmin.collection("users").doc(item.id), {
        username: item.next,
        nameNormalizedAt: new Date().toISOString(),
      });
    }
    await batch.commit();
    updatedUsers += chunk.length;
  }

  for (const item of changes) {
    try {
      await authAdmin.updateUser(item.id, { displayName: item.next });
      updatedAuth += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Auth displayName nao atualizado para ${item.id}: ${message}`);
    }
  }

  console.log(`Atualizados em users: ${updatedUsers}. Atualizados no Auth: ${updatedAuth}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
