import { redirect } from "next/navigation";

// This route is kept only for old bookmarks and redirects to the active user management tab.
export default function UsersPage() {
  redirect("/dashboard/settings?department=pessoal&tab=users");
}
