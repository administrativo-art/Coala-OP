import { createHash } from "node:crypto";

import type { FormItemOption } from "./analytics-config-schema";

export function stableOptionHash(label: string) {
  return createHash("sha256")
    .update(label.normalize("NFC"), "utf8")
    .digest("hex")
    .slice(0, 12);
}

export function migrateStringOptions(
  options: readonly string[]
): FormItemOption[] {
  const seen = new Map<string, number>();

  return options.map((label, index) => {
    const base = stableOptionHash(label);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);

    return {
      id: count === 0 ? `opt_${base}` : `opt_${base}_${count + 1}`,
      label,
      order: index,
    };
  });
}

export function isLegacyOptions(options: unknown): options is readonly string[] {
  return (
    Array.isArray(options) &&
    options.length > 0 &&
    options.every((option) => typeof option === "string")
  );
}
