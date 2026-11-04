import { subjectKey, type SubjectRef } from "./person-subject";

/** IDs come from the owning process and explicit signer/actor records, never contact details. */
export function signaturePersonFields(input: {
  subject: SubjectRef;
  employeeSigns?: boolean;
  companySignerUserId?: string | null;
  actorUserId?: string | null;
}) {
  const subject = subjectKey(input.subject);
  const signerKeys = input.employeeSigns ? [subject] : [];
  if (input.companySignerUserId) signerKeys.push(subjectKey({ namespace: "main.users", id: input.companySignerUserId }));
  return {
    subjectKeys: [subject],
    signerKeys: [...new Set(signerKeys)],
    actorKeys: input.actorUserId ? [subjectKey({ namespace: "main.users", id: input.actorUserId })] : [],
  };
}
