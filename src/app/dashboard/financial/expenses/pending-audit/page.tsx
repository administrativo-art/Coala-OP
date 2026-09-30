import { redirect } from "next/navigation";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";

export default function Page() {
  redirect(`${FINANCIAL_ROUTES.expenses}?status=pending_audit`);
}
