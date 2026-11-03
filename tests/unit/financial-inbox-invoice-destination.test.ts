import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer";
import { confirmedInboxBoleto, sameInvoiceDestination } from "../../src/features/financial/inbox/invoice-destination";
import { redactEmlAttachment } from "../../src/features/financial/inbox/redact-eml";

const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
async function build(attachments: Array<{ filename: string; content: Buffer; cid?: string; contentDisposition?: "inline" | "attachment" }>, html = '<p>Texto <img src="cid:logo@coala"></p>') {
  const composer = new MailComposer({ from: "Fornecedor <supplier@example.com>", to: "financeiro@example.com", subject: "Documentos", text: "Cobrança recebida.", html, attachments });
  return new Promise<Buffer>((resolve, reject) => composer.compile().build((error: Error | null, bytes: Buffer) => error ? reject(error) : resolve(bytes)));
}

test("saneia duas NFs em sequência sem alterar boleto, texto nem CID", async () => {
  const nf1 = Buffer.from("PDF-NF-1"), nf2 = Buffer.from("PDF-NF-2"), boleto = Buffer.from("PDF-BOLETO"), logo = Buffer.from("PNG-LOGO");
  const original = await build([{ filename: "nf1.pdf", content: nf1 }, { filename: "nf2.pdf", content: nf2 }, { filename: "boleto.pdf", content: boleto }, { filename: "logo.png", content: logo, cid: "logo@coala", contentDisposition: "inline" }]);
  const first = await redactEmlAttachment(original, hash(nf1));
  const repeated = await redactEmlAttachment(original, hash(nf1));
  assert.equal(repeated.sha256, first.sha256, "retry recria exatamente a versão saneada planejada");
  const second = await redactEmlAttachment(first.bytes, hash(nf2));
  const parsed = await simpleParser(second.bytes, { keepCidLinks: true, skipImageLinks: true });
  assert.deepEqual(parsed.attachments.map((item) => hash(item.content)).sort(), [hash(boleto), hash(logo)].sort());
  assert.equal(parsed.text, "Cobrança recebida.");
  assert.match(String(parsed.html), /cid:logo@coala/);
  assert.equal(first.removedParts, 1);
  assert.equal(second.removedParts, 1);
  await assert.rejects(redactEmlAttachment(second.bytes, hash(nf1)), /não foi localizada/);
});

test("falha fechado quando outra parte MIME tem os mesmos bytes da NF", async () => {
  const nf = Buffer.from("PDF-NF"), other = Buffer.from("PDF-BOLETO");
  const raw = await build([{ filename: "nf-a.pdf", content: nf }, { filename: "nf-b.pdf", content: nf }, { filename: "boleto.pdf", content: other }], "<p>Descrição da cobrança</p>");
  await assert.rejects(redactEmlAttachment(raw, hash(nf)), /mais de uma parte/);
  const original = await simpleParser(raw);
  assert.deepEqual(original.attachments.map((item) => hash(item.content)), [hash(nf), hash(nf), hash(other)]);
});

test("falha fechado para EML assinado e para NF ausente do MIME", async () => {
  const nf = Buffer.from("PDF-NF"), raw = await build([{ filename: "outro.pdf", content: Buffer.from("PDF-OUTRO") }]);
  await assert.rejects(redactEmlAttachment(raw, hash(nf)), /não foi localizada/);
  const signed = Buffer.from('From: a@example.com\r\nContent-Type: multipart/signed; boundary="x"\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nteste\r\n--x--\r\n');
  await assert.rejects(redactEmlAttachment(signed, hash(nf)), /assinado ou criptografado/);
  const forwarded = await build([{ filename: "encaminhado.eml", content: Buffer.from("From: x@example.com\r\n\r\nNF aninhada"), contentDisposition: "attachment" }]);
  await assert.rejects(redactEmlAttachment(forwarded, hash(nf)), /aninhado|não foi localizada/);
});

test("boleto exige código no próprio PDF e vínculo confirmado à parcela", () => {
  const base = { workspaceId: "w", linkedExpenseId: "expense", linkedExpenseInstallmentNumber: 2, classification: { barcode: "123 456" }, attachments: [
    { contentType: "application/pdf", storagePath: "nf.pdf", extractedHints: { barcode: null } },
    { contentType: "application/pdf", storagePath: "boleto.pdf", extractedHints: { barcode: "123456" } },
  ] };
  assert.equal(confirmedInboxBoleto(base, "w", "expense", 2)?.storagePath, "boleto.pdf");
  assert.equal(confirmedInboxBoleto({ ...base, attachments: [base.attachments[0]] }, "w", "expense", 2), null);
  assert.equal(confirmedInboxBoleto(base, "other", "expense", 2), null);
  assert.equal(confirmedInboxBoleto(base, "w", "expense", 1), null);
  assert.equal(confirmedInboxBoleto({ ...base, linkedExpenseId: null }, "w", "expense", 2), null);
  assert.equal(confirmedInboxBoleto({ ...base, attachments: [base.attachments[1], base.attachments[1]] }, "w", "expense", 2), null);
});

test("decisão patrimonial idempotente exige IDs e hash iguais", () => {
  const current = { kind: "asset_invoice" as const, assetIds: ["a", "b"], version: 1, sha256: "abc", confirmedAt: "now", confirmedBy: "uid" };
  assert.equal(sameInvoiceDestination(current, "asset_invoice", ["a", "b"], "abc"), true);
  assert.equal(sameInvoiceDestination(current, "asset_invoice", ["a"], "abc"), false);
  assert.equal(sameInvoiceDestination(current, "non_asset_invoice", [], "abc"), false);
  assert.equal(sameInvoiceDestination(current, "asset_invoice", ["a", "b"], "changed"), false);
});
