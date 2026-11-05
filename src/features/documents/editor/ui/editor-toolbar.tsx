"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Columns3,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Rows3,
  Table2,
  Trash2,
  Underline,
  Undo2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Limite de colunas aceito pelo servidor (`tableRow` com até 12 células). */
const MAX_TABLE_COLUMNS = 12;

type ToolbarItem = {
  id: string;
  /** Rótulo acessível no formato verbo + objeto. */
  label: string;
  content: ReactNode;
  active?: boolean;
  disabled: boolean;
  run: () => void;
};

function tableColumnCount(editor: Editor): number {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "table") return node.firstChild?.childCount ?? 0;
  }
  return 0;
}

export function EditorToolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const can = current.can();
      const columns = tableColumnCount(current);
      return {
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        underline: current.isActive("underline"),
        h1: current.isActive("heading", { level: 1 }),
        h2: current.isActive("heading", { level: 2 }),
        h3: current.isActive("heading", { level: 3 }),
        bullet: current.isActive("bulletList"),
        ordered: current.isActive("orderedList"),
        inTable: current.isActive("table"),
        canTable: can.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
        canAddRow: can.addRowAfter(),
        canAddColumn: can.addColumnAfter() && columns > 0 && columns < MAX_TABLE_COLUMNS,
        canDeleteTable: can.deleteTable(),
        canUndo: can.undo(),
        canRedo: can.redo(),
      };
    },
  });

  const run = (fn: () => boolean | void) => () => {
    fn();
  };
  const chain = () => editor.chain().focus();
  const items: ToolbarItem[] = [
    { id: "undo", label: "Desfazer alteração", content: <Undo2 aria-hidden className="h-4 w-4" />, disabled: disabled || !state.canUndo, run: run(() => chain().undo().run()) },
    { id: "redo", label: "Refazer alteração", content: <Redo2 aria-hidden className="h-4 w-4" />, disabled: disabled || !state.canRedo, run: run(() => chain().redo().run()) },
    { id: "bold", label: "Aplicar negrito", content: <Bold aria-hidden className="h-4 w-4" />, active: state.bold, disabled, run: run(() => chain().toggleBold().run()) },
    { id: "italic", label: "Aplicar itálico", content: <Italic aria-hidden className="h-4 w-4" />, active: state.italic, disabled, run: run(() => chain().toggleItalic().run()) },
    { id: "underline", label: "Aplicar sublinhado", content: <Underline aria-hidden className="h-4 w-4" />, active: state.underline, disabled, run: run(() => chain().toggleUnderline().run()) },
    { id: "h1", label: "Aplicar título 1", content: "Título 1", active: state.h1, disabled, run: run(() => chain().toggleHeading({ level: 1 }).run()) },
    { id: "h2", label: "Aplicar título 2", content: "Título 2", active: state.h2, disabled, run: run(() => chain().toggleHeading({ level: 2 }).run()) },
    { id: "h3", label: "Aplicar título 3", content: "Título 3", active: state.h3, disabled, run: run(() => chain().toggleHeading({ level: 3 }).run()) },
    { id: "bullet", label: "Aplicar lista com marcadores", content: <List aria-hidden className="h-4 w-4" />, active: state.bullet, disabled, run: run(() => chain().toggleBulletList().run()) },
    { id: "ordered", label: "Aplicar lista numerada", content: <ListOrdered aria-hidden className="h-4 w-4" />, active: state.ordered, disabled, run: run(() => chain().toggleOrderedList().run()) },
    { id: "table", label: "Inserir tabela 3 por 3", content: <Table2 aria-hidden className="h-4 w-4" />, disabled: disabled || !state.canTable, run: run(() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()) },
  ];
  if (state.inTable) {
    items.push(
      { id: "row", label: "Inserir linha abaixo", content: <Rows3 aria-hidden className="h-4 w-4" />, disabled: disabled || !state.canAddRow, run: run(() => chain().addRowAfter().run()) },
      { id: "col", label: "Inserir coluna à direita", content: <Columns3 aria-hidden className="h-4 w-4" />, disabled: disabled || !state.canAddColumn, run: run(() => chain().addColumnAfter().run()) },
      { id: "del", label: "Remover tabela", content: <Trash2 aria-hidden className="h-4 w-4" />, disabled: disabled || !state.canDeleteTable, run: run(() => chain().deleteTable().run()) },
    );
  }

  // Teclado: um único item da barra fica no ciclo de Tab; setas, Home e End movem o foco entre os itens.
  const [activeId, setActiveId] = useState("bold");
  const refs = useRef(new Map<string, HTMLButtonElement>());
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = items.filter((item) => !item.disabled);
    const index = enabled.findIndex((item) => item.id === activeId);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % enabled.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    if (next < 0 || enabled.length === 0) return;
    event.preventDefault();
    const target = enabled[next]!;
    setActiveId(target.id);
    refs.current.get(target.id)?.focus();
  }
  const tabStopId = items.some((item) => item.id === activeId && !item.disabled)
    ? activeId
    : items.find((item) => !item.disabled)?.id;

  return (
    <div
      role="toolbar"
      aria-label="Formatação do documento"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-center gap-1.5 rounded-ds-btn border border-ds-border bg-ds-warm p-1.5"
    >
      {items.map((item) => (
        <Button
          key={item.id}
          ref={(node) => {
            if (node) refs.current.set(item.id, node);
            else refs.current.delete(item.id);
          }}
          type="button"
          variant="ds-secondary"
          size="xs"
          aria-label={item.label}
          title={item.label}
          aria-pressed={item.active === undefined ? undefined : item.active}
          disabled={item.disabled}
          tabIndex={item.id === tabStopId ? 0 : -1}
          onFocus={() => setActiveId(item.id)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={item.run}
          className={cn(
            "min-w-8 focus-visible:ring-2 focus-visible:ring-ds-modal focus-visible:ring-offset-1",
            item.active && "border-ds-accent bg-ds-accent-soft text-ds-accent-ink",
          )}
        >
          {item.content}
        </Button>
      ))}
    </div>
  );
}
