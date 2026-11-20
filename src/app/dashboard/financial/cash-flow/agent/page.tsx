import { redirect } from "next/navigation";

export default async function Page({ searchParams }: {
  searchParams: Promise<{ topic?: string | string[] }>;
}) {
  const { topic } = await searchParams;

  if (topic === "management") redirect("/dashboard/financial/cash-flow");
  if (topic === "receivables") redirect("/dashboard/financial/cash-flow/receivables");
  redirect("/dashboard/financial/stone-anticipations");
}
