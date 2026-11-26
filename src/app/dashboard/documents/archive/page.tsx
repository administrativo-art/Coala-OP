"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SourceArchive } from "@/features/documents/central/source-archive";
import { isArchiveFolderSource } from "@/features/documents/central/archive-source-folders";

function ArchivePage() {
  const params = useSearchParams();
  const source = params.get("source");
  return <SourceArchive parentId={source === "admissionUploads" || source === "admissionStaging" ? params.get("parent") ?? undefined : undefined} source={isArchiveFolderSource(source) ? source : "generated"} mine={source === "uniforms" && params.get("mine") === "true"} documentId={source === "generated" ? params.get("document") ?? undefined : undefined} />;
}

export default function DocumentSourceArchivePage() {
  return <Suspense><ArchivePage /></Suspense>;
}
