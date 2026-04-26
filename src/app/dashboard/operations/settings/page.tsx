import { redirect } from "next/navigation";

export default function OperationsSettingsPage() {
  redirect("/dashboard/settings?department=operacional&tab=checklists");
}
