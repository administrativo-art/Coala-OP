export type BigQueryRow = { f?: Array<{ v?: unknown }> };

export type BigQueryQueryPage = {
  jobComplete?: boolean;
  schema?: { fields?: Array<{ name?: string }> };
  rows?: BigQueryRow[];
  pageToken?: string;
  errors?: Array<{ message?: string }>;
};

export type CollectedQueryRows = {
  fieldNames: string[];
  rows: BigQueryRow[];
  nextPageToken: string | null;
};

export async function collectCatalogPages<T>(fetchPage: (pageToken: string | null) => Promise<{
  items: T[];
  nextPageToken?: string;
}>): Promise<T[]> {
  const items: T[] = [];
  const seenTokens = new Set<string>();
  let token: string | null = null;
  do {
    const page = await fetchPage(token);
    items.push(...page.items);
    token = page.nextPageToken || null;
    if (token) {
      if (seenTokens.has(token)) throw new Error("O BigQuery repetiu um token do catálogo.");
      seenTokens.add(token);
    }
  } while (token);
  return items;
}

export function appendCompletedQueryPage(
  previous: CollectedQueryRows | null,
  page: BigQueryQueryPage,
): CollectedQueryRows {
  if (!page.jobComplete) throw new Error("A consulta do BigQuery ainda não terminou.");
  if (page.errors?.length) throw new Error("A consulta do BigQuery retornou erros.");
  const names = page.schema?.fields?.map((field) => field.name || "") || [];
  if (!previous && names.length === 0) throw new Error("A consulta do BigQuery não retornou schema.");
  if (previous && names.length && names.join("\u0000") !== previous.fieldNames.join("\u0000")) {
    throw new Error("As páginas do BigQuery retornaram schemas diferentes.");
  }
  return {
    fieldNames: previous?.fieldNames || names,
    rows: [...(previous?.rows || []), ...(page.rows || [])],
    nextPageToken: page.pageToken || null,
  };
}
