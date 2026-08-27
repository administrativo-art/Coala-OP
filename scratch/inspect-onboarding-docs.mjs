import { config } from "dotenv";

config({ path: ".env.local" });

const { hrDbAdmin } = await import("../src/lib/firebase-rh-admin.ts");

const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error("Informe o e-mail do candidato.");

const snap = await hrDbAdmin
  .collection("onboardingProcesses")
  .where("candidateEmail", "==", email)
  .limit(5)
  .get();

const processes = snap.docs.map((doc) => {
  const data = doc.data();
  const documents = Array.isArray(data.documents) ? data.documents : [];
  return {
    id: doc.id,
    candidateName: data.candidateName ?? null,
    candidateEmail: data.candidateEmail ?? null,
    currentStage: data.currentStage ?? null,
    status: data.status ?? null,
    updatedAt: data.updatedAt ?? null,
    documents: documents.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      hasFile: typeof item.fileUrl === "string" && item.fileUrl.length > 0,
      hasExtractedFields: item.extractedFields && typeof item.extractedFields === "object" && Object.keys(item.extractedFields).length > 0,
    })),
  };
});

console.log(JSON.stringify(processes, null, 2));
