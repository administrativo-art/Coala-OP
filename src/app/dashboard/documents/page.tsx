"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveExplorer, archiveAreaHref, useArchiveAreas } from "@/features/documents/central/archive-explorer";

export default function DocumentsPage() {
  const router = useRouter();
  // "Colaboradores" (documentos publicados por titular) virou a aba Ficha do colaborador (decisão 0007).
  // Fica na raiz só para quem não tem outra pasta, para a tela não abrir vazia.
  const allAreas = useArchiveAreas();
  const areas = allAreas.some((area) => area.id !== "published") ? allAreas.filter((area) => area.id !== "published") : allAreas;
  const [search, setSearch] = useState("");
  return <ArchiveExplorer search={search} onSearch={setSearch} entries={areas.filter((area) => area.name.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR"))).map((area) => ({
    id: area.id, name: area.id === "published" ? "Ficha do colaborador" : area.name, kind: "folder", description: area.description, open: () => router.push(archiveAreaHref(area.id)),
  }))} />;
}
