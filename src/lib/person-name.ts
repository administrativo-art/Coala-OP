const LOWERCASE_NAME_PARTS = new Set(["da", "das", "de", "di", "do", "dos", "e"]);

function capitalizeSegment(value: string) {
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1);
}

function capitalizeWord(value: string) {
  return value
    .split("-")
    .map((part) => part.split("'").map(capitalizeSegment).join("'"))
    .join("-");
}

export function formatPersonName(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";

  return normalized
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((part, index) => {
      if (index > 0 && LOWERCASE_NAME_PARTS.has(part)) return part;
      return capitalizeWord(part);
    })
    .join(" ");
}
