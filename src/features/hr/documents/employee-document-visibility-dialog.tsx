"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FolderOpen, Loader2, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EMPLOYEE_DOCUMENT_CATEGORIES, EMPLOYEE_DOCUMENT_TYPE_CATALOG } from "@/lib/hr/employee-document-options";
import type { DocumentVisibilityConfig, NormalizedFieldVisibility } from "@/types/rh";

const VISIBILITY_OPTIONS: Array<{ id: NormalizedFieldVisibility; label: string; description: string; color: string }> = [
  { id: "public", label: "Sem restrição", description: "Segue o acesso base ao módulo", color: "bg-emerald-500" },
  { id: "restricted_partial", label: "Restrito parcial", description: "Titular e perfis autorizados", color: "bg-sky-500" },
  { id: "restricted_total", label: "Restrito total", description: "RH elevado e vínculos explícitos", color: "bg-amber-500" },
  { id: "confidential", label: "Confidencial", description: "Administração e exceções explícitas", color: "bg-rose-500" },
];

function VisibilityMenu({ value, inherited, onChange }: {
  value: NormalizedFieldVisibility;
  inherited?: boolean;
  onChange: (value: NormalizedFieldVisibility | "inherit") => void;
}) {
  const current = VISIBILITY_OPTIONS.find((option) => option.id === value) ?? VISIBILITY_OPTIONS[3];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex h-9 min-w-[168px] items-center justify-between gap-2 rounded-lg border bg-white px-3 text-xs font-black text-slate-700 shadow-xs hover:bg-slate-50">
          <span className="inline-flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${current.color}`} />{inherited ? `Herdado: ${current.label}` : current.label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5 shadow-xl">
        {inherited !== undefined ? (
          <DropdownMenuItem onSelect={() => onChange("inherit")} className="cursor-pointer rounded-lg px-3 py-2.5">
            <span className="min-w-0 flex-1"><span className="block text-sm font-black">Herdar da pasta</span><span className="block text-[11px] font-semibold text-slate-500">Acompanha alterações do padrão</span></span>
            {inherited ? <Check className="h-4 w-4 text-emerald-600" /> : null}
          </DropdownMenuItem>
        ) : null}
        {VISIBILITY_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => onChange(option.id)} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${option.color}`} />
            <span className="min-w-0 flex-1"><span className="block text-sm font-black">{option.label}</span><span className="block text-[11px] font-semibold text-slate-500">{option.description}</span></span>
            {!inherited && value === option.id ? <Check className="h-4 w-4 text-emerald-600" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Visibilidade por pasta e documento dos documentos de colaborador (configuração geral, não por pessoa).
 * Veio da antiga página DP › Documentos; usa `GET/PUT /api/hr/employee-documents/visibility`.
 */
export function EmployeeDocumentVisibilityDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { firebaseUser } = useAuth();
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilityMessage, setVisibilityMessage] = useState("");
  const [documentVisibility, setDocumentVisibility] = useState<DocumentVisibilityConfig | null>(null);
  const [expandedVisibilityCategory, setExpandedVisibilityCategory] = useState<string | null>(null);
  const loadedOnce = useRef(false);
  const setVisibilityOpen = (value: boolean) => { if (!value) onClose(); };
  const closeVisibilitySettings = onClose;

  async function openVisibilitySettings() {
    if (!firebaseUser) return;
    setVisibilityOpen(true);
    setVisibilityLoading(true);
    setVisibilityMessage("");
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/hr/employee-documents/visibility", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar visibilidade.");
      setDocumentVisibility(payload.documentVisibility as DocumentVisibilityConfig);
    } catch (cause) {
      setVisibilityMessage(cause instanceof Error ? cause.message : "Falha ao carregar visibilidade.");
    } finally {
      setVisibilityLoading(false);
    }
  }

  async function saveVisibilitySettings() {
    if (!firebaseUser || !documentVisibility) return;
    setVisibilitySaving(true);
    setVisibilityMessage("");
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/hr/employee-documents/visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(documentVisibility),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao salvar visibilidade.");
      setDocumentVisibility(payload.documentVisibility as DocumentVisibilityConfig);
      setVisibilityMessage("Visibilidade salva.");
    } catch (cause) {
      setVisibilityMessage(cause instanceof Error ? cause.message : "Falha ao salvar visibilidade.");
    } finally {
      setVisibilitySaving(false);
    }
  }

  useEffect(() => {
    if (!open) { loadedOnce.current = false; return; }
    if (loadedOnce.current || !firebaseUser) return;
    loadedOnce.current = true;
    void openVisibilitySettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, firebaseUser]);

  if (!open) return null;
  return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4">
          <section className="flex max-h-[84vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
              <div>
                <p className="text-xs font-black uppercase text-[#df2f78]">Documentos do colaborador</p>
                <h2 className="mt-0.5 text-base font-black text-slate-900">Visibilidade por pasta e documento</h2>
                <p className="mt-0.5 max-w-2xl text-xs font-semibold text-slate-500">Cada pasta define o padrão. Um tipo pode herdar esse padrão ou usar outro nível da matriz de acesso.</p>
              </div>
              <button type="button" onClick={closeVisibilitySettings} className="grid h-9 w-9 place-items-center rounded-lg border text-slate-500 hover:bg-slate-50" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {visibilityLoading ? (
                <div className="grid min-h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#df2f78]" /></div>
              ) : documentVisibility ? (
                <div className="divide-y rounded-xl border">
                  {EMPLOYEE_DOCUMENT_CATEGORIES.map((category) => {
                    const categoryVisibility = documentVisibility.categories?.[category.id] ?? "restricted_total";
                    const expanded = expandedVisibilityCategory === category.id;
                    const types = EMPLOYEE_DOCUMENT_TYPE_CATALOG.filter((type) => type.category === category.id);
                    return (
                      <div key={category.id}>
                        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <button type="button" onClick={() => setExpandedVisibilityCategory(expanded ? null : category.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                            <FolderOpen className="h-4 w-4 shrink-0 text-slate-400" />
                            <span className="min-w-0"><span className="block truncate text-sm font-black text-slate-800">{category.label}</span><span className="block text-xs font-semibold text-slate-400">{types.length} tipos de documento</span></span>
                            <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform sm:ml-2 ${expanded ? "rotate-180" : ""}`} />
                          </button>
                          <VisibilityMenu
                            value={categoryVisibility}
                            onChange={(value) => {
                              if (value === "inherit") return;
                              setDocumentVisibility((current) => current ? { ...current, categories: { ...current.categories, [category.id]: value } } : current);
                            }}
                          />
                        </div>
                        {expanded ? (
                          <div className="border-t bg-slate-50/70 px-4 py-2 sm:pl-11">
                            {types.map((type) => {
                              const override = documentVisibility.document_types?.[type.code];
                              return (
                                <div key={type.code} className="flex flex-col gap-2 border-b border-slate-200/70 py-2.5 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="min-w-0"><p className="text-sm font-bold text-slate-700">{type.label}</p><p className="font-mono text-[10px] text-slate-400">{type.code}</p></div>
                                  <VisibilityMenu
                                    value={override ?? categoryVisibility}
                                    inherited={!override}
                                    onChange={(value) => setDocumentVisibility((current) => {
                                      if (!current) return current;
                                      const documentTypes = { ...current.document_types };
                                      if (value === "inherit") delete documentTypes[type.code];
                                      else documentTypes[type.code] = value;
                                      return { ...current, document_types: documentTypes };
                                    })}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <footer className="flex flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className={`text-xs font-bold ${visibilityMessage === "Visibilidade salva." ? "text-emerald-700" : "text-rose-600"}`}>{visibilityMessage}</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeVisibilitySettings}>Cancelar</Button>
                <Button onClick={() => void saveVisibilitySettings()} disabled={visibilitySaving || visibilityLoading || !documentVisibility} className="gap-2 bg-[#df2f78] hover:bg-[#c81f69]">
                  {visibilitySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Salvar visibilidade
                </Button>
              </div>
            </footer>
          </section>
        </div>
  );
}
