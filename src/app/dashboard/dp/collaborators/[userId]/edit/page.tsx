"use client";

import { use } from "react";
import { useRouter } from "next/navigation";

import { UserManagement } from "@/components/user-management";

export default function EditCollaboratorPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = use(params);
  const router = useRouter();
  const profileHref = `/dashboard/dp/collaborators/${encodeURIComponent(userId)}`;

  return (
    <UserManagement
      editUserId={userId}
      contextLabel="Gestão do colaborador › Editar dados"
      onClose={() => router.push(profileHref)}
    />
  );
}
