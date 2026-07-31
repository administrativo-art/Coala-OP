"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DOCUMENT_VARIABLES } from "@/features/hr/integration/document-variables";

type MarkedTerm = { id: string; text: string; variableKey: string };
type TextReplacement = { id: string; text: string; replacement: string };

type TemplateVariableWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
  getToken: () => Promise<string>;
  onFinalized: (message: string) => void | Promise<void>;
};

const CATALOG = DOCUMENT_VARIABLES.filter((entry) => entry.format !== "repeatable");
const CATALOG_BY_KEY = new Map(CATALOG.map((entry) => [entry.key, entry]));

function aliases(key: string) {
  if (key.startsWith("employee.")) return "colaborador colaboradora funcionário funcionária empregado empregada candidato candidata pessoa";
  if (key.startsWith("integration.employer")) return "empresa empregador razão social cnpj endereço unidade contratação";
  if (key.startsWith("integration.job")) return "cargo função trabalho ocupação colaborador contratação";
  if (key.startsWith("integration.probation")) return "experiência contrato prorrogação prazo data";
  if (key.startsWith("integration.")) return "integração admissão contratação candidato";
  return "documento cadastro informação";
}

function fingerprint(terms: MarkedTerm[], textReplacements: TextReplacement[]) {
  return [
    ...terms.map((term) => `variable\u0000${term.text}\u0000${term.variableKey}`),
    ...textReplacements.map((edit) => `text\u0000${edit.text}\u0000${edit.replacement}`),
  ].join("\u0001");
}

