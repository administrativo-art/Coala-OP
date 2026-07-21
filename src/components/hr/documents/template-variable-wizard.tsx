"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown, Eye, Highlighter, Loader2, RotateCcw, Save, Trash2, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DOCUMENT_VARIABLES } from "@/features/hr/integration/document-variables";

type MarkedTerm = { id: string; text: string; variableKey: string };

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

function VariablePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = CATALOG_BY_KEY.get(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-auto min-h-10 w-full justify-between whitespace-normal bg-white px-3 py-2 text-left text-xs">
          <span>{selected ? selected.label : "Escolha o significado do termo..."}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] max-w-[calc(100vw-32px)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Busque por colaborador, nome, CNPJ, função..." />
          <CommandList className="max-h-72">
            <CommandEmpty>Nenhum campo correspondente.</CommandEmpty>
            {Array.from(new Set(CATALOG.map((entry) => entry.section))).map((section) => (
              <CommandGroup key={section} heading={section}>
                {CATALOG.filter((entry) => entry.section === section).map((entry) => (
                  <CommandItem
                    key={entry.key}
                    value={`${entry.label} ${entry.section} ${aliases(entry.key)}`}
                    onSelect={() => { onChange(entry.key); setOpen(false); }}
                    className="items-start gap-2"
                  >
                    <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${value === entry.key ? "opacity-100" : "opacity-0"}`} />
                    <span>
                      <span className="block text-xs font-semibold">{entry.label}</span>
                      <span className="block text-[10px] text-slate-500">{entry.section}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function fingerprint(terms: MarkedTerm[]) {
  return terms.map((term) => `${term.text}\u0000${term.variableKey}`).join("\u0001");
}

export function TemplateVariableWizard(props: TemplateVariableWizardProps) {
  const sourceHost = useRef<HTMLDivElement>(null);
  const previewHost = useRef<HTMLDivElement>(null);
  const selectedRange = useRef<Range | null>(null);
  const markedRanges = useRef(new Map<string, Range>());
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [terms, setTerms] = useState<MarkedTerm[]>([]);
  const [selectionText, setSelectionText] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [testedFingerprint, setTestedFingerprint] = useState("");
  const [message, setMessage] = useState("");

  const allMapped = terms.length > 0 && terms.every((term) => term.variableKey);
  const currentFingerprint = useMemo(() => fingerprint(terms), [terms]);

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
    setStep(1);
    setTerms([]);
    setSelectionText("");
    setTestedFingerprint("");
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
        await renderDocx(buffer.slice(0), sourceHost.current);
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
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !sourceHost.current) {
      selectedRange.current = null;
      setSelectionText("");
      return;
    }
    const range = selection.getRangeAt(0);
    if (!sourceHost.current.contains(range.commonAncestorContainer)) return;
    const text = selection.toString().replace(/\u00a0/g, " ").trim();
    if (!text || text.length > 500) return;
    selectedRange.current = range.cloneRange();
    setSelectionText(text);
  }

  function addMarkedTerm() {
    const text = selectionText.trim();
    const range = selectedRange.current;
    if (!text || !range) return;
    if (terms.some((term) => term.text.toLocaleLowerCase("pt-BR") === text.toLocaleLowerCase("pt-BR"))) {
      setMessage("Esse mesmo texto já foi marcado. Uma marcação vale para todas as ocorrências idênticas no documento.");
      return;
    }
    const id = crypto.randomUUID();
    markedRanges.current.set(id, range);
    setTerms((current) => [...current, { id, text, variableKey: "" }]);
    selectedRange.current = null;
    setSelectionText("");
    window.getSelection()?.removeAllRanges();
    setMessage("");
    refreshHighlights();
  }

  function removeTerm(id: string) {
    markedRanges.current.delete(id);
    setTerms((current) => current.filter((term) => term.id !== id));
    setTestedFingerprint("");
    refreshHighlights();
  }

  function setVariable(id: string, variableKey: string) {
    setTerms((current) => current.map((term) => term.id === id ? { ...term, variableKey } : term));
    setTestedFingerprint("");
  }

  async function testTemplate() {
    if (!allMapped) return;
    setTesting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/documents/templates/${encodeURIComponent(props.templateId)}/editor`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await props.getToken()}` },
        body: JSON.stringify({ action: "test", mappings: terms.map(({ text, variableKey }) => ({ text, variableKey })) }),
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
    if (!allMapped || testedFingerprint !== currentFingerprint) return;
    setFinalizing(true);
    setMessage("");
    try {
      const response = await fetch(`/api/documents/templates/${encodeURIComponent(props.templateId)}/editor`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await props.getToken()}` },
        body: JSON.stringify({ action: "finalize", mappings: terms.map(({ text, variableKey }) => ({ text, variableKey })) }),
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

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex h-[94vh] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-xl p-0 xl:max-w-[1500px]">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Preparar campos do modelo · {props.templateName}</DialogTitle>
          <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-lg border text-xs">
            {[{ number: 1, label: "Marcar termos" }, { number: 2, label: "Vincular informações" }, { number: 3, label: "Testar e finalizar" }].map((item) => (
              <div key={item.number} className={`flex items-center justify-center gap-2 border-r px-3 py-2 last:border-r-0 ${step === item.number ? "bg-violet-600 font-bold text-white" : step > item.number ? "bg-emerald-50 font-semibold text-emerald-700" : "bg-slate-50 text-slate-500"}`}>
                <span className="grid h-5 w-5 place-items-center rounded-full border border-current text-[10px]">{step > item.number ? <Check className="h-3 w-3" /> : item.number}</span>
                {item.label}
              </div>
            ))}
          </div>
        </DialogHeader>

        {message ? <div className="mx-5 mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{message}</div> : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          {step === 1 ? (
            <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-h-0 overflow-auto bg-slate-200 p-5" onMouseUp={captureSelection}>
                {loading ? <div className="grid h-full place-items-center"><Loader2 className="h-6 w-6 animate-spin text-violet-600" /></div> : null}
                <div ref={sourceHost} className="coala-docx-selection mx-auto min-h-full" />
              </div>
              <aside className="min-h-0 overflow-y-auto border-l bg-white p-4">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="flex items-center gap-2 text-xs font-black text-amber-900"><Highlighter className="h-4 w-4" />Como marcar</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-800">Selecione com o mouse o conteúdo que será preenchido pelo sistema. Em seguida, clique em “Marcar seleção”.</p>
                </div>
                <Button className="mt-3 w-full gap-2" disabled={!selectionText} onClick={addMarkedTerm}><Highlighter className="h-4 w-4" />Marcar seleção</Button>
                {selectionText ? <p className="mt-2 rounded border bg-slate-50 p-2 text-[11px] text-slate-600">Selecionado: “{selectionText}”</p> : null}
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-black text-slate-800">Termos marcados ({terms.length})</p>
                  {terms.length === 0 ? <p className="text-[11px] text-slate-500">Nenhum termo marcado ainda.</p> : null}
                  {terms.map((term) => (
                    <div key={term.id} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2">
                      <span className="min-w-0 flex-1 break-words text-[11px] font-semibold text-slate-700">“{term.text}”</span>
                      <button aria-label="Remover marcação" className="text-rose-600" onClick={() => removeTerm(term.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="h-full overflow-y-auto bg-slate-50 p-5">
              <div className="mx-auto max-w-4xl space-y-3">
                <div className="rounded-lg border bg-white p-4">
                  <h3 className="text-sm font-black text-slate-900">O que cada termo representa?</h3>
                  <p className="mt-1 text-xs text-slate-500">Busque pelo significado. O código técnico do placeholder será gravado pelo sistema e não precisa ser conhecido pelo usuário.</p>
                </div>
                {terms.map((term, index) => (
                  <div key={term.id} className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-[1fr_1.2fr] md:items-center">
                    <div>
                      <span className="text-[10px] font-bold uppercase text-amber-700">Termo marcado {index + 1}</span>
                      <p className="mt-1 break-words rounded-md bg-amber-50 px-3 py-2 text-sm font-bold text-slate-800">“{term.text}”</p>
                    </div>
                    <div>
                      <span className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Informação correspondente</span>
                      <VariablePicker value={term.variableKey} onChange={(key) => setVariable(term.id, key)} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid h-full min-h-0 grid-cols-[330px_minmax(0,1fr)]">
              <aside className="min-h-0 overflow-y-auto border-r bg-white p-4">
                <h3 className="text-sm font-black text-slate-900">Conferência final</h3>
                <p className="mt-1 text-xs text-slate-500">O teste usa dados fictícios e não salva alterações. Confira o documento antes de finalizar.</p>
                <div className="mt-4 space-y-2">
                  {terms.map((term) => (
                    <div key={term.id} className="rounded-lg border p-2.5 text-[11px]">
                      <p className="font-bold text-slate-800">“{term.text}”</p>
                      <p className="mt-1 text-emerald-700">→ {CATALOG_BY_KEY.get(term.variableKey)?.label}</p>
                    </div>
                  ))}
                </div>
                <Button variant="outline" className="mt-4 w-full gap-2" disabled={testing} onClick={() => void testTemplate()}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}Testar preenchimento
                </Button>
                <Button className="mt-2 w-full gap-2 bg-emerald-700 hover:bg-emerald-800" disabled={finalizing || testedFingerprint !== currentFingerprint} onClick={() => void finalizeTemplate()}>
                  {finalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Finalizar modelo
                </Button>
                {testedFingerprint !== currentFingerprint ? <p className="mt-2 text-center text-[10px] text-amber-700">Execute o teste para liberar a finalização.</p> : <p className="mt-2 text-center text-[10px] font-semibold text-emerald-700">Teste atualizado. O modelo pode ser finalizado.</p>}
              </aside>
              <div className="min-h-0 overflow-auto bg-slate-200 p-5">
                {!testedFingerprint ? (
                  <div className="grid h-full place-items-center text-center text-slate-500"><div><Wand2 className="mx-auto h-8 w-8" /><p className="mt-2 text-sm font-bold">Clique em “Testar preenchimento”</p><p className="text-xs">O documento aparecerá aqui com valores de exemplo.</p></div></div>
                ) : null}
                <div ref={previewHost} className="mx-auto min-h-full" />
              </div>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between border-t bg-white px-5 py-3">
          <Button variant="ghost" className="gap-2" onClick={() => props.onOpenChange(false)}><RotateCcw className="h-4 w-4" />Cancelar edição</Button>
          <div className="flex gap-2">
            {step > 1 ? <Button variant="outline" className="gap-2" onClick={() => setStep((step - 1) as 1 | 2)}><ChevronLeft className="h-4 w-4" />Voltar</Button> : null}
            {step < 3 ? (
              <Button className="gap-2" disabled={step === 1 ? terms.length === 0 : !allMapped} onClick={() => setStep((step + 1) as 2 | 3)}>
                Continuar<ChevronRight className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </footer>
        <style jsx global>{`
          ::highlight(coala-template-markers) { background: #fde68a; color: #713f12; }
          .coala-docx-selection .docx-wrapper, .coala-docx-selection .coala-docx-wrapper { padding: 0 !important; background: transparent !important; }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
