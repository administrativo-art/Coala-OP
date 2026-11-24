import { Suspense } from "react";

import { MonthClosingPage } from "@/features/financial/month-closing/month-closing-page";

export default function Page() {
  return <Suspense fallback={null}><MonthClosingPage /></Suspense>;
}
