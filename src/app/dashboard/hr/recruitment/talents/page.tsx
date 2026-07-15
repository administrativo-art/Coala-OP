import { RecruitmentShell } from "@/components/hr/recruitment/recruitment-shell";
import { RecruitmentComingSoon } from "@/components/hr/recruitment/recruitment-coming-soon";

export default function RecruitmentTalentsPage() {
  if (process.env.NODE_ENV === "production") {
    return <RecruitmentComingSoon title="Banco de talentos em construção" />;
  }

  return <RecruitmentShell section="talents" />;
}
