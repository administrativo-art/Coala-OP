"use client";

import { use } from "react";

import { MyTimeRecordingPage } from "@/features/dp/rep-p/my-time-recording-page";

export default function CollaboratorTimeRecordingRoute({ params, searchParams }: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { userId } = use(params);
  const query = use(searchParams);
  return <MyTimeRecordingPage employeeUid={userId} initialView={query.view === "time-bank" ? "time-bank" : "records"} />;
}
