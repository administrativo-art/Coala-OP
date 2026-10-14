import { redirect } from "next/navigation";

export default async function EditCollaboratorPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  redirect(`/dashboard/dp/collaborators/${encodeURIComponent(userId)}?panel=edit-data`);
}
