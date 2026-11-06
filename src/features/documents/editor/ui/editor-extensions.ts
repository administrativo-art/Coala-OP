import { Extension, Node, mergeAttributes, type Extensions } from "@tiptap/core";
import { ListItem, OrderedList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";

import { getDocumentVariable } from "@/features/hr/integration/document-variables";

/**
 * Campo do sistema como nó inline atômico. O JSON gerado é `{type:"documentField",attrs:{key}}`,
 * idêntico ao aceito por `parseEditorContent` (o servidor continua sendo a fronteira de confiança:
 * esta configuração só reduz o que o editor consegue produzir).
 */
export const DocumentField = Node.create({
  name: "documentField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      key: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-document-field") ?? "",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-document-field]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const key = String(node.attrs.key ?? "");
    const variable = getDocumentVariable(key);
    const label = variable?.label ?? "Campo desconhecido";
    const sensitive = variable?.sensitive === true;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-document-field": key,
        "data-sensitive": sensitive ? "true" : undefined,
        contenteditable: "false",
        role: "img",
        "aria-label": `Campo do sistema: ${label}${sensitive ? " (dado sensível)" : ""}`,
        class: "ds-document-field",
      }),
      label,
    ];
  },

  renderText({ node }) {
    return getDocumentVariable(String(node.attrs.key ?? ""))?.label ?? "";
  },
});

/** Limites do esquema do servidor (`content-schema.ts`); o servidor continua validando. */
const MAX_CELL_SPAN = 12;
const MAX_LIST_START = 9999;

function clampInt(raw: string | null, min: number, max: number, fallback: number) {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Só `start` (1..9999): o atributo `type` do Tiptap (a, A, i, I) não existe no esquema do servidor. */
const SafeOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element: HTMLElement) => clampInt(element.getAttribute("start"), 1, MAX_LIST_START, 1),
      },
    };
  },
});

/** O servidor aceita apenas parágrafo e listas dentro de item de lista (sem título nem tabela). */
const SafeListItem = ListItem.extend({ content: "paragraph (paragraph | bulletList | orderedList)*" });

const CELL_CONTENT = "(paragraph | bulletList | orderedList)+";

/** Atributos de célula aceitos pelo servidor: colspan/rowspan 1..12 e `colwidth` sempre nulo (sem `align`). */
function safeCellAttributes() {
  return {
    colspan: {
      default: 1,
      parseHTML: (element: HTMLElement) => clampInt(element.getAttribute("colspan"), 1, MAX_CELL_SPAN, 1),
    },
    rowspan: {
      default: 1,
      parseHTML: (element: HTMLElement) => clampInt(element.getAttribute("rowspan"), 1, MAX_CELL_SPAN, 1),
    },
    colwidth: { default: null, parseHTML: () => null },
  };
}
const SafeTableCell = TableCell.extend({ content: CELL_CONTENT, addAttributes: safeCellAttributes });
const SafeTableHeader = TableHeader.extend({ content: CELL_CONTENT, addAttributes: safeCellAttributes });

const ATOM_TYPES = new Set(["documentField", "hardBreak"]);
const atomMarksKey = new PluginKey("documentAtomMarks");

/**
 * Campo do sistema e quebra de linha não carregam marcas no esquema do servidor (objeto estrito),
 * mas o ProseMirror permite marcar nós inline atômicos (ex.: negrito sobre uma seleção que os inclui).
 * Esta correção remove as marcas desses nós nos trechos alterados, mantendo o JSON aceitável.
 */
export function stripAtomMarks(transactions: readonly Transaction[], newState: EditorState): Transaction | null {
  if (!transactions.some((tr) => tr.docChanged)) return null;
  // Percorre o documento inteiro: AddMarkStep tem mapa vazio (não revela o trecho alterado) e o
  // teto de 5.000 nós do servidor mantém o custo desprezível frente a uma digitação.
  let fix: Transaction | null = null;
  newState.doc.descendants((node, pos) => {
    if (ATOM_TYPES.has(node.type.name) && node.marks.length > 0) {
      fix ??= newState.tr;
      for (const mark of node.marks) fix.removeMark(pos, pos + node.nodeSize, mark.type);
    }
    return !node.isAtom;
  });
  return fix;
}

export function createAtomMarksPlugin() {
  return new Plugin({ key: atomMarksKey, appendTransaction: (transactions, _old, newState) => stripAtomMarks(transactions, newState) });
}

const AtomMarksGuard = Extension.create({
  name: "documentAtomMarksGuard",
  addProseMirrorPlugins() {
    return [createAtomMarksPlugin()];
  },
});

/**
 * Tudo que o esquema do servidor não aceita fica desligado (blockquote, código, régua, tachado,
 * link). `underline` fica ligado (marca permitida). Tabela sem redimensionamento (sem `colwidth`).
 * `trailingNode` permanece (parágrafo vazio final, aceito pelo servidor) para poder digitar após tabela.
 */
export function createEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      strike: false,
      link: false,
      orderedList: false,
      listItem: false,
      heading: { levels: [1, 2, 3] },
    }),
    SafeOrderedList,
    SafeListItem,
    Table.configure({ resizable: false }),
    TableRow,
    SafeTableHeader,
    SafeTableCell,
    DocumentField,
    AtomMarksGuard,
  ];
}
