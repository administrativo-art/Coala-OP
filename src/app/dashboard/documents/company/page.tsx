import { redirect } from "next/navigation";

type Query = Promise<Record<string, string | string[] | undefined>>;

/** A aba Empresa agora é a raiz do Acervo; links antigos (?category=, ?folder=, ?unit=, ?document=) continuam valendo. */
export default async function CompanyDocumentsPage({ searchParams }: { searchParams: Query }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) for (const item of [value].flat()) if (typeof item === "string") query.append(key, item);
  redirect(`/dashboard/documents${query.size ? `?${query}` : ""}`);
}