export function TemplateVariableWizard(props: TemplateVariableWizardProps) {
  const sourceHost = useRef<HTMLDivElement>(null);
  const previewHost = useRef<HTMLDivElement>(null);
  const selectedRange = useRef<Range | null>(null);
  const markedRanges = useRef(new Map<string, Range>());
  const [step, setStep] = useState<2 | 3>(2);
  const [terms, setTerms] = useState<MarkedTerm[]>([]);
  const [textReplacements, setTextReplacements] = useState<TextReplacement[]>([]);
  const [selectionText, setSelectionText] = useState("");
  const [selectionAction, setSelectionAction] = useState<"variable" | "text">("variable");
  const [replacementText, setReplacementText] = useState("");
  const [activeTermId, setActiveTermId] = useState<string | null>(null);
  const [variableSearch, setVariableSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [testedFingerprint, setTestedFingerprint] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const allMapped = terms.every((term) => term.variableKey);
  const readyForValidation = allMapped;
  const currentFingerprint = useMemo(() => fingerprint(terms, textReplacements), [terms, textReplacements]);
  const activeTerm = terms.find((term) => term.id === activeTermId) ?? null;
  const selectedText = activeTerm?.text ?? selectionText;
  const filteredCatalog = useMemo(() => {
    const search = variableSearch.trim().toLocaleLowerCase("pt-BR");
    return CATALOG.filter((entry) =>
      !search
      || `${entry.label} ${entry.section} ${aliases(entry.key)}`.toLocaleLowerCase("pt-BR").includes(search)
    );
  }, [variableSearch]);
  const catalogSections = useMemo(
    () => Array.from(new Set(filteredCatalog.map((entry) => entry.section))),
    [filteredCatalog],
  );

  const clearHighlights = useCallback(() => {
    const registry = (globalThis.CSS as unknown as { highlights?: { delete: (name: string) => void } } | undefined)?.highlights;
    registry?.delete("coala-template-markers");
  }, []);

  const refreshHighlights = useCallback(() => {
    const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const registry = (globalThis.CSS as unknown as { highlights?: { set: (name: string, value: unknown) => void } } | undefined)?.highlights;
    if (!HighlightConstructor || !registry) return;
    registry.set("coala-template-markers", new HighlightConstructor(...Array.from(markedRanges.current.values())));
  }, []);

  const renderDocx = useCallback(async (buffer: ArrayBuffer, host: HTMLDivElement | null) => {
    if (!host) return;
    host.replaceChildren();
    const { renderAsync } = await import("docx-preview");
    await renderAsync(buffer, host, undefined, {
      className: "coala-docx",
      inWrapper: true,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      useBase64URL: true,
    });
  }, []);

  useEffect(() => {
    if (!props.open) return;
    let active = true;
    setLoading(true);
    setMessage("");
    setStep(2);
    setTerms([]);
    setTextReplacements([]);
    setSelectionText("");
    setSelectionAction("variable");
    setReplacementText("");
    setActiveTermId(null);
    setVariableSearch("");
    setTestedFingerprint(null);
    markedRanges.current.clear();
    clearHighlights();
    void (async () => {
      try {
        const response = await fetch(`/api/documents/templates/${encodeURIComponent(props.templateId)}/editor`, {
          headers: { Authorization: `Bearer ${await props.getToken()}` },
          cache: "no-store",
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Falha ao abrir o documento.");
        }
        const buffer = await response.arrayBuffer();
        if (!active) return;
        await renderDocx(buffer, sourceHost.current);
      } catch (cause) {
        if (active) setMessage(cause instanceof Error ? cause.message : "Falha ao abrir o documento.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; clearHighlights(); };
  }, [clearHighlights, props.getToken, props.open, props.templateId, renderDocx]);

  function captureSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !sourceHost.current) return;
    const range = selection.getRangeAt(0);
    if (!sourceHost.current.contains(range.commonAncestorContainer)) return;
    const text = selection.toString().replace(/\u00a0/g, " ").trim();
    if (!text || text.length > 500) return;
    selectedRange.current = range.cloneRange();
    setSelectionText(text);
    setSelectionAction("variable");
    setReplacementText(text);
    setActiveTermId(null);
    setVariableSearch("");
    setMessage("");
  }

  function assignVariable(variableKey: string) {
    if (activeTermId) {
      setTerms((current) => current.map((term) => term.id === activeTermId ? { ...term, variableKey } : term));
      setActiveTermId(null);
      setVariableSearch("");
      setTestedFingerprint(null);
      return;
    }
    const text = selectionText.trim();
    const range = selectedRange.current;
    if (!text || !range) return;
    if (
      terms.some((term) => term.text.toLocaleLowerCase("pt-BR") === text.toLocaleLowerCase("pt-BR"))
      || textReplacements.some((edit) => edit.text.toLocaleLowerCase("pt-BR") === text.toLocaleLowerCase("pt-BR"))
    ) {
      setMessage("Esse mesmo texto já foi vinculado. Uma marcação vale para todas as ocorrências idênticas.");
      return;
    }
    const id = crypto.randomUUID();
    markedRanges.current.set(id, range);
    setTerms((current) => [...current, { id, text, variableKey }]);
    selectedRange.current = null;
    setSelectionText("");
    setVariableSearch("");
    setTestedFingerprint(null);
    window.getSelection()?.removeAllRanges();
    refreshHighlights();
  }

  function editTerm(term: MarkedTerm) {
    setActiveTermId(term.id);
    setSelectionText("");
    setSelectionAction("variable");
    setVariableSearch("");
  }

  function dismissSelection() {
    setSelectionText("");
    setActiveTermId(null);
    setVariableSearch("");
    setReplacementText("");
    selectedRange.current = null;
    window.getSelection()?.removeAllRanges();
  }

  function applyTextReplacement() {
    const text = selectionText.trim();
    const replacement = replacementText.trim();
    const range = selectedRange.current;
    if (!text || !replacement || !range) return;
    if (
      terms.some((term) => term.text.toLocaleLowerCase("pt-BR") === text.toLocaleLowerCase("pt-BR"))
      || textReplacements.some((edit) => edit.text.toLocaleLowerCase("pt-BR") === text.toLocaleLowerCase("pt-BR"))
    ) {
      setMessage("Esse trecho já possui uma alteração nesta edição.");
      return;
    }
    const id = crypto.randomUUID();
    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));
    setTextReplacements((current) => [...current, { id, text, replacement }]);
    selectedRange.current = null;
    setSelectionText("");
    setReplacementText("");
    setVariableSearch("");
    setTestedFingerprint(null);
    window.getSelection()?.removeAllRanges();
  }

  function removeTextReplacement(id: string) {
    setTextReplacements((current) => current.filter((edit) => edit.id !== id));
    setTestedFingerprint(null);
    setMessage("Alteração removida da gravação. Reabra a fase para restaurar a visualização original do trecho.");
  }

  function removeTerm(id: string) {
    markedRanges.current.delete(id);
    setTerms((current) => current.filter((term) => term.id !== id));
    if (activeTermId === id) setActiveTermId(null);
    setTestedFingerprint(null);
    refreshHighlights();
  }

  async function testTemplate() {
    if (!readyForValidation) return;
    setTesting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/documents/templates/${encodeURIComponent(props.templateId)}/editor`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await props.getToken()}` },
        body: JSON.stringify({
          action: "test",
          mappings: terms.map(({ text, variableKey }) => ({ text, variableKey })),
          textReplacements: textReplacements.map(({ text, replacement }) => ({ text, replacement })),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Falha ao testar o modelo.");
      }
      const buffer = await response.arrayBuffer();
      await renderDocx(buffer, previewHost.current);
      setTestedFingerprint(currentFingerprint);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao testar o modelo.");
    } finally {
      setTesting(false);
    }
  }

  async function finalizeTemplate() {
    if (!readyForValidation || testedFingerprint !== currentFingerprint) return;
    setFinalizing(true);
    setMessage("");
    try {
      const response = await fetch(`/api/documents/templates/${encodeURIComponent(props.templateId)}/editor`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await props.getToken()}` },
        body: JSON.stringify({
          action: "finalize",
          mappings: terms.map(({ text, variableKey }) => ({ text, variableKey })),
          textReplacements: textReplacements.map(({ text, replacement }) => ({ text, replacement })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao finalizar o modelo.");
      await props.onFinalized(`Modelo finalizado na versão ${payload.template?.version ?? "nova"}. ${payload.replacements} substituição(ões) aplicada(s).`);
      props.onOpenChange(false);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao finalizar o modelo.");
    } finally {
      setFinalizing(false);
    }
  }

  const stepItems = [
    { number: 1, label: "Mapeamento pela IA" },
    { number: 2, label: "Validar e editar" },
    { number: 3, label: "Teste visual" },
  ] as const;

  if (!props.open) return null;

  return (
    <section id="template-fields-phase" className="flex h-[min(760px,calc(100vh-140px))] min-h-[620px] w-full flex-col gap-0 overflow-hidden rounded-xl border bg-white shadow-sm">
        <header className="shrink-0 border-b px-5 py-4">
          <div className="flex items-center gap-3 pr-9">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-violet-700">Preparar campos do modelo</p>
              <h2 className="mt-0.5 truncate text-left text-base font-black text-slate-950">{props.templateName}</h2>
            </div>
            <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
              {stepItems.map((item) => {
                const current = step === item.number;
                const complete = step > item.number;
                return (
                  <div
                    key={item.number}
                    className={`inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 ${
                      current ? "border-violet-200 bg-violet-50" : complete ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
                    }`}
                  >
                    <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-black ${
                      current ? "bg-violet-700 text-white" : complete ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-400"
                    }`}>
                      {complete ? <Check className="h-3.5 w-3.5" /> : item.number}
                    </span>
                    <span className={`text-xs font-extrabold ${current ? "text-violet-700" : complete ? "text-emerald-700" : "text-slate-400"}`}>{item.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </header>

        {message ? <div className="shrink-0 border-b border-rose-100 bg-rose-50 px-5 py-2 text-xs font-semibold text-rose-700">{message}</div> : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className={`${step === 2 ? "grid" : "hidden"} h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_372px]`}>
            <div className="min-h-0 overflow-auto bg-[#eceae4] px-6 py-5" onMouseUp={captureSelection}>
              <div className="mb-3 flex justify-center">
                <span className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-xs text-slate-500 shadow-sm">
                  <Sparkles className="h-3.5 w-3.5 text-violet-700" />
                  Selecione um trecho no documento e confirme o significado ao lado.
                </span>
              </div>
              {loading ? <div className="grid h-full place-items-center"><Loader2 className="h-6 w-6 animate-spin text-violet-600" /></div> : null}
              <div ref={sourceHost} className="coala-docx-selection mx-auto min-h-full max-w-[760px]" />
            </div>

            <aside className="min-h-0 overflow-y-auto border-l bg-[#fbfaf8] p-4">
              {selectedText ? (
                <div className="rounded-xl border-2 border-violet-200 bg-white p-3.5 shadow-[0_10px_30px_-18px_rgba(109,40,217,.5)]">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-violet-700">Trecho selecionado</p>
                  <p className="mt-1.5 rounded-lg border border-dashed border-violet-200 bg-violet-50 px-3 py-2 text-[13px] font-bold text-slate-900">“{selectedText}”</p>
                  <div className="mt-3 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
                    <button
                      className={`h-8 rounded-md text-xs font-extrabold ${selectionAction === "variable" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"}`}
                      onClick={() => setSelectionAction("variable")}
                    >
                      Vincular variável
                    </button>
                    <button
                      className={`h-8 rounded-md text-xs font-extrabold ${selectionAction === "text" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"}`}
                      onClick={() => setSelectionAction("text")}
                    >
                      Editar texto
                    </button>
                  </div>
                  {selectionAction === "variable" ? (
                    <>
                      <p className="mt-3 text-xs font-extrabold text-slate-900">O que é este trecho?</p>
                      <div className="relative mt-2">
                        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <Input
                          className="h-9 pl-9 text-xs"
                          placeholder="Buscar por nome, CNPJ, função…"
                          value={variableSearch}
                          onChange={(event) => setVariableSearch(event.target.value)}
                        />
                      </div>
                      <div className="mt-2.5 max-h-56 space-y-3 overflow-y-auto pr-1">
                        {catalogSections.map((section) => (
                          <div key={section}>
                            <p className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-slate-400">{section}</p>
                            <div className="space-y-1">
                              {filteredCatalog.filter((entry) => entry.section === section).map((entry) => (
                                <button
                                  key={entry.key}
                                  className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs font-bold transition hover:border-violet-200 hover:bg-violet-50 ${
                                    activeTerm?.variableKey === entry.key ? "border-violet-200 bg-violet-50" : "bg-white"
                                  }`}
                                  onClick={() => assignVariable(entry.key)}
                                >
                                  <span>{entry.label}</span>
                                  {activeTerm?.variableKey === entry.key ? <Check className="h-3.5 w-3.5 text-violet-700" /> : null}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                        {filteredCatalog.length === 0 ? <p className="py-2 text-xs text-slate-500">Nenhum campo correspondente.</p> : null}
                      </div>
                    </>
                  ) : (
                    <div className="mt-3">
                      <label className="text-xs font-extrabold text-slate-900">Novo texto</label>
                      <textarea
                        className="mt-2 min-h-28 w-full resize-y rounded-lg border bg-white p-3 text-xs leading-relaxed text-slate-800"
                        value={replacementText}
                        onChange={(event) => setReplacementText(event.target.value)}
                      />
                      <p className="mt-1.5 text-[10px] leading-relaxed text-amber-700">Todas as ocorrências idênticas desse trecho serão alteradas no Word.</p>
                      <Button className="mt-3 w-full bg-violet-700 hover:bg-violet-800" disabled={!replacementText.trim() || replacementText.trim() === selectedText.trim()} onClick={applyTextReplacement}>
                        Aplicar alteração
                      </Button>
                    </div>
                  )}
                  <button className="mt-3 h-9 w-full rounded-lg border bg-white text-xs font-bold text-slate-500 hover:border-rose-200 hover:text-rose-600" onClick={dismissSelection}>
                    Cancelar seleção
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border bg-white p-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[13px] font-black text-slate-900">Progresso</p>
                    <p className="text-xs font-extrabold text-violet-700">{terms.length + textReplacements.length} alteração(ões)</p>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-700 to-violet-500 transition-all" style={{ width: terms.length || textReplacements.length ? "100%" : "0%" }} />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Cada alteração vale para <strong className="text-slate-800">todas as ocorrências idênticas</strong> no documento.</p>
                </div>
              )}

              <div className="mt-4">
                <p className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-emerald-700">
                  <Check className="h-3.5 w-3.5" />Vinculados ({terms.length})
                </p>
                <div className="mt-2 space-y-1.5">
                  {terms.map((term) => (
                    <div key={term.id} className="rounded-lg border bg-white px-3 py-2">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900">“{term.text}”</p>
                        <button aria-label="Alterar vínculo" className="text-violet-700" onClick={() => editTerm(term)}><Pencil className="h-3.5 w-3.5" /></button>
                        <button aria-label="Remover vínculo" className="text-slate-400 hover:text-rose-600" onClick={() => removeTerm(term.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-emerald-700">→ {CATALOG_BY_KEY.get(term.variableKey)?.label}</p>
                    </div>
                  ))}
                  {terms.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-500">
                      Selecione o primeiro trecho no documento.
                    </div>
                  ) : null}
                </div>
              </div>

              {textReplacements.length ? (
                <div className="mt-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-violet-700">
                    <Pencil className="h-3.5 w-3.5" />Textos alterados ({textReplacements.length})
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {textReplacements.map((edit) => (
                      <div key={edit.id} className="rounded-lg border bg-white px-3 py-2">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] text-slate-400 line-through">“{edit.text}”</p>
                            <p className="mt-1 text-xs font-bold text-slate-900">“{edit.replacement}”</p>
                          </div>
                          <button aria-label="Remover alteração" className="text-slate-400 hover:text-rose-600" onClick={() => removeTextReplacement(edit.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </aside>
          </div>

          <div className={`${step === 3 ? "grid" : "hidden"} h-full min-h-0 grid-cols-1 md:grid-cols-[372px_minmax(0,1fr)]`}>
            <aside className="min-h-0 overflow-y-auto border-r bg-[#fbfaf8] p-4">
              <h3 className="text-sm font-black text-slate-950">Teste visual e disponibilização</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">Gere o documento com dados fictícios, confira o resultado ao lado e aprove a preparação.</p>
              <div className="mt-3 space-y-1.5">
                {terms.map((term) => (
                  <div key={term.id} className="rounded-lg border bg-white px-3 py-2">
                    <p className="truncate text-xs font-bold text-slate-900">“{term.text}”</p>
                    <p className="mt-1 text-[11px] font-bold text-emerald-700">→ {CATALOG_BY_KEY.get(term.variableKey)?.label}</p>
                  </div>
                ))}
                {textReplacements.map((edit) => (
                  <div key={edit.id} className="rounded-lg border bg-white px-3 py-2">
                    <p className="truncate text-[11px] text-slate-400 line-through">“{edit.text}”</p>
                    <p className="mt-1 text-xs font-bold text-violet-700">→ “{edit.replacement}”</p>
                  </div>
                ))}
              </div>
              <Button variant="outline" className="mt-4 w-full gap-2" disabled={testing} onClick={() => void testTemplate()}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}Testar preenchimento
              </Button>
              <Button className="mt-2 w-full gap-2 bg-emerald-600 hover:bg-emerald-700" disabled={finalizing || testedFingerprint !== currentFingerprint} onClick={() => void finalizeTemplate()}>
                {finalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Aprovar e disponibilizar
              </Button>
              {testedFingerprint !== currentFingerprint ? (
                <p className="mt-2 flex items-center justify-center gap-1 text-center text-[10px] font-semibold text-amber-700"><CircleAlert className="h-3 w-3" />Execute o teste visual para liberar a aprovação.</p>
              ) : (
                <p className="mt-2 text-center text-[10px] font-semibold text-emerald-700">Teste atualizado. O modelo pode ser finalizado.</p>
              )}
            </aside>
            <div className="min-h-0 overflow-auto bg-[#eceae4] px-6 py-5">
              {testedFingerprint === null ? (
                <div className="grid h-full place-items-center text-center text-slate-500">
                  <div><Wand2 className="mx-auto h-8 w-8" /><p className="mt-2 text-sm font-extrabold text-slate-800">Clique em “Testar preenchimento”</p><p className="text-xs">O documento aparecerá aqui com valores de exemplo.</p></div>
                </div>
              ) : null}
              <div ref={previewHost} className="mx-auto min-h-full max-w-[760px]" />
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t bg-white px-5 py-3">
          <Button variant="ghost" className="gap-2 text-slate-500" onClick={() => props.onOpenChange(false)}><RotateCcw className="h-4 w-4" />Cancelar edição</Button>
          <div className="flex gap-2">
            {step === 3 ? <Button variant="outline" className="gap-2" onClick={() => setStep(2)}><ChevronLeft className="h-4 w-4" />Voltar</Button> : null}
            {step === 2 ? (
              <Button className="gap-2 bg-violet-700 hover:bg-violet-800" disabled={!readyForValidation} onClick={() => setStep(3)}>
                Continuar<ChevronRight className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </footer>
        <style jsx global>{`
          ::highlight(coala-template-markers) { background: #f5f3ff; color: #6d28d9; text-decoration: underline 2px #6d28d9; }
          .coala-docx-selection .docx-wrapper, .coala-docx-selection .coala-docx-wrapper { padding: 0 !important; background: transparent !important; }
          .coala-docx-selection section.docx, .coala-docx-selection .docx { box-shadow: 0 18px 40px -28px rgba(15,23,42,.4) !important; }
        `}</style>
    </section>
  );
}
