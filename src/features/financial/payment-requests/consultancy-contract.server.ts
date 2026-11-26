import { hrDbAdmin } from "@/lib/firebase-rh-admin";

/** Reads only the restricted RH archive metadata; never exposes the signed file or Pix key. */
export async function assertValidatedConsultancyContract(contractDocumentId: string, employeeId: string, scheduledFor: string) {
  if (!/^[a-f0-9-]{32,40}$/i.test(contractDocumentId)) throw new Error("A provisão não tem aditivo assinado identificado.");
  const contract = await hrDbAdmin.collection("employeeDocuments").doc(contractDocumentId).get();
  const fields = contract.data()?.extractedFields ?? {};
  if (!contract.exists || contract.get("deletedAt") || contract.get("employeeId") !== employeeId
    || contract.get("documentTypeCode") !== "SERVICE_PROVIDER_CONTRACT_ADDENDUM"
    || contract.get("status") !== "validated"
    || !/^[a-f0-9]{64}$/i.test(String(contract.get("contentHash") ?? ""))
    || typeof fields.startDate !== "string" || typeof fields.endDate !== "string"
    || fields.startDate > scheduledFor || fields.endDate < scheduledFor) {
    throw new Error("O aditivo assinado não confirma a vigência do pagamento.");
  }
}
