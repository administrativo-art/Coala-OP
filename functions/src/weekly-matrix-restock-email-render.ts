export type RestockRow = {
  baseName: string;
  baseUnit: string;
  stock: number;
  minimum: number;
  shortage: number;
  supplier?: string;
  productDetail?: string;
  orderLabel?: string;
  orderQuantity?: number;
  incomingLabel?: string;
  incomingSupplier?: string;
  expectedDate?: string;
  projectedRemaining?: number;
  issue?: string;
  issueDetail?: string;
};

export type RestockRows = { buy: RestockRow[]; incoming: RestockRow[]; undefined: RestockRow[] };

const TIME_ZONE = "America/Belem";
const color = {
  page: "#efece6", surface: "#ffffff", border: "#e3dfd6", divider: "#f1eee8",
  ink: "#1a1b1f", muted: "#5f646c", dark: "#1a1b1f", darkMuted: "#c9c7cf",
  accent: "#d13670", accentInk: "#a6325b", accentSoft: "#fbe7ef", kicker: "#f08bb1",
  infoBg: "#eef3fe", info: "#1d4ed8", alertBg: "#fff7e6", alertInk: "#6b4500",
  okBg: "#e8f5ee", ok: "#147337",
};

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function amount(value: number) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function quantity(value: number, unit: string) {
  return `${amount(value)} ${unit}`;
}

/** Data local (AAAA-MM-DD) em Belém, usada no id do envio e para saber se a entrega atrasou. */
export function localDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function shortDate(value: string) {
  const [, month, day] = value.slice(0, 10).split("-");
  return day && month ? `${day}/${month}` : value;
}

function longDate(now: Date) {
  const text = new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" }).format(now);
  return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
}

function time(now: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(now);
}

function isOverdue(expectedDate: string | undefined, now: Date) {
  return Boolean(expectedDate) && expectedDate!.slice(0, 10) < localDate(now);
}

