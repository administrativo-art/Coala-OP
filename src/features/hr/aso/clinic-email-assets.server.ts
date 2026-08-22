import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ASO_CLINIC_EMAIL_CIDS } from "@/features/hr/aso/emails";
import type { SendEmailInput } from "@/lib/email/resend";

type EmailAttachment = NonNullable<SendEmailInput["attachments"]>[number];

const INLINE_ASSETS = [
  { cid: ASO_CLINIC_EMAIL_CIDS.logo, filename: "coala-email-logo.jpg", path: "coala-email-logo.jpg", contentType: "image/jpeg" },
  { cid: ASO_CLINIC_EMAIL_CIDS.request, filename: "aso-request-icon.png", path: "email/icons/file-text-pink.png", contentType: "image/png" },
  { cid: ASO_CLINIC_EMAIL_CIDS.attachment, filename: "aso-attachment-icon.png", path: "email/icons/boxes/file-text-pink-14-in-28-fff0f6-r8.png", contentType: "image/png" },
  { cid: ASO_CLINIC_EMAIL_CIDS.exam, filename: "aso-exam-icon.png", path: "email/icons/boxes/stethoscope-white-20-in-36-28b3d0-r11.png", contentType: "image/png" },
  { cid: ASO_CLINIC_EMAIL_CIDS.company, filename: "aso-company-icon.png", path: "email/icons/boxes/building-2-pink-14-in-28-fff0f6-r9.png", contentType: "image/png" },
  { cid: ASO_CLINIC_EMAIL_CIDS.candidate, filename: "aso-candidate-icon.png", path: "email/icons/boxes/user-round-pink-14-in-28-fff0f6-r9.png", contentType: "image/png" },
  { cid: ASO_CLINIC_EMAIL_CIDS.calendar, filename: "aso-calendar-icon.png", path: "email/icons/calendar-days-white.png", contentType: "image/png" },
] as const;

let cachedAttachments: Promise<EmailAttachment[]> | null = null;

export function asoClinicEmailInlineAttachments() {
  cachedAttachments ??= Promise.all(INLINE_ASSETS.map(async (asset) => ({
    filename: asset.filename,
    content: (await readFile(join(process.cwd(), "public", asset.path))).toString("base64"),
    contentType: asset.contentType,
    contentId: asset.cid,
  })));
  return cachedAttachments;
}
