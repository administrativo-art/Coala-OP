"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveExplorer, archiveAreaHref, useArchiveAreas } from "@/features/documents/central/archive-explorer";

export default function DocumentsPage() {
  const router = useRouter();
  const areas = useArchiveAreas();
  const [search, setSearch] = useState("");
  return <ArchiveExplorer search={search} onSearch={setSearch} entries={areas.filter((area) => area.name.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR"))).map((area) => ({
    id: area.id, name: area.name, kind: "folder", description: area.description, open: () => router.push(archiveAreaHref(area.id)),
  }))} />;
}
