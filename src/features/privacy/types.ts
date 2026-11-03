import type { Source } from "./person-inventory";
import type { SubjectRef } from "./person-subject";

export type PrivacyRequestStatus = "open" | "in_review" | "completed" | "rejected";
export type PrivacyRequestType =
  | "access"
  | "correction"
  | "deletion"
  | "information"
  | "consent_revocation"
  | "opposition"
  | "other";

export type PrivacyRequest = {
  id: string;
  workspace_id: string;
  subjectName: string;
  subjectRef: SubjectRef | null;
  subjectEmail: string;
  subjectType: "candidate" | "employee" | "former_employee" | "internal_user" | "supplier" | "other";
  requestType: PrivacyRequestType;
  origin: "email" | "whatsapp" | "in_person" | "phone" | "system" | "other";
  description: string;
  status: PrivacyRequestStatus;
  owner: string | null;
  response: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PersonInventorySource = Source | { id: string; coverage: "restricted" };
export type PersonInventoryCatalog = {
  ref: SubjectRef;
  equivalents: SubjectRef[];
  conflicts: string[];
  sources: PersonInventorySource[];
};
export type PersonInventoryItem = {
  id: string;
  recordPath: string;
  database: Source["database"];
  collection: string;
  role: Source["role"];
  links: Record<string, string>;
  version: string | number | null;
  storageReferences: Array<{ field: string; path: string | null; available: boolean }>;
};
export type PersonInventoryPage = {
  source: Source | { id: string };
  status: "restricted" | "unlinked" | "unavailable" | "partial" | "complete" | "failed";
  items: PersonInventoryItem[];
  nextCursor: string | null;
  reason?: string;
  conflicts?: string[];
};

export type SecurityIncidentStatus = "open" | "contained" | "resolved" | "dismissed";
export type SecurityIncidentSeverity = "low" | "medium" | "high" | "critical";

export type SecurityIncident = {
  id: string;
  workspace_id: string;
  title: string;
  incidentType: "unauthorized_access" | "wrong_recipient" | "account_compromise" | "public_exposure" | "data_loss" | "other";
  severity: SecurityIncidentSeverity;
  status: SecurityIncidentStatus;
  occurredAt: string | null;
  detectedAt: string;
  affectedData: string;
  affectedSubjects: string;
  estimatedSubjectsCount: number | null;
  containmentActions: string;
  resolutionNotes: string | null;
  owner: string | null;
  createdAt: string;
  updatedAt: string;
};

