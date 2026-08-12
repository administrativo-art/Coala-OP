import { renderEmailIconBox } from "@/lib/email/email-icon";

type TerminationAccountantEmailInput = {
  employeeName: string;
  protocol: string;
  companyName: string;
  companyCnpj: string;
  contractEndDate: string;
  legalPaymentDueDate: string;
  noticeLabel: string;
  documentsUrl: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dateBr(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function renderTerminationAccountantEmail(
  input: TerminationAccountantEmailInput
) {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#eee8f3;font-family:Arial,sans-serif;color:#202137">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eee8f3;padding:28px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fffdfc;border-radius:25px;overflow:hidden;box-shadow:0 12px 30px rgba(44,34,62,.08)">
          <tr>
            <td style="padding:24px 32px 18px;border-bottom:1px solid #eee9ee">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td valign="middle"><img src="https://op.coalashakes.com/coala-email-logo.jpg" width="88" alt="Coala Shakes" style="display:block;width:88px;height:auto;border:0" /></td>
                  <td align="right" valign="middle"><span style="display:inline-block;padding:7px 12px;border-radius:999px;background:#f2f0f4;color:#697087;font-size:10px;font-weight:800"><img src="https://op.coalashakes.com/email/icons/log-out-gray.png" width="12" height="12" alt="" style="display:inline-block;vertical-align:-2px;border:0" />&nbsp; Desligamento</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="padding:28px 32px 0">
            <h1 style="margin:0;font-size:22px;line-height:1.3;color:#202137">Processamento de desligamento</h1>
            <p style="margin:10px 0 0;font-size:12px;line-height:1.65;color:#596079">Resumo da rescisão do colaborador abaixo. Consulte e anexe os documentos pelo link seguro.</p>
          </td></tr>
          <tr><td style="padding:21px 32px 0">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e4e8;border-radius:17px;overflow:hidden">
              <tr><td style="padding:15px 19px;background:#202137;color:#fff">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td>
                      <div style="font-size:8px;font-weight:900;letter-spacing:1.2px;color:#9da2b6">COLABORADOR</div>
                      <div style="margin-top:4px;font-size:13px;font-weight:900">${escapeHtml(input.employeeName)}</div>
                    </td>
                    <td align="right">
                      <div style="font-size:8px;font-weight:900;letter-spacing:1.2px;color:#9da2b6">PROTOCOLO</div>
                      <div style="margin-top:4px;font-family:monospace;font-size:12px;font-weight:900;color:#89d8e8">${escapeHtml(input.protocol)}</div>
                    </td>
                  </tr>
                </table>
              </td></tr>
              <tr><td style="padding:0 19px">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:11px">
                  <tr><td style="padding:13px 0;border-bottom:1px solid #efedf0;color:#9297a8">Empresa</td><td align="right" style="padding:13px 0;border-bottom:1px solid #efedf0;font-weight:900;color:#202137">${escapeHtml(input.companyName)}</td></tr>
                  <tr><td style="padding:13px 0;border-bottom:1px solid #efedf0;color:#9297a8">CNPJ</td><td align="right" style="padding:13px 0;border-bottom:1px solid #efedf0;font-weight:900;color:#202137">${escapeHtml(input.companyCnpj)}</td></tr>
                  <tr><td style="padding:13px 0;border-bottom:1px solid #efedf0;color:#9297a8">Término do contrato</td><td align="right" style="padding:13px 0;border-bottom:1px solid #efedf0;font-weight:900;color:#202137">${escapeHtml(dateBr(input.contractEndDate))}</td></tr>
                  <tr><td style="padding:13px 0;border-bottom:1px solid #efedf0;color:#9297a8">Prazo legal</td><td align="right" style="padding:13px 0;border-bottom:1px solid #efedf0;font-weight:900;color:#e72d87">${escapeHtml(dateBr(input.legalPaymentDueDate))}</td></tr>
                  <tr><td style="padding:13px 0;color:#9297a8">Aviso prévio</td><td align="right" style="padding:13px 0"><span style="display:inline-block;padding:5px 10px;border-radius:999px;background:#e1f6fa;color:#1695ae;font-size:10px;font-weight:900">${escapeHtml(input.noticeLabel)}</span></td></tr>
                </table>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:22px 32px 28px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff1f7;border:1px solid #f7c8dc;border-radius:17px">
              <tr><td style="padding:19px 20px">
                <table role="presentation" cellspacing="0" cellpadding="0">
                  <tr>
                    <td width="20" align="center" valign="middle">${renderEmailIconBox({ src: "https://op.coalashakes.com/email/icons/lock-keyhole-white.png", iconSize: 12, boxSize: 18, background: "#d92778", radius: 5 })}</td>
                    <td valign="middle" style="padding-left:6px;font-size:9px;font-weight:900;letter-spacing:1.1px;color:#d92778">LINK SEGURO · VÁLIDO POR 30 DIAS</td>
                  </tr>
                </table>
                <div style="margin-top:9px;font-size:13px;line-height:1.5;font-weight:900;color:#202137">Consulte o resumo e anexe os documentos rescisórios pelo link seguro.</div>
                <a href="${escapeHtml(input.documentsUrl)}" style="display:inline-block;margin-top:14px;padding:13px 18px;border-radius:12px;background:#e92b86;color:#fff;text-decoration:none;font-size:12px;font-weight:900"><img src="https://op.coalashakes.com/email/icons/upload-white.png" width="14" height="14" alt="" style="display:inline-block;vertical-align:-3px;border:0" />&nbsp; Enviar documentos</a>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:18px 32px 23px;border-top:1px solid #eee9ee;font-size:10px;line-height:1.6;color:#9a91a0">
            Link individual, auditado e válido por 30 dias. Este é um e-mail automático e não aceita respostas.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function actionEmail(input: {
  eyebrow: string;
  title: string;
  lead: string;
  body?: string;
  actionLabel?: string;
  actionUrl?: string;
  footer?: string;
}) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f2edf2;font-family:Arial,sans-serif;color:#202137"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:24px;overflow:hidden"><tr><td style="padding:24px 30px;border-bottom:1px solid #eee9ee"><img src="https://op.coalashakes.com/coala-email-logo.jpg" width="88" alt="Coala Shakes" /></td></tr><tr><td style="padding:28px 30px"><div style="font-size:10px;font-weight:900;letter-spacing:1.2px;color:#d92778">${escapeHtml(input.eyebrow.toUpperCase())}</div><h1 style="margin:8px 0 0;font-size:22px;line-height:1.3">${escapeHtml(input.title)}</h1><p style="margin:12px 0 0;font-size:13px;line-height:1.65;color:#596079">${escapeHtml(input.lead)}</p>${input.body ? `<div style="margin-top:18px;padding:16px 18px;border-radius:15px;background:#fff3f8;border:1px solid #f5c8dc;font-size:13px;line-height:1.6;font-weight:700;color:#5f2942;white-space:pre-wrap">${escapeHtml(input.body)}</div>` : ""}${input.actionUrl && input.actionLabel ? `<a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;margin-top:20px;padding:13px 18px;border-radius:12px;background:#e92b86;color:#fff;text-decoration:none;font-size:12px;font-weight:900">${escapeHtml(input.actionLabel)}</a>` : ""}</td></tr><tr><td style="padding:17px 30px 22px;border-top:1px solid #eee9ee;font-size:10px;line-height:1.6;color:#918999">${escapeHtml(input.footer ?? "Comunicação automática registrada no processo de desligamento.")}</td></tr></table></td></tr></table></body></html>`;
}

export function renderTerminationLetterCorrectionEmail(input: { employeeName: string; protocol: string; reason: string; requestUrl: string }) {
  return actionEmail({
    eyebrow: `Pedido de demissão · ${input.protocol}`,
    title: "Precisamos de uma nova versão da sua carta",
    lead: `Olá, ${input.employeeName}. O RH conferiu a carta manuscrita e indicou uma correção antes da formalização eletrônica.`,
    body: input.reason,
    actionLabel: "Enviar nova carta",
    actionUrl: input.requestUrl,
  });
}

export function renderTerminationAccountantCorrectionEmail(input: { employeeName: string; protocol: string; reason: string; documentsUrl: string }) {
  return actionEmail({
    eyebrow: `Contabilidade · ${input.protocol}`,
    title: "Correção nos documentos rescisórios",
    lead: `A conferência do desligamento de ${input.employeeName} identificou itens que precisam ser substituídos ou complementados.`,
    body: input.reason,
    actionLabel: "Enviar correções",
    actionUrl: input.documentsUrl,
  });
}

export function renderTerminationEmployeeCompletionEmail(input: { employeeName: string; protocol: string; documentsUrl: string }) {
  return actionEmail({
    eyebrow: `Desligamento · ${input.protocol}`,
    title: "Seus documentos finais estão disponíveis",
    lead: `Olá, ${input.employeeName}. A formalização do seu desligamento foi concluída. Use o link seguro para consultar e baixar os documentos finais e o comprovante do pagamento, quando aplicável.`,
    actionLabel: "Acessar documentos finais",
    actionUrl: input.documentsUrl,
    footer: "Link individual e auditado. Não encaminhe esta mensagem a terceiros.",
  });
}

export function renderTerminationInternalReservationsEmail(input: { employeeName: string; protocol: string; reservations: string[] }) {
  return actionEmail({
    eyebrow: `Encerramento interno · ${input.protocol}`,
    title: "Comunicação sobre pendências do desligamento",
    lead: `Olá, ${input.employeeName}. O processo principal do seu desligamento foi concluído. No encerramento interno, o RH registrou as ocorrências abaixo.`,
    body: input.reservations.map((reservation) => `• ${reservation}`).join("\n"),
    footer: "Caso queira regularizar alguma situação, entre em contato com o Departamento Pessoal.",
  });
}
