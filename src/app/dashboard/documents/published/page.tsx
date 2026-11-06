import { redirect } from "next/navigation";

type Query = Promise<Record<string, string | string[] | undefined>>;

/** A antiga Ficha do colaborador virou a aba Colaborador; ?employee= e ?path= continuam valendo. */
export default async function PublishedEmployeeDocumentsPage({ searchParams }: { searchParams: Query }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) for (const item of [value].flat()) if (typeof item === "string") query.append(key, item);
  redirect(`/dashboard/documents/collaborators${query.size ? `?${query}` : ""}`);
}
