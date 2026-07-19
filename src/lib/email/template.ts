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
  title: string;
  message: string;
  action?: {
    label: string;
    url: string;
  };
  secondaryAction?: {
    label: string;
    url: string;
  };
  footer?: string;
};

export function renderCoalaEmail(input: CoalaEmailTemplateInput) {
  const title = escapeHtml(input.title);
  const brandName = escapeHtml(input.brandName ?? "Coala One");
  const message = escapeHtml(input.message).replaceAll("\n", "<br />");
  const footer = escapeHtml(
    input.footer ?? "Essa é uma mensagem automática, não responda esse e-mail."
  );
  const action = input.action
    ? `<a href="${escapeHtml(input.action.url)}" style="display:inline-block;margin-top:20px;padding:12px 18px;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">${escapeHtml(input.action.label)}</a>`
    : "";
  const secondaryAction = input.secondaryAction
    ? `<p style="margin:18px 0 0;font-size:14px;line-height:1.5;color:#3b465a">Depois, acesse normalmente por aqui: <a href="${escapeHtml(input.secondaryAction.url)}" style="color:${BRAND_COLOR};font-weight:600">${escapeHtml(input.secondaryAction.label)}</a></p>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#172033">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
          <tr><td style="padding:24px 28px;background:${BRAND_COLOR};color:#ffffff;font-size:20px;font-weight:700">${brandName}</td></tr>
          <tr><td style="padding:30px 28px">
            <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25">${title}</h1>
            <p style="margin:0;font-size:16px;line-height:1.6;color:#3b465a">${message}</p>
            ${action}
            ${secondaryAction}
          </td></tr>
          <tr><td style="padding:18px 28px;border-top:1px solid #e7e9ee;font-size:12px;color:#697386">${footer}</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
