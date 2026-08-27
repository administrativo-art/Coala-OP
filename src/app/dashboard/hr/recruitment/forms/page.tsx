import { redirect } from "next/navigation";

export default function RecruitmentFormsRedirectPage() {
  redirect("/dashboard/settings?department=pessoal&tab=recruitment");
}
