import { redirect } from "next/navigation";

export default function ChecklistTemplatesPage() {
  redirect("/dashboard/settings?department=operacional&tab=checklists");
}
