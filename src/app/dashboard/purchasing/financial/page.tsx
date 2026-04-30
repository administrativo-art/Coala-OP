import { redirect } from "next/navigation";

export default function PurchaseFinancialRedirectPage() {
  redirect("/dashboard/financial/expenses?origin=purchasing&status=pending_audit");
}
