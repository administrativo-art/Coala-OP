import { Suspense } from "react";

import { ExpensesFlowPage } from "@/features/financial/month-closing/expenses-flow-page";

export default function Page() {
  return <Suspense fallback={null}><ExpensesFlowPage /></Suspense>;
}
