import { FormModelPageShell } from "@/components/forms/form-model-page-shell";

export default async function NewFormModelPage({
  searchParams,
}: {
  searchParams: Promise<{ base?: string }>;
}) {
  const params = await searchParams;
  return <FormModelPageShell mode="new" baseModelId={params.base} />;
}
