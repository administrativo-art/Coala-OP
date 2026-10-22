"use client";

import { use } from "react";

import { MyTimeRecordingPage } from "@/features/dp/rep-p/my-time-recording-page";

export default function CollaboratorTimeRecordingRoute({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  return <MyTimeRecordingPage employeeUid={userId} />;
}
