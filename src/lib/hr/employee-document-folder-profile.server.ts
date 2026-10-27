import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { employeeDossierTemplate } from "@/lib/hr/employee-document-folder-templates";
import type { EmployeeDossierFolder, EmployeeDossierTemplateId } from "@/lib/hr/employee-document-folder-templates";

const COLLECTION = "employeeDocumentFolderProfiles";

export type EmployeeDocumentFolderProfile = {
  id: string;
  employeeId: string;
  templateId: EmployeeDossierTemplateId | null;
  templateVersion: number | null;
  templateLabel: string | null;
  folders: EmployeeDossierFolder[];
  sourceRelationshipType?: unknown;
};

export async function ensureEmployeeDocumentFolderProfile(input: {
  employeeId: string;
  relationshipType: unknown;
  actorId: string;
  source: string;
}) {
  const template = employeeDossierTemplate(input.relationshipType);
  const now = Timestamp.now();
  const ref = hrDbAdmin.collection(COLLECTION).doc(input.employeeId);
  const current = await ref.get();
  const currentData = current.data() ?? {};
  if (!template) {
    if (!current.exists) return null;
    const payload = {
      employeeId: input.employeeId,
      templateId: null,
      templateVersion: null,
      templateLabel: null,
      folders: [],
      sourceRelationshipType: input.relationshipType,
      updatedAt: now,
      updatedBy: input.actorId,
      source: input.source,
    };
    await ref.set(payload, { merge: true });
    await ref.collection("audit").add({
      action: "FOLDER_TEMPLATE_WITHDRAWN",
      previousTemplateId: currentData.templateId ?? null,
      actorId: input.actorId,
      source: input.source,
      at: now,
    });
    return { id: ref.id, ...currentData, ...payload };
  }
  if (current.exists && current.get("templateId") === template.id && current.get("templateVersion") === template.version) {
    return { id: ref.id, ...current.data() };
  }
  const payload = {
    employeeId: input.employeeId,
    templateId: template.id,
    templateVersion: template.version,
    templateLabel: template.label,
    folders: template.folders,
    sourceRelationshipType: input.relationshipType,
    createdAt: currentData.createdAt ?? now,
    createdBy: currentData.createdBy ?? input.actorId,
    updatedAt: now,
    updatedBy: input.actorId,
    source: input.source,
  };
  await ref.set(payload, { merge: true });
  await ref.collection("audit").add({
    action: current.exists ? "FOLDER_TEMPLATE_RECONCILED" : "FOLDER_TEMPLATE_CREATED",
    templateId: template.id,
    templateVersion: template.version,
    actorId: input.actorId,
    source: input.source,
    at: now,
  });
  return { id: ref.id, ...payload };
}

export async function readEmployeeDocumentFolderProfile(employeeIds: string[]): Promise<EmployeeDocumentFolderProfile | null> {
  const ids = [...new Set(employeeIds.map((id) => id.trim()).filter(Boolean))].slice(0, 10);
  if (!ids.length) return null;
  const snapshots = await hrDbAdmin.getAll(...ids.map((id) => hrDbAdmin.collection(COLLECTION).doc(id)));
  const snapshot = snapshots.find((entry) => entry.exists);
  if (!snapshot) return null;
  const data = snapshot.data() as Omit<EmployeeDocumentFolderProfile, "id">;
  return { id: snapshot.id, ...data };
}
