"use client";

import { use } from "react";

import { MyTimeRecordingPage } from "@/features/dp/rep-p/my-time-recording-page";

export default function CollaboratorTimeRecordingRoute({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const query = use(searchParams);
  return <MyTimeRecordingPage initialView={query.view === "time-bank" ? "time-bank" : "records"} />;
}