function groupBySupplier(rows: RestockRow[]) {
  const grouped = new Map<string, RestockRow[]>();
  for (const row of rows) {
    const key = row.supplier || "Fornecedor não identificado";
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.entries()];
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function renderSubject(rows: RestockRows, now: Date) {
  const day = shortDate(localDate(now));
  const lead = rows.buy.length ? `${rows.buy.length} para comprar` : "nada para comprar";
  return `Reposição da Matriz: ${lead} · ${day}`;
}

export function renderPreheader(rows: RestockRows) {
  const suppliers = groupBySupplier(rows.buy).map(([name]) => name);
  const counts = `${rows.incoming.length} a caminho, ${rows.undefined.length} sem definição.`;
  return suppliers.length ? `${counts} Fornecedores: ${suppliers.join(", ")}.` : counts;
}

function sectionTitle(title: string, description: string) {
  return `<tr><td style="padding:28px 28px 0"><div style="font-size:17px;font-weight:800">${escapeHtml(title)}</div><div style="font-size:12.5px;color:${color.muted};margin-top:2px">${escapeHtml(description)}</div></td></tr>`;
}

function emptyLine(text: string) {
  return `<tr><td style="padding:10px 28px 0;font-size:13px;color:${color.muted}">${escapeHtml(text)}</td></tr>`;
}

function pill(text: string, background: string, ink: string) {
  return `<span style="display:inline-block;background:${background};color:${ink};font-size:11.5px;font-weight:800;padding:4px 9px;border-radius:999px;white-space:nowrap">${escapeHtml(text)}</span>`;
}

function summaryTile(count: number, label: string, background: string, ink: string, padding: string) {
  return `<td width="33%" style="padding:${padding}"><div style="background:${background};border-radius:10px;padding:12px 14px"><div style="font-size:26px;font-weight:800;color:${ink}">${count}</div><div style="font-size:12px;font-weight:700;color:${ink}">${escapeHtml(label)}</div></div></td>`;
}

function nameCell(name: string, detail?: string, border = true) {
  const line = border ? `border-top:1px solid ${color.divider};` : "";
  return `<td style="padding:10px 0;${line}"><div style="font-weight:700">${escapeHtml(name)}</div>${detail ? `<div style="font-size:12px;color:${color.muted}">${escapeHtml(detail)}</div>` : ""}</td>`;
}

function buySupplierBlock(supplier: string, rows: RestockRow[]) {
  const cell = (content: string, extra: string, index: number) =>
    `<td style="padding:10px 8px;${index ? `border-top:1px solid ${color.divider};` : ""}text-align:right;white-space:nowrap;${extra}">${content}</td>`;
  const header = ["Tem / mín.", "Comprar", "Pedir"].map((label, index) =>
    `<td style="padding:8px ${index === 2 ? "0" : "8px"} 6px;font-weight:700;text-align:right">${label}</td>`).join("");
  const body = rows.map((row, index) => `<tr>${nameCell(row.baseName, row.productDetail, index > 0)}${cell(`${amount(row.stock)} / ${quantity(row.minimum, row.baseUnit)}`, `color:${color.muted}`, index)}${cell(escapeHtml(quantity(row.shortage, row.baseUnit)), "", index)}${cell(escapeHtml(`${row.orderQuantity} ${row.orderLabel}`), "font-weight:800;padding-right:0", index)}</tr>`).join("");
  return `<tr><td style="padding:16px 28px 0"><div style="font-size:13px;font-weight:800;padding:8px 0;border-bottom:2px solid ${color.ink}">${escapeHtml(supplier)} <span style="font-weight:600;color:${color.muted}">· ${plural(rows.length, "item", "itens")}</span></div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px"><tr style="color:${color.muted};font-size:11px;text-transform:uppercase;letter-spacing:.08em"><td style="padding:8px 0 6px;font-weight:700">Insumo</td>${header}</tr>${body}</table></td></tr>`;
}

function incomingDetail(row: RestockRow, now: Date) {
  const parts = [row.incomingSupplier, row.incomingLabel].filter(Boolean).map(escapeHtml);
  if (row.expectedDate) {
    const label = `previsão ${shortDate(row.expectedDate)}`;
    parts.push(isOverdue(row.expectedDate, now)
      ? `<span style="color:${color.accentInk};font-weight:700">${escapeHtml(label)}, atrasada</span>`
      : escapeHtml(label));
  }
  return parts.join(" · ");
}

function incomingBlock(rows: RestockRow[], now: Date) {
  const body = rows.map(row => {
    const remaining = row.projectedRemaining ?? 0;
    const status = remaining > 0
      ? pill(`Ainda faltam ${quantity(remaining, row.baseUnit)}`, color.alertBg, color.alertInk)
      : pill("Cobre a falta", color.okBg, color.ok);
    return `<tr><td style="padding:10px 0;border-bottom:1px solid ${color.divider}"><div style="font-weight:700">${escapeHtml(row.baseName)}</div><div style="font-size:12px;color:${color.muted}">${incomingDetail(row, now)}</div></td><td style="padding:10px 0;border-bottom:1px solid ${color.divider};text-align:right">${status}</td></tr>`;
  }).join("");
  return `<tr><td style="padding:10px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">${body}</table></td></tr>`;
}

function undefinedBlock(rows: RestockRow[]) {
  const body = rows.map(row => {
    const detail = [`Comprar ${quantity(row.shortage, row.baseUnit)}`, row.issueDetail].filter(Boolean).join(" · ");
    return `<tr><td style="padding:10px 0;border-bottom:1px solid ${color.divider}"><div style="font-weight:700">${escapeHtml(row.baseName)}</div><div style="font-size:12px;color:${color.muted}">${escapeHtml(detail)}</div></td><td style="padding:10px 0;border-bottom:1px solid ${color.divider};text-align:right;font-size:12px;font-weight:700;color:${color.alertInk};white-space:nowrap">${escapeHtml(row.issue)}</td></tr>`;
  }).join("");
  return `<tr><td style="padding:10px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">${body}</table></td></tr>`;
}

const FOOTER = [
  "Relatório automático de toda segunda-feira. Nenhum pedido é criado sozinho.",
  "O estoque já desconta reservas. Compras a caminho não alteram o estoque atual; só entram as confirmadas com destino à Matriz.",
];

export function renderEmail(rows: RestockRows, now: Date, repositionUrl: string) {
  const buyHtml = rows.buy.length
    ? groupBySupplier(rows.buy).map(([supplier, supplierRows]) => buySupplierBlock(supplier, supplierRows)).join("")
    : emptyLine("Nenhuma compra sugerida nesta semana.");
  const incomingHtml = rows.incoming.length ? incomingBlock(rows.incoming, now) : emptyLine("Nenhuma compra a caminho para itens abaixo do mínimo.");
  const undefinedHtml = rows.undefined.length ? undefinedBlock(rows.undefined) : emptyLine("Nenhum item sem definição.");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(renderSubject(rows, now))}</title></head>
<body style="margin:0;padding:0;background:${color.page};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${color.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(renderPreheader(rows))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${color.page}"><tr><td align="center" style="padding:20px 12px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:${color.surface};border-radius:14px;overflow:hidden;border:1px solid ${color.border}">
<tr><td style="background:${color.dark};padding:24px 28px"><div style="font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${color.kicker}">Coala One · Estoque</div><div style="font-size:24px;font-weight:800;color:#ffffff;margin-top:6px">Reposição da Matriz</div><div style="font-size:13px;color:${color.darkMuted};margin-top:4px">${escapeHtml(longDate(now))} · calculado às ${escapeHtml(time(now))}</div></td></tr>
<tr><td style="padding:22px 28px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${summaryTile(rows.buy.length, "Para comprar", color.accentSoft, color.accentInk, "0 6px 0 0")}${summaryTile(rows.incoming.length, "A caminho", color.infoBg, color.info, "0 3px")}${summaryTile(rows.undefined.length, "Sem definição", color.alertBg, color.alertInk, "0 0 0 6px")}</tr></table></td></tr>
<tr><td style="padding:16px 28px 4px"><a href="${escapeHtml(repositionUrl)}" style="display:inline-block;background:${color.accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;padding:11px 18px;border-radius:9px">Abrir reposição no Coala One</a></td></tr>
${sectionTitle("Para comprar", "Pedido sugerido pela embalagem da última compra confirmada.")}${buyHtml}
${sectionTitle("A caminho", "Compras confirmadas para a Matriz que ainda não deram entrada no estoque.")}${incomingHtml}
${sectionTitle("Sem definição", "Abaixo do mínimo, mas o sistema não sabe de quem comprar.")}${undefinedHtml}
<tr><td style="padding:28px 28px 24px"><div style="border-top:1px solid ${color.border};padding-top:14px;font-size:11.5px;line-height:1.6;color:${color.muted}">${FOOTER.map(escapeHtml).join("<br>")}</div></td></tr>
</table></td></tr></table></body></html>`;
}

/** Versão em texto puro enviada junto com o HTML, para leitores simples e filtros de spam. */
export function renderText(rows: RestockRows, now: Date, repositionUrl: string) {
  const lines = [`Reposição da Matriz — ${longDate(now)}, calculado às ${time(now)}`, "", `${rows.buy.length} para comprar · ${rows.incoming.length} a caminho · ${rows.undefined.length} sem definição`, `Abrir no Coala One: ${repositionUrl}`, "", "PARA COMPRAR"];
  if (!rows.buy.length) lines.push("Nenhuma compra sugerida nesta semana.");
  for (const [supplier, supplierRows] of groupBySupplier(rows.buy)) {
    lines.push("", supplier);
    for (const row of supplierRows) {
      lines.push(`- ${row.baseName}${row.productDetail ? ` (${row.productDetail})` : ""}: tem ${amount(row.stock)} / mín. ${quantity(row.minimum, row.baseUnit)} · comprar ${quantity(row.shortage, row.baseUnit)} · pedir ${row.orderQuantity} ${row.orderLabel}`);
    }
  }
  lines.push("", "A CAMINHO");
  if (!rows.incoming.length) lines.push("Nenhuma compra a caminho para itens abaixo do mínimo.");
  for (const row of rows.incoming) {
    const remaining = row.projectedRemaining ?? 0;
    const expected = row.expectedDate ? ` · previsão ${shortDate(row.expectedDate)}${isOverdue(row.expectedDate, now) ? " (atrasada)" : ""}` : "";
    lines.push(`- ${row.baseName}: ${[row.incomingSupplier, row.incomingLabel].filter(Boolean).join(" · ")}${expected} · ${remaining > 0 ? `ainda faltam ${quantity(remaining, row.baseUnit)}` : "cobre a falta"}`);
  }
  lines.push("", "SEM DEFINIÇÃO");
  if (!rows.undefined.length) lines.push("Nenhum item sem definição.");
  for (const row of rows.undefined) {
    lines.push(`- ${row.baseName}: comprar ${quantity(row.shortage, row.baseUnit)} · ${row.issue}${row.issueDetail ? ` (${row.issueDetail})` : ""}`);
  }
  lines.push("", ...FOOTER);
  return lines.join("\n");
}
