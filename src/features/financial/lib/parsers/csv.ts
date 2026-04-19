import type { ParsedBankEntry } from "@/features/financial/types/import";

export type CsvColumnMap = {
  dateColumn: number;
  amountColumn: number;
  descriptionColumn: number;
  delimiter: "," | ";" | "\t";
  dateFormat: "dd/MM/yyyy" | "yyyy-MM-dd" | "MM/dd/yyyy";
  skipRows: number;
  decimalSeparator: "," | ".";
};

export const CSV_BANK_PROFILES: Record<
  string,
  { label: string; config: CsvColumnMap }
> = {
  nubank: {
    label: "Nubank",
    config: {
      dateColumn: 0,
      amountColumn: 2,
      descriptionColumn: 1,
      delimiter: ",",
      dateFormat: "yyyy-MM-dd",
      skipRows: 1,
      decimalSeparator: ".",
    },
  },
  itau: {
    label: "Itaú",
    config: {
      dateColumn: 0,
      amountColumn: 3,
      descriptionColumn: 1,
      delimiter: ";",
      dateFormat: "dd/MM/yyyy",
      skipRows: 3,
      decimalSeparator: ",",
    },
  },
  bradesco: {
    label: "Bradesco",
    config: {
      dateColumn: 0,
      amountColumn: 2,
      descriptionColumn: 1,
      delimiter: ";",
      dateFormat: "dd/MM/yyyy",
      skipRows: 4,
      decimalSeparator: ",",
    },
  },
  bb: {
    label: "Banco do Brasil",
    config: {
      dateColumn: 0,
      amountColumn: 2,
      descriptionColumn: 1,
      delimiter: ";",
      dateFormat: "dd/MM/yyyy",
      skipRows: 1,
      decimalSeparator: ",",
    },
  },
  santander: {
    label: "Santander",
    config: {
      dateColumn: 0,
      amountColumn: 3,
      descriptionColumn: 1,
      delimiter: ";",
      dateFormat: "dd/MM/yyyy",
      skipRows: 2,
      decimalSeparator: ",",
    },
  },
  sicredi: {
    label: "Sicredi",
    config: {
      dateColumn: 0,
      amountColumn: 2,
      descriptionColumn: 1,
      delimiter: ";",
      dateFormat: "dd/MM/yyyy",
      skipRows: 1,
      decimalSeparator: ",",
    },
  },
  custom: {
    label: "Personalizado",
    config: {
      dateColumn: 0,
      amountColumn: 1,
      descriptionColumn: 2,
      delimiter: ";",
      dateFormat: "dd/MM/yyyy",
      skipRows: 1,
      decimalSeparator: ",",
    },
  },
};

function parseDate(raw: string, format: CsvColumnMap["dateFormat"]): Date | null {
  const clean = raw.trim().replace(/["']/g, "");

  try {
    if (format === "dd/MM/yyyy") {
      const [day, month, year] = clean.split("/");
      return new Date(Number.parseInt(year, 10), Number.parseInt(month, 10) - 1, Number.parseInt(day, 10));
    }

    if (format === "yyyy-MM-dd") {
      const [year, month, day] = clean.split("-");
      return new Date(Number.parseInt(year, 10), Number.parseInt(month, 10) - 1, Number.parseInt(day, 10));
    }

    if (format === "MM/dd/yyyy") {
      const [month, day, year] = clean.split("/");
      return new Date(Number.parseInt(year, 10), Number.parseInt(month, 10) - 1, Number.parseInt(day, 10));
    }
  } catch {
    return null;
  }

  return null;
}

function parseAmount(raw: string, decimalSeparator: "," | "."): number {
  let clean = raw.trim().replace(/["']/g, "");
  if (decimalSeparator === ",") {
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else {
    clean = clean.replace(/,/g, "");
  }
  return Number.parseFloat(clean);
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

export function parseCSV(content: string, config: CsvColumnMap): ParsedBankEntry[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const dataLines = lines.slice(config.skipRows);
  const entries: ParsedBankEntry[] = [];

  for (const line of dataLines) {
    const columns = splitCsvLine(line, config.delimiter);
    const rawDate = columns[config.dateColumn] ?? "";
    const rawAmount = columns[config.amountColumn] ?? "";
    const rawDescription = columns[config.descriptionColumn] ?? "";

    if (!rawDate || !rawAmount) continue;

    const date = parseDate(rawDate, config.dateFormat);
    if (!date || Number.isNaN(date.getTime())) continue;

    const amount = parseAmount(rawAmount, config.decimalSeparator);
    if (Number.isNaN(amount)) continue;

    entries.push({
      date,
      amount,
      description: rawDescription.replace(/["']/g, "").trim() || "Transação",
    });
  }

  return entries;
}
