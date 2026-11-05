"use client";

import dynamic from "next/dynamic";

import { EditorLoadingState } from "./editor-loading-state";
import type { EditorTarget } from "./editor-workspace";

/** O Tiptap/ProseMirror só é baixado nesta rota e nunca renderiza no servidor. */
const EditorWorkspace = dynamic(() => import("./editor-workspace"), {
  ssr: false,
  loading: () => <EditorLoadingState />,
});

export function EditorLoader({ documentId, templateId }: { documentId?: string; templateId?: string }) {
  const target: EditorTarget | null = templateId
    ? { kind: "template", id: templateId }
    : documentId
      ? { kind: "document", id: documentId }
      : null;
  return target ? <EditorWorkspace target={target} /> : null;
}
