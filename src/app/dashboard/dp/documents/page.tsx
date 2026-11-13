import { redirect } from "next/navigation";

type Query = Promise<Record<string, string | string[] | undefined>>;

/**
 * A antiga "Pasta Colaboradores" do DP virou a aba Colaborador do Acervo (decisão 0008), com a lista
 * de pessoas, o resumo por pessoa e a Visibilidade por pasta e documento (?configureVisibility=1).
 */
export default async function DPDocumentsPage({ searchParams }: { searchParams: Query }) {
  const { configureVisibility } = await searchParams;
  redirect(`/dashboard/documents/collaborators${configureVisibility === "1" ? "?configureVisibility=1" : ""}`);
}
