export type EmailAttachmentInput = {
  filename: string;
  content: string;
  contentType?: string;
  contentId?: string;
};

export function resendAttachments(attachments: EmailAttachmentInput[]) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    content: attachment.content,
    ...(attachment.contentType ? { content_type: attachment.contentType } : {}),
    ...(attachment.contentId ? { content_id: attachment.contentId } : {}),
  }));
}
