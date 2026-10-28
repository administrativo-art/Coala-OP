"use client";

import { use } from "react";

import { MyTimeRecordingPage, parseTimeRecordingView } from "@/features/dp/rep-p/my-time-recording-page";

export default function CollaboratorTimeRecordingRoute({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const query = use(searchParams);
  return <MyTimeRecordingPage initialView={parseTimeRecordingView(query.view)} />;
}
