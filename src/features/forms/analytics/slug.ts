export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function uniqueSlug(name: string, existing: ReadonlySet<string>) {
  const base = slugify(name);
  if (!base) {
    throw new Error("Nome nao gera slug valido.");
  }

  if (!existing.has(base)) return base;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }

  throw new Error(`Esgotadas as variacoes de slug para "${name}".`);
}
