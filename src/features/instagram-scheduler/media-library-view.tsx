"use client";

import { useMemo, useRef, useState } from "react";
import { Film, Search, Upload } from "lucide-react";

import type {
  InstagramMediaLibraryItem,
  InstagramMediaLibraryKind,
  InstagramScheduleListItem,
} from "./contracts";
import { ProtectedMedia } from "./protected-media";
import {
  dateKeyInBelem,
  instagramPostTitle,
  longDate,
} from "./workspace-utils";

type WorkspaceMediaItem = {
  id: string;
  name: string;
  folder: string;
  kind: InstagramMediaLibraryKind;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  previewUrl: string | null;
  source: "library" | "scheduled";
  uses: Array<{ id: string; title: string; date: string }>;
};

type MediaLibraryViewProps = {
  libraryItems: InstagramMediaLibraryItem[];
  schedules: InstagramScheduleListItem[];
  loading: boolean;
  uploading: boolean;
  onUpload: (files: File[], folder: string) => Promise<void>;
  onFutureFeature: (label: string) => void;
};

function sizeLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaLibraryView({
  libraryItems,
  schedules,
  loading,
  uploading,
  onUpload,
  onFutureFeature,
}: MediaLibraryViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("Todas");
  const [uploadFolder, setUploadFolder] = useState("Uploads");
  const [kind, setKind] = useState<"all" | InstagramMediaLibraryKind>("all");
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const media = useMemo<WorkspaceMediaItem[]>(() => {
    const uploaded = libraryItems.map((item) => ({
      id: `library:${item.id}`,
      name: item.fileName,
      folder: item.folder,
      kind: item.kind,
      contentType: item.contentType,
      sizeBytes: item.sizeBytes,
      width: item.width,
      height: item.height,
      previewUrl: item.previewUrl,
      source: "library" as const,
      uses: [],
    }));
    const scheduled = schedules.flatMap((schedule) => schedule.media.map((item, index) => ({
      id: `scheduled:${schedule.id}:${index}`,
      name: item.fileName,
      folder: "Agendamentos",
      kind: item.kind,
      contentType: item.contentType,
      sizeBytes: item.sizeBytes,
      width: item.width,
      height: item.height,
      previewUrl: item.previewUrl,
      source: "scheduled" as const,
      uses: [{
        id: schedule.id,
        title: instagramPostTitle(schedule),
        date: longDate(dateKeyInBelem(schedule.scheduledAt)),
      }],
    })));
    return [...uploaded, ...scheduled];
  }, [libraryItems, schedules]);

  const folders = useMemo(() => {
    const values = Array.from(new Set(media.map((item) => item.folder))).sort((a, b) => a.localeCompare(b, "pt-BR"));
    return ["Todas", ...values];
  }, [media]);
  const uploadFolders = useMemo(
    () => Array.from(new Set(["Uploads", ...libraryItems.map((item) => item.folder)])).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [libraryItems],
  );
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return media.filter((item) => {
      if (folder !== "Todas" && item.folder !== folder) return false;
      if (kind !== "all" && item.kind !== kind) return false;
      if (unusedOnly && item.uses.length > 0) return false;
      return !normalizedQuery || item.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
    });
  }, [folder, kind, media, query, unusedOnly]);
  const selected = media.find((item) => item.id === selectedId) ?? visible[0] ?? null;

  async function uploadSelection(files: FileList | null) {
    if (!files?.length) return;
    await onUpload(Array.from(files).slice(0, 10), uploadFolder);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="instagram-media-title">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#EADFD3] px-4 py-4 md:px-7">
        <h1 id="instagram-media-title" className="text-[22px] font-extrabold tracking-tight text-[#4A1A04]">Biblioteca de mídia</h1>
        <label className="relative min-w-[190px] flex-1 sm:max-w-[380px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7A5646]" aria-hidden="true" />
          <span className="sr-only">Buscar por nome</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome…"
            className="h-9 w-full rounded-[9px] border border-[#EADFD3] bg-white pl-9 pr-3 text-[13px] outline-none focus:border-[#F462A7]"
          />
        </label>
        <div className="flex rounded-[9px] bg-[#F3E8DC] p-[3px] text-[13px]">
          {([
            ["all", "Tudo"],
            ["image", "Fotos"],
            ["video", "Vídeos"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={`rounded-[7px] px-3 py-1.5 ${kind === value ? "bg-white font-extrabold shadow-sm" : "font-medium"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-[#5E3A28]">
          <input type="checkbox" checked={unusedOnly} onChange={(event) => setUnusedOnly(event.target.checked)} className="accent-[#D90F6F]" />
          Nunca usadas
        </label>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-[11px] font-bold text-[#7A5646]">
            Pasta do upload
            <select
              value={uploadFolder}
              onChange={(event) => setUploadFolder(event.target.value)}
              className="ml-2 h-9 rounded-[9px] border border-[#EADFD3] bg-white px-2 text-[12px] font-semibold text-[#4A1A04]"
            >
              {uploadFolders.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex h-9 items-center gap-2 rounded-[9px] bg-[#F462A7] px-3.5 text-[13px] font-extrabold text-[#4A1A04] transition hover:bg-[#E9509A] disabled:cursor-wait disabled:opacity-60"
          >
            <Upload className={`h-4 w-4 ${uploading ? "animate-pulse" : ""}`} aria-hidden="true" />
            {uploading ? "Enviando…" : "Enviar arquivos"}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
            className="sr-only"
            onChange={(event) => void uploadSelection(event.target.files)}
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[190px_minmax(0,1fr)_300px]">
        <aside className="hidden border-r border-[#EADFD3] px-3 py-4 lg:block">
          <div className="px-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.09em] text-[#7A5646]">Pastas</div>
          {folders.map((value) => {
            const count = value === "Todas" ? media.length : media.filter((item) => item.folder === value).length;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={folder === value}
                onClick={() => setFolder(value)}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[13px] ${folder === value ? "bg-white font-extrabold shadow-sm" : "hover:bg-white/70"}`}
              >
                <span className="truncate">{value}</span>
                <span className="text-[12px] text-[#7A5646]">{count}</span>
              </button>
            );
          })}
        </aside>

        <div className="min-h-0 overflow-y-auto p-4">
          <label className="mb-3 block lg:hidden">
            <span className="sr-only">Pasta</span>
            <select value={folder} onChange={(event) => setFolder(event.target.value)} className="h-9 w-full rounded-[9px] border border-[#EADFD3] bg-white px-3 text-[13px] font-bold">
              {folders.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          {loading && media.length === 0 ? (
            <div className="grid min-h-64 place-items-center text-[13px] text-[#7A5646]">Carregando biblioteca…</div>
          ) : visible.length === 0 ? (
            <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-[#D9C8B6] bg-white px-8 text-center text-[13px] text-[#7A5646]">
              Nada encontrado com esses filtros.
            </div>
          ) : (
            <div className="grid grid-cols-2 content-start gap-3 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-5">
              {visible.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected?.id === item.id}
                  onClick={() => setSelectedId(item.id)}
                  className="min-w-0 text-left focus-visible:outline-none"
                >
                  <div
                    className="relative aspect-[4/5] overflow-hidden rounded-lg border border-[#EADFD3] bg-[#F3E8DC]"
                    style={{ outline: selected?.id === item.id ? "2px solid #D90F6F" : "none", outlineOffset: "2px" }}
                  >
                    <ProtectedMedia url={item.previewUrl} kind={item.kind} alt={item.name} />
                    {item.kind === "video" && (
                      <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-[#4A1A04] px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                        <Film className="h-2.5 w-2.5" aria-hidden="true" /> Vídeo
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 truncate text-[12px] font-bold text-[#4A1A04]">{item.name}</div>
                  <div className="text-[10px] text-[#7A5646]">{item.uses.length ? `Usada em ${item.uses.length} post` : "Nunca usada"}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="hidden border-l border-[#EADFD3] bg-white p-5 xl:flex xl:flex-col xl:gap-4">
          {selected ? (
            <>
              <div className="aspect-[4/5] max-h-[340px] overflow-hidden rounded-[10px] border border-[#EADFD3] bg-[#F3E8DC]">
                <ProtectedMedia url={selected.previewUrl} kind={selected.kind} alt={selected.name} eager />
              </div>
              <div>
                <h2 className="break-words text-[18px] font-extrabold text-[#4A1A04]">{selected.name}</h2>
                <p className="mt-1 text-[12px] text-[#7A5646]">
                  {selected.folder} · {selected.kind === "video" ? "vídeo" : "foto"} · {sizeLabel(selected.sizeBytes)}
                </p>
                {selected.width && selected.height && (
                  <p className="mt-1 text-[11px] text-[#7A5646]">{selected.width} × {selected.height} px</p>
                )}
              </div>
              <div className="space-y-1.5 text-[12px]">
                <div className="font-extrabold text-[#4A1A04]">{selected.uses.length ? `Usada em ${selected.uses.length} post` : "Ainda não usada"}</div>
                {selected.uses.map((use) => (
                  <div key={use.id} className="font-semibold text-[#217A8F]">{use.title} · {use.date}</div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onFutureFeature("Editor de posts")}
                className="mt-auto rounded-[9px] bg-[#F462A7] px-3 py-2.5 text-[13px] font-extrabold text-[#4A1A04]"
              >
                Criar post com esta mídia · em breve
              </button>
            </>
          ) : (
            <p className="text-[13px] text-[#7A5646]">Selecione um arquivo para conferir seus detalhes.</p>
          )}
        </aside>
      </div>
      <footer className="border-t border-[#EADFD3] bg-white px-4 py-2 text-[11px] text-[#7A5646] md:px-7">
        Até 100 arquivos por consulta. Imagens: 8 MB. Vídeos: 24 MB. Arquivos dos agendamentos aparecem na pasta “Agendamentos”.
      </footer>
    </section>
  );
}
