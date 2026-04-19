import type { ParsedBankEntry } from "@/features/financial/types/import";

function parseOfxDate(raw: string): Date {
  const clean = raw.replace(/\[.*\]/, "").trim();
  const year = Number.parseInt(clean.slice(0, 4), 10);
  const month = Number.parseInt(clean.slice(4, 6), 10) - 1;
  const day = Number.parseInt(clean.slice(6, 8), 10);
  const hour = clean.length >= 10 ? Number.parseInt(clean.slice(8, 10), 10) : 0;
  const minute = clean.length >= 12 ? Number.parseInt(clean.slice(10, 12), 10) : 0;
  const second = clean.length >= 14 ? Number.parseInt(clean.slice(12, 14), 10) : 0;

  return new Date(year, month, day, hour, minute, second);
}

function extractTag(block: string, tag: string): string {
  const pattern = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i");
  const match = block.match(pattern);
  return match ? match[1].trim() : "";
}

function parseOFX1(content: string): ParsedBankEntry[] {
  const entries: ParsedBankEntry[] = [];
  const transactionBlocks = content.split(/<STMTTRN>/i).slice(1);

  for (const block of transactionBlocks) {
    const cleanBlock = block.split(/<\/STMTTRN>/i)[0];
    const rawDate = extractTag(cleanBlock, "DTPOSTED");
    const rawAmount = extractTag(cleanBlock, "TRNAMT");
    const name = extractTag(cleanBlock, "NAME") || extractTag(cleanBlock, "MEMO");
    const memo = extractTag(cleanBlock, "MEMO");
    const fitId = extractTag(cleanBlock, "FITID");
    const type = extractTag(cleanBlock, "TRNTYPE");

    if (!rawDate || !rawAmount) continue;

    const amount = Number.parseFloat(rawAmount.replace(",", "."));
    if (Number.isNaN(amount)) continue;

    const description = [name, memo !== name ? memo : ""]
      .filter(Boolean)
      .join(" — ")
      .trim();

    entries.push({
      date: parseOfxDate(rawDate),
      amount,
      description: description || type || "Transação",
      fitId: fitId || undefined,
      type: type || undefined,
    });
  }

  return entries;
}

function parseOFX2(content: string): ParsedBankEntry[] {
  const entries: ParsedBankEntry[] = [];
  const regex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const block = match[1];
    const rawDate = extractTag(block, "DTPOSTED");
    const rawAmount = extractTag(block, "TRNAMT");
    const name = extractTag(block, "NAME") || extractTag(block, "MEMO");
    const memo = extractTag(block, "MEMO");
    const fitId = extractTag(block, "FITID");
    const type = extractTag(block, "TRNTYPE");

    if (!rawDate || !rawAmount) continue;

    const amount = Number.parseFloat(rawAmount.replace(",", "."));
    if (Number.isNaN(amount)) continue;

    const description = [name, memo !== name ? memo : ""]
      .filter(Boolean)
      .join(" — ")
      .trim();

    entries.push({
      date: parseOfxDate(rawDate),
      amount,
      description: description || type || "Transação",
      fitId: fitId || undefined,
      type: type || undefined,
    });
  }

  return entries;
}

export function parseOFX(content: string): ParsedBankEntry[] {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<?OFX")) {
    return parseOFX2(content);
  }
  return parseOFX1(content);
}
