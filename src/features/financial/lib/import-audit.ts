type AuditableItem = {
  status: "pending" | "audited" | "ignored" | "completed";
};

export function invalidateAuditAfterEdit<
  TPreviousItem extends AuditableItem,
  TNextItem extends AuditableItem,
>(
  previousItem: TPreviousItem,
  nextItem: TNextItem,
): TNextItem | (Omit<TNextItem, "status"> & { status: "pending" }) {
  if (
    previousItem.status !== "audited" ||
    nextItem.status !== "audited" ||
    JSON.stringify(previousItem) === JSON.stringify(nextItem)
  ) {
    return nextItem;
  }

  return { ...nextItem, status: "pending" };
}
