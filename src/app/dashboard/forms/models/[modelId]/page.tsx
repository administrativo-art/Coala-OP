import { FormModelPageShell } from "@/components/forms/form-model-page-shell";

export default async function EditFormModelPage({
  params,
}: {
  params: Promise<{ modelId: string }>;
}) {
  const { modelId } = await params;
  return <FormModelPageShell mode="edit" modelId={modelId} />;
}
