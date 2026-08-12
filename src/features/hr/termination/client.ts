import type { User as FirebaseUser } from "firebase/auth";
import type { CltTerminationProcess } from "./types";
import type { EmploymentTerminationReason } from "@/lib/hr/employment-relationship";

export async function terminationFetch<T>(user: FirebaseUser, path: string, init?: RequestInit): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Falha ao carregar desligamentos.");
  return body as T;
}

export function createManagedTerminationProcess(
  user: FirebaseUser,
  input: {
    employeeId: string;
    employerUnitId: string;
    terminationDate: string;
    terminationReason: EmploymentTerminationReason;
    terminationCause?: string;
    terminationNotes?: string;
    terminationInternalReason?: string;
    communicationConfirmed?: boolean;
    communicationAt?: string;
    communicationLocation?: string;
    communicationParticipants?: string[];
    noticeType?: "worked" | "indemnified";
  },
) {
  return terminationFetch<{ process: CltTerminationProcess; reused: boolean }>(
    user,
    "/api/hr/terminations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, source: "hr_manual" }),
    },
  );
}
