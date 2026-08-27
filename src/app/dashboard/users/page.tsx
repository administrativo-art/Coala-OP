import { redirect } from "next/navigation";

// This route is kept only for old bookmarks and redirects to the canonical collaborator management area.
export default function UsersPage() {
  redirect("/dashboard/dp/collaborators");
}
