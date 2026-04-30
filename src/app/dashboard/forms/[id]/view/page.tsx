import { FormExecutionDetailShell } from "@/components/forms/form-execution-detail-shell";

export default async function FormViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FormExecutionDetailShell executionId={id} />;
}
