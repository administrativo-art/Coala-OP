import { redirect } from "next/navigation";
export default async function LegacyTemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) for (const part of Array.isArray(value) ? value : value ? [value] : []) query.append(key, part);
  redirect(`/dashboard/documents/generator/models/${encodeURIComponent(id)}${query.size ? `?${query}` : ""}`);
}
