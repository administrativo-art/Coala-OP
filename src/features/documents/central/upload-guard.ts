/** The cache lives for one request, so revocations are checked again on the next page. */
export function createUploadGuard(dependencies: {
  allowedPerson: (employeeId: string) => Promise<boolean>;
  allowedDocument: (item: Record<string, unknown>, employeeId: string) => boolean;
}) {
  const people = new Map<string, Promise<boolean>>();
  return async (item: Record<string, unknown>) => {
    const employeeId = typeof item.employeeId === "string" ? item.employeeId.trim() : "";
    if (!employeeId) return false;
    if (!people.has(employeeId)) people.set(employeeId, dependencies.allowedPerson(employeeId));
    return await people.get(employeeId) === true && dependencies.allowedDocument(item, employeeId);
  };
}
