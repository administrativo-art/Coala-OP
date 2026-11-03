import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer";

const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const identity = (item: { content: Buffer; filename?: string; cid?: string; contentType?: string }) => `${digest(item.content)}:${item.filename ?? ""}:${item.cid ?? ""}:${item.contentType ?? ""}`;
const addresses = (value: { text: string } | Array<{ text: string }> | undefined) => Array.isArray(value) ? value.map((item) => item.text).join(", ") : value?.text;

/** Rebuilds a received EML as an explicitly redacted archival copy, then verifies all remaining attachments. */
export async function redactEmlAttachment(raw: Buffer, targetHash: string) {
  const mail = await simpleParser(raw, { keepCidLinks: true, skipImageLinks: true });
  const rootType = JSON.stringify(mail.headers.get("content-type") ?? "").toLowerCase();
  if (/multipart\/(signed|encrypted)|application\/(pkcs7|x-pkcs7|pgp-encrypted)/.test(rootType)
    || /Content-Type:\s*(?:multipart\/(?:signed|encrypted)|application\/(?:pkcs7|x-pkcs7|pgp-encrypted))/i.test(raw.toString("latin1"))) throw new Error("EML assinado ou criptografado exige revisão manual antes do descarte.");
  if (mail.attachments.some((item) => item.contentType === "message/rfc822") || /data:application\/(?:pdf|xml);base64,/i.test(String(mail.html || ""))) throw new Error("EML aninhado ou com arquivo embutido no HTML exige revisão manual.");
  const target = mail.attachments.filter((item) => digest(item.content) === targetHash);
  if (!target.length) throw new Error("A NF confirmada não foi localizada por hash no EML armazenado.");
  if (target.length !== 1) throw new Error("O EML contém mais de uma parte com os bytes desta NF; confirme a identidade de cada parte antes do descarte.");
  const remaining = mail.attachments.filter((item) => digest(item.content) !== targetHash);
  const originalIdentities = remaining.map(identity).sort();
  const composer = new MailComposer({
    baseBoundary: digest(raw).slice(0, 24) + targetHash.slice(0, 16),
    boundaryPrefix: "--_CoalaRedacted",
    from: addresses(mail.from),
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    bcc: addresses(mail.bcc),
    replyTo: addresses(mail.replyTo),
    subject: mail.subject,
    date: mail.date ?? new Date(0),
    messageId: mail.messageId || `<coala-redacted-${digest(raw)}@archive.invalid>`,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    text: mail.text || undefined,
    html: mail.html || undefined,
    headers: {
      "X-Coala-Archive-Redacted": "invoice-attachment",
      "X-Coala-Original-SHA256": digest(raw),
    },
    attachments: remaining.map((item) => ({
      filename: item.filename || false,
      content: item.content,
      contentType: item.contentType,
      contentDisposition: item.contentDisposition,
      cid: item.cid || undefined,
    })),
  });
  const bytes = await new Promise<Buffer>((resolve, reject) => composer.compile().build((error: Error | null, output: Buffer) => error ? reject(error) : resolve(output)));
  const checked = await simpleParser(bytes, { keepCidLinks: true, skipImageLinks: true });
  if (checked.attachments.some((item) => digest(item.content) === targetHash)) throw new Error("A NF permanece no EML saneado.");
  if (JSON.stringify(checked.attachments.map(identity).sort()) !== JSON.stringify(originalIdentities)) throw new Error("Outro anexo mudou durante o saneamento do EML.");
  if ((mail.text || "") !== (checked.text || "") || String(mail.html || "") !== String(checked.html || "")) throw new Error("O texto do e-mail mudou durante o saneamento.");
  return { bytes, sha256: digest(bytes), removedParts: target.length, preservedHashes: remaining.map((item) => digest(item.content)) };
}
