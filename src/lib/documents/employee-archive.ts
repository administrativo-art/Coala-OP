import type { PersonLinkedUser } from "@/lib/hr/person-link";

/** Only exact identifiers already linked to the selected person; never infer by name. */
export function employeeArchiveIds(person: PersonLinkedUser): string[] {
  return [...new Set([person.id, person.hrEmployeeId, person.registrationIdBizneo].filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim()))];
}

export function employeeArchiveChildFolders(paths: readonly string[][], parent: readonly string[]): string[] {
  return [...new Set(paths.filter((path) => parent.every((part, index) => path[index] === part)).map((path) => path[parent.length]).filter(Boolean))];
}
