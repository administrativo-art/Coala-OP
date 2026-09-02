const BRAND_COLOR = "#166534";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export type CoalaEmailTemplateInput = {
  brandName?: string;
  title?: string;
  message: string;
  afterActionMessage?: string;
  emphasis?: string;
  details?: Array<{
    label: string;
    value: string;
  }>;
  logoUrl?: string;
  highlightBlock?: {
    title?: string;
    text: string;
    note?: string;
    tone: "green" | "pink";
    action?: { label: string; url: string };
  };
  action?: {
    label: string;
    url: string;
  };
  secondaryAction?: {
    label: string;
    url: string;
  };
  secondaryActionLead?: string;
  secondaryActionVariant?: "link" | "highlight";
  footer?: string | null;
};

export function renderCoalaEmail(input: CoalaEmailTemplateInput) {
  const title = input.title ? escapeHtml(input.title) : "";
  const brandName = escapeHtml(input.brandName ?? "Coala One");
  const logoUrl = escapeHtml(input.logoUrl ?? "https://op.coalashakes.com/coala-email-logo.jpg");
  const message = escapeHtml(input.message).replaceAll("\n", "<br />");
  const afterActionMessage = input.afterActionMessage
    ? `<p style="margin:20px 0 0;font-size:16px;line-height:1.6;color:#3b465a">${escapeHtml(input.afterActionMessage).replaceAll("\n", "<br />")}</p>`
    : "";
  const emphasis = input.emphasis
    ? `<p style="margin:20px 0 0;font-size:16px;line-height:1.6;color:#273348"><strong>${escapeHtml(input.emphasis)}</strong></p>`
    : "";
  const details = input.details?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0 0;border-collapse:collapse;border-top:1px solid #e7e9ee">${input.details.map((item) => `<tr><td style="width:38%;padding:10px 12px 10px 0;border-bottom:1px solid #e7e9ee;font-size:13px;line-height:1.45;color:#697386;font-weight:700;vertical-align:top">${escapeHtml(item.label)}</td><td style="padding:10px 0;border-bottom:1px solid #e7e9ee;font-size:14px;line-height:1.45;color:#273348;font-weight:600;vertical-align:top">${escapeHtml(item.value)}</td></tr>`).join("")}</table>`
    : "";
  const highlightBlock = input.highlightBlock
    ? (() => {
        const green = input.highlightBlock?.tone === "green";
        const background = green ? "#ecfdf5" : "#fff1f7";
        const border = green ? "#86efac" : "#f9a8d4";
        const color = green ? "#166534" : "#9d174d";
        const actionColor = green ? "#166534" : "#ec4899";
        const blockTitle = input.highlightBlock?.title
          ? `<p style="margin:0 0 6px;font-size:17px;line-height:1.4;color:${color};font-weight:800">${escapeHtml(input.highlightBlock.title)}</p>`
          : "";
        const blockTextWeight = input.highlightBlock?.title ? "500" : "700";
        const blockNote = input.highlightBlock?.note
          ? `<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#697386">${escapeHtml(input.highlightBlock.note)}</p>`
          : "";
        const blockAction = input.highlightBlock?.action
          ? `<a href="${escapeHtml(input.highlightBlock.action.url)}" style="display:inline-block;margin-top:14px;padding:11px 18px;background:${actionColor};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700">${escapeHtml(input.highlightBlock.action.label)}</a>`
          : "";
        return `<div style="margin:22px 0 0;padding:20px;background:${background};border:1px solid ${border};border-radius:10px">${blockTitle}<p style="margin:0;font-size:15px;line-height:1.6;color:${color};font-weight:${blockTextWeight}">${escapeHtml(input.highlightBlock.text).replaceAll("\n", "<br />")}</p>${blockAction}${blockNote}</div>`;
      })()
    : "";
  const footer = input.footer === null
    ? ""
    : escapeHtml(input.footer ?? "Essa é uma mensagem automática, não responda esse e-mail.");
  const action = input.action
    ? `<a href="${escapeHtml(input.action.url)}" style="display:inline-block;margin-top:20px;padding:12px 18px;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">${escapeHtml(input.action.label)}</a>`
    : "";
  const secondaryAction = input.secondaryAction
    ? input.secondaryActionVariant === "highlight"
      ? `<div style="margin:24px 0 0;padding:18px 20px;background:#fff1f7;border:1px solid #f9a8d4;border-radius:10px"><p style="margin:0;font-size:16px;line-height:1.5;color:#3b465a;font-weight:700">${escapeHtml(input.secondaryActionLead ?? "Depois, acesse normalmente por aqui:")}</p><a href="${escapeHtml(input.secondaryAction.url)}" style="display:inline-block;margin-top:12px;padding:11px 18px;background:#ec4899;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700">${escapeHtml(input.secondaryAction.label)}</a></div>`
      : `<p style="margin:18px 0 0;font-size:14px;line-height:1.5;color:#3b465a">${escapeHtml(input.secondaryActionLead ?? "Depois, acesse normalmente por aqui:")} <a href="${escapeHtml(input.secondaryAction.url)}" style="color:${BRAND_COLOR};font-weight:600">${escapeHtml(input.secondaryAction.label)}</a></p>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#172033">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
          <tr><td style="padding:18px 28px;background:#ffffff;border-bottom:1px solid #e7e9ee"><img src="${logoUrl}" width="150" alt="${brandName}" style="display:block;width:150px;height:auto;border:0" /><span style="display:none">${brandName}</span></td></tr>
          <tr><td style="padding:30px 28px">
            ${title ? `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25">${title}</h1>` : ""}
            <p style="margin:0;font-size:16px;line-height:1.6;color:#3b465a">${message}</p>
            ${details}
            ${highlightBlock}
            ${emphasis}
            ${action}
            ${afterActionMessage}
            ${secondaryAction}
          </td></tr>
          ${footer ? `<tr><td style="padding:18px 28px;border-top:1px solid #e7e9ee;font-size:12px;color:#697386">${footer}</td></tr>` : ""}
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
