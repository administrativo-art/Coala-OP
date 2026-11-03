import type { PersonLinkedUser } from "@/lib/hr/person-link";

/** Only exact identifiers already linked to the selected person; never infer by name. */
export function employeeArchiveIds(person: PersonLinkedUser): string[] {
  return [...new Set([person.id, person.hrEmployeeId, person.registrationIdBizneo].filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim()))];
}

export function employeeArchiveChildFolders(paths: readonly string[][], parent: readonly string[]): string[] {
  return [...new Set(paths.filter((path) => parent.every((part, index) => path[index] === part)).map((path) => path[parent.length]).filter(Boolean))];
}

type PackageReference = { id: string; employeeId?: string | null; source?: string | null; documentTypeCode?: string | null; contentHash?: string | null; signatureRequestId?: string | null; sourceOnboardingId?: string | null; originalName?: string | null; mimeType?: string | null; size?: number | null; category?: string | null; accessLevel?: string | null; accessPolicyId?: string | null; publication?: unknown; resolvedVisibility?: unknown; folderCode?: string | null; destinationTrail?: unknown; status?: string | null; version?: number | null };

/** Group only authorized references to the same signed admission package; never delete or merge stored records. */
export function groupSignedAdmissionReferences<T extends PackageReference>(documents: readonly T[]): Array<T & { archiveReferences: string[]; archiveSourceNames: string[] }> {
  const groups = new Map<string, Array<T>>();
  for (const doc of documents) {
    const samePackage = doc.documentTypeCode === "ADMISSION_PACKAGE" && doc.source === "autentique_signature" && doc.employeeId && doc.signatureRequestId && doc.sourceOnboardingId && /^[a-f0-9]{64}$/i.test(doc.contentHash ?? "") && doc.mimeType === "application/pdf";
    const key = samePackage ? JSON.stringify([doc.employeeId, doc.signatureRequestId, doc.sourceOnboardingId, doc.contentHash, doc.size, doc.category, doc.accessLevel, doc.accessPolicyId, doc.publication ?? null, doc.resolvedVisibility ?? null, doc.folderCode, doc.destinationTrail, doc.status, doc.version]) : `document:${doc.id}`;
    const members = groups.get(key) ?? [];
    members.push(doc); groups.set(key, members);
  }
  return [...groups.values()].map((members) => {
    members.sort((a, b) => a.id.localeCompare(b.id));
    return { ...members[0], archiveReferences: members.map((doc) => doc.id), archiveSourceNames: members.map((doc) => doc.originalName ?? "") };
  });
}

/** Published view of the same signed package. Publication times may differ across legacy references;
 * status must already have been checked by the authoritative caller. Keep the representative's original fields. */
export function groupPublishedAdmissionReferences<T extends PackageReference>(documents: readonly T[]): Array<T & { archiveReferences: string[]; archiveSourceNames: string[] }> {
  const originals = new Map(documents.map(document => [document.id, document]));
  return groupSignedAdmissionReferences(documents.map(document => ({
    ...document,
    publication: { status: (document.publication as { status?: unknown } | null)?.status ?? null },
  }))).map(group => ({ ...originals.get(group.id)!, archiveReferences: group.archiveReferences, archiveSourceNames: group.archiveSourceNames }));
}
