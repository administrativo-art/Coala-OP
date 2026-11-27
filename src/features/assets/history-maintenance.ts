import type { AssetHistoryMaintenance } from "./history-pagination";

export type MaintenanceHistoryRecord = Record<string, unknown>;
export type HistoryScope = { assetId: string; workspaceId: string };

const hasWorkspace = (record: MaintenanceHistoryRecord, scope: HistoryScope) =>
  record.workspaceId === scope.workspaceId && (record.workspace_id == null || record.workspace_id === scope.workspaceId);

const text = (value: unknown) => typeof value === "string" && value ? value : null;

export function historyDocumentId(value: unknown) {
  const id = text(value);
  return id && !id.includes("/") && id !== "." && id !== ".." && !/^__.*__$/.test(id)
    && new TextEncoder().encode(id).length <= 1500 ? id : null;
}

export function linkedMaintenanceId(source: string, child: MaintenanceHistoryRecord) {
  if (source === "document") return historyDocumentId(child.sourceMaintenanceOccurrenceId);
  if (source !== "movement" || child.type !== "MANUTENCAO_ORDEM") return null;
  const link = child.source as { type?: unknown; id?: unknown } | undefined;
  return link?.type === "maintenance" ? historyDocumentId(link.id) : null;
}

export function isScopedMaintenanceRoot(root: MaintenanceHistoryRecord, scope: HistoryScope) {
  return hasWorkspace(root, scope) && root.assetId === scope.assetId && Boolean(text(root.createdAt));
}

export function isMaintenanceOrder(
  scope: HistoryScope,
  occurrenceId: string,
  order: MaintenanceHistoryRecord | undefined,
) {
  return Boolean(order && hasWorkspace(order, scope) && order.sourceAssetId === scope.assetId
    && order.sourceMaintenanceOccurrenceId === occurrenceId);
}

export function isGroupedMaintenanceChild(
  scope: HistoryScope,
  source: string,
  childId: string,
  child: MaintenanceHistoryRecord,
  root: MaintenanceHistoryRecord | undefined,
) {
  const occurrenceId = linkedMaintenanceId(source, child);
  if (!occurrenceId || !root || !isScopedMaintenanceRoot(root, scope)) return false;
  if (source === "document") {
    return root.orderDocumentId === childId && isMaintenanceOrder(scope, occurrenceId, child)
      && Boolean(text(child.pdfStoragePath));
  }
  return child.assetId === scope.assetId && hasWorkspace(child, scope);
}

export function projectHistoryMaintenance(
  scope: HistoryScope,
  occurrenceId: string,
  root: MaintenanceHistoryRecord,
  order: MaintenanceHistoryRecord | undefined,
): AssetHistoryMaintenance {
  const documentId = historyDocumentId(root.orderDocumentId);
  const assignee = root.assignee as { nameSnapshot?: unknown } | undefined;
  const completedBy = root.completedBy as { nameSnapshot?: unknown } | undefined;
  const createdBy = root.createdBy as { nameSnapshot?: unknown } | undefined;
  return {
    registeredByLabel: text(createdBy?.nameSnapshot),
    completedByLabel: text(completedBy?.nameSnapshot),
    status: text(root.status),
    assigneeLabel: text(assignee?.nameSnapshot),
    performedOn: text(root.performedOn),
    completedAt: text(root.completedAt),
    dueDate: text(root.dueDate),
    result: text(root.result),
    components: Array.isArray(root.components)
      ? root.components.filter((component): component is string => typeof component === "string")
      : [],
    order: documentId && isScopedMaintenanceRoot(root, scope)
      && isMaintenanceOrder(scope, occurrenceId, order) && text(order?.pdfStoragePath)
      ? {
        documentId,
        protocol: text(order?.protocol) ?? text(root.orderProtocol),
        href: `/api/assets/${encodeURIComponent(scope.assetId)}/maintenance-occurrences/${encodeURIComponent(occurrenceId)}/order`,
      }
      : null,
  };
}
