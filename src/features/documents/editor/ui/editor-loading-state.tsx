import { Skeleton } from "@/components/ui/skeleton";

/** Estado de carregamento leve (sem Tiptap): usado antes e durante o download do editor. */
export function EditorLoadingState() {
  return (
    <div className="space-y-3" role="status" aria-label="Carregando o editor">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-[420px] w-full" />
    </div>
  );
}
