import type { FinancialInboxMessage } from "./types";

export type FinancialInboxMessageGroup = {
  id: string;
  primary: FinancialInboxMessage;
  messages: FinancialInboxMessage[];
  messageCount: number;
};

function groupKey(message: FinancialInboxMessage) {
  if (message.thread?.primaryMessageId) return `thread:${message.thread.primaryMessageId}`;
  if (message.obligationId) return `obligation:${message.obligationId}`;
  if (message.resolution?.targetType === "expense" && message.resolution.targetId) {
    return `expense:${message.resolution.targetId}`;
  }
  if (message.linkedExpenseId) return `expense:${message.linkedExpenseId}`;
  return `message:${message.id}`;
}

function primaryScore(message: FinancialInboxMessage) {
  if (message.resolution?.kind === "new_charge") return 3;
  if (message.linkedExpenseId) return 2;
  if (message.resolution?.kind !== "reminder" && message.resolution?.kind !== "duplicate") return 1;
  return 0;
}

export function groupFinancialInboxMessages(messages: FinancialInboxMessage[]): FinancialInboxMessageGroup[] {
  const groups = new Map<string, FinancialInboxMessage[]>();
  messages.forEach((message) => {
    const key = groupKey(message);
    groups.set(key, [...(groups.get(key) ?? []), message]);
  });
  return [...groups.entries()].map(([id, entries]) => {
    const sorted = [...entries].sort((left, right) => (
      primaryScore(right) - primaryScore(left)
      || left.receivedAt.localeCompare(right.receivedAt)
      || left.id.localeCompare(right.id)
    ));
    return {
      id,
      primary: sorted[0],
      messages: [...entries].sort((left, right) => left.receivedAt.localeCompare(right.receivedAt)),
      messageCount: Math.max(entries.length, ...entries.map((entry) => entry.thread?.messageCount ?? 0)),
    };
  }).sort((left, right) => (
    right.messages.at(-1)!.receivedAt.localeCompare(left.messages.at(-1)!.receivedAt)
    || left.id.localeCompare(right.id)
  ));
}
