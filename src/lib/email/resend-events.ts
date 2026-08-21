export type ResendDeliveryStatus =
  | "accepted"
  | "delivered"
  | "delayed"
  | "bounced"
  | "failed"
  | "complained"
  | "suppressed";

export type ResendEngagementStatus = "opened" | "clicked";

export function deliveryStatusFromResendEvent(eventType: string): ResendDeliveryStatus | null {
  if (eventType === "email.sent") return "accepted";
  if (eventType === "email.delivered") return "delivered";
  if (eventType === "email.delivery_delayed") return "delayed";
  if (eventType === "email.bounced") return "bounced";
  if (eventType === "email.failed") return "failed";
  if (eventType === "email.complained") return "complained";
  if (eventType === "email.suppressed") return "suppressed";
  return null;
}

export function engagementStatusFromResendEvent(eventType: string): ResendEngagementStatus | null {
  if (eventType === "email.opened") return "opened";
  if (eventType === "email.clicked") return "clicked";
  return null;
}

export function isDeliveryFailure(status: ResendDeliveryStatus) {
  return status === "bounced" || status === "failed" || status === "complained" || status === "suppressed";
}
