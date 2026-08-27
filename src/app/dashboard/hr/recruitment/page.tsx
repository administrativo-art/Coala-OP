import { RecruitmentShell } from "@/components/hr/recruitment/recruitment-shell";
import { RecruitmentComingSoon } from "@/components/hr/recruitment/recruitment-coming-soon";

export default function RecruitmentPage() {
  if (process.env.NODE_ENV === "production") {
    return <RecruitmentComingSoon title="Gestão da vaga em construção" />;
  }

  return <RecruitmentShell section="jobs" />;
}
