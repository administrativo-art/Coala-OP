"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TYPE_MS = 70;
const ERASE_MS = 35;
const HOLD_MS = 1600;
const GAP_MS = 400;

function subscribeReducedMotion(listener: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Texto de exemplo que se digita e se apaga sozinho enquanto o campo está vazio e sem foco.
 * Para quem pede menos movimento, mostra o primeiro exemplo parado.
 */
export function useTypingPlaceholder(prefix: string, examples: readonly string[], active: boolean) {
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => true);
  const key = examples.join("\u0000");
  const [state, setState] = useState({ key, index: 0, length: 0, erasing: false });
  // Trocar a lista de exemplos recomeça do primeiro.
  const fresh = state.key === key;
  const index = fresh ? state.index : 0;
  const length = fresh ? state.length : 0;
  const erasing = fresh ? state.erasing : false;
  const animate = active && !reduced && examples.length > 0;
  useEffect(() => {
    if (!animate) return;
    const total = examples.length;
    const example = examples[index % total] ?? "";
    const full = length >= example.length;
    const delay = erasing ? (length === 0 ? GAP_MS : ERASE_MS) : full ? HOLD_MS : TYPE_MS;
    const timer = window.setTimeout(() => setState(
      !erasing && full ? { key, index, length, erasing: true }
        : erasing && length === 0 ? { key, index: (index + 1) % total, length: 0, erasing: false }
        : { key, index, length: length + (erasing ? -1 : 1), erasing },
    ), delay);
    return () => window.clearTimeout(timer);
  }, [animate, examples, key, index, length, erasing]);
  if (!animate) return examples.length ? `${prefix} ${examples[0]}…` : `${prefix}…`;
  return `${prefix} ${(examples[index % examples.length] ?? "").slice(0, length)}`;
}

/** Busca do Acervo: filtra enquanto se digita; a aba decide o alcance. */
export function ArchiveSearchInput({ label, prefix, examples, value, onChange, className }: {
  label: string; prefix: string; examples: readonly string[]; value: string; onChange: (value: string) => void; className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const placeholder = useTypingPlaceholder(prefix, examples, !focused && value === "");
  return <div className={cn("relative w-full sm:w-72", className)}>
    <Search aria-hidden="true" className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" />
    <Input type="search" aria-label={label} aria-description="Separe termos por espaço; use aspas para uma frase exata." placeholder={placeholder} value={value}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Escape" && value) { event.preventDefault(); event.stopPropagation(); onChange(""); } }}
      className="h-9 bg-ds-surface pl-8 pr-8 text-xs [&::-webkit-search-cancel-button]:hidden" />
    {value && <button type="button" aria-label="Limpar busca" onClick={() => onChange("")} className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-ds-sm text-ds-ink-faint hover:bg-ds-muted hover:text-ds-ink"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>}
  </div>;
}
