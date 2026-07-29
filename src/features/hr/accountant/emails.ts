import { renderEmailIconBox } from "@/lib/email/email-icon";

export type AccountantAdmissionEmailInput = {
  candidateName: string;
  jobFunction: string;
  companyName: string;
  companyCnpj: string;
  admissionDate: string;
  attachmentLabels: string[];
  registryUploadUrl: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function accountantAdmissionEmailContent(input: AccountantAdmissionEmailInput) {
  const detailsBlock = [
    `Colaboradora: ${input.candidateName}`,
    `Cargo: ${input.jobFunction}`,
    `Empresa: ${input.companyName}`,
    `CNPJ: ${input.companyCnpj}`,
    `Data de admissão: ${input.admissionDate}`,
  ].join('\n');

  const attachments = input.attachmentLabels.map((label) => `• ${label}`).join('\n');
  const afterDetailsMessage = [
    'Documentos anexados:',
    '',
    attachments,
    '',
    'Importante: os demais contratos, termos e documentos internos da admissão serão preparados e tratados diretamente pela empresa, incluindo o contrato de trabalho por prazo de experiência, documentos relacionados à LGPD, banco de horas, vale-transporte, consentimento para uso de imagem e voz e outros termos internos.',
    '',
    'Não é necessário elaborar nem encaminhar esses documentos.',
  ].join('\n');

  return {
    subject: `Admissão - Documentos para registro - ${input.candidateName}`,
    title: undefined,
    message: 'Prezados, boa tarde.\n\nEncaminhamos os documentos necessários para o registro admissional da colaboradora abaixo:',
    detailsBlock,
    afterDetailsMessage,
    registryUploadLead: 'Após concluir o registro, envie somente a Ficha de Registro de Empregado pelo link abaixo.',
    registryUploadLabel: 'Enviar ficha de registro',
    registryUploadUrl: input.registryUploadUrl,
    text: [
      'Prezados, boa tarde.',
      '',
      'Encaminhamos os documentos necessários para o registro admissional da colaboradora abaixo:',
      '',
      detailsBlock,
      '',
      afterDetailsMessage,
      '',
      'Após concluir o registro, envie somente a Ficha de Registro de Empregado pelo link abaixo.',
      input.registryUploadUrl,
    ].join('\n'),
  };
}

export function renderAccountantAdmissionEmail(input: AccountantAdmissionEmailInput) {
  const initials = input.candidateName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
  const attachmentRows = Array.from(
    { length: Math.ceil(input.attachmentLabels.length / 2) },
    (_, rowIndex) => {
      const rowItems = input.attachmentLabels.slice(rowIndex * 2, rowIndex * 2 + 2);
      return `<tr>${rowItems
        .map(
          (label) => `
            <td width="50%" valign="top" style="padding:${rowIndex === 0 ? '0' : '7px'} 3px 0">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #eee8ee;border-radius:11px;background:#fff">
                <tr>
                  <td width="32" align="center" valign="middle" style="padding:10px 0 10px 8px">${renderEmailIconBox({ src: "https://op.coalashakes.com/email/icons/file-text-pink.png", iconSize: 13, boxSize: 26, background: "#fff0f6", radius: 8 })}</td>
                  <td style="padding:10px 9px;font-size:10px;line-height:1.35;font-weight:800;color:#202137">${escapeHtml(label)}</td>
                </tr>
              </table>
            </td>`
        )
        .join('')}${rowItems.length === 1 ? '<td width="50%"></td>' : ''}</tr>`;
    }
  ).join('');

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
                  <td align="right" valign="middle"><span style="display:inline-block;padding:7px 12px;border-radius:999px;background:#e9f8fc;color:#1594ae;font-size:10px;font-weight:800"><img src="https://op.coalashakes.com/email/icons/file-text-pink.png" width="12" height="12" alt="" style="display:inline-block;vertical-align:-2px;border:0" />&nbsp; Registro admissional</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="padding:28px 32px 0">
            <h1 style="margin:0;font-size:20px;line-height:1.3;color:#202137">Prezados, boa tarde.</h1>
            <p style="margin:12px 0 0;font-size:12px;line-height:1.65;color:#596079">Encaminhamos os documentos necessários para o registro admissional da colaboradora abaixo.</p>
          </td></tr>
          <tr><td style="padding:21px 32px 0">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #f0dbe5;border-radius:17px;overflow:hidden">
              <tr><td style="padding:13px 18px;background:#fff0f6;border-bottom:1px solid #f0dbe5">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
                  <td width="38"><span style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;border-radius:11px;background:#e72d87;color:#fff;font-size:12px;font-weight:900">${escapeHtml(initials)}</span></td>
                  <td style="padding-left:10px"><div style="font-size:8px;font-weight:900;letter-spacing:1.1px;color:#d92778">COLABORADORA</div><div style="margin-top:3px;font-size:14px;font-weight:900;color:#202137">${escapeHtml(input.candidateName)}</div></td>
                </tr></table>
              </td></tr>
              <tr><td style="padding:0 18px">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:11px">
                  <tr><td style="padding:11px 0;border-bottom:1px solid #f0edf0;color:#9297a8">Cargo</td><td align="right" style="padding:11px 0;border-bottom:1px solid #f0edf0;font-weight:800;color:#202137">${escapeHtml(input.jobFunction)}</td></tr>
                  <tr><td style="padding:11px 0;border-bottom:1px solid #f0edf0;color:#9297a8">Empresa</td><td align="right" style="padding:11px 0;border-bottom:1px solid #f0edf0;font-weight:800;color:#202137">${escapeHtml(input.companyName)}</td></tr>
                  <tr><td style="padding:11px 0;border-bottom:1px solid #f0edf0;color:#9297a8">CNPJ</td><td align="right" style="padding:11px 0;border-bottom:1px solid #f0edf0;font-weight:800;color:#202137">${escapeHtml(input.companyCnpj)}</td></tr>
                  <tr><td style="padding:11px 0;color:#9297a8">Data de admissão</td><td align="right" style="padding:11px 0;font-weight:900;color:#e72d87">${escapeHtml(input.admissionDate)}</td></tr>
                </table>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:22px 29px 0">
            <div style="padding:0 3px 10px;font-size:9px;font-weight:900;letter-spacing:1.1px;color:#83899d">DOCUMENTOS ANEXADOS · ${input.attachmentLabels.length} ARQUIVOS</div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${attachmentRows}</table>
          </td></tr>
          <tr><td style="padding:22px 32px 0">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e6eb;border-radius:14px;background:#f7f7f9">
              <tr>
                <td width="26" valign="top" style="padding:17px 0 17px 17px"><img src="https://op.coalashakes.com/email/icons/info-gray.png" width="14" height="14" alt="" style="display:block;border:0" /></td>
                <td style="padding:17px 17px 17px 9px;font-size:10px;line-height:1.6;color:#687087">Os demais contratos, termos e documentos internos da admissão — contrato de experiência, LGPD, banco de horas, vale-transporte, consentimento de imagem e voz, entre outros — <strong style="color:#3e4353">serão tratados diretamente pela empresa.</strong> Não é necessário elaborar nem encaminhar esses documentos.</td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding:22px 32px 28px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff1f7;border:1px solid #f7c8dc;border-radius:17px">
              <tr><td style="padding:19px 20px">
                <div style="font-size:13px;line-height:1.5;font-weight:900;color:#202137">Após concluir o registro, envie <span style="color:#e72d87">somente a Ficha de Registro de Empregado</span> pelo link abaixo.</div>
                <a href="${escapeHtml(input.registryUploadUrl)}" style="display:inline-block;margin-top:14px;padding:13px 18px;border-radius:12px;background:#e92b86;color:#fff;text-decoration:none;font-size:12px;font-weight:900"><img src="https://op.coalashakes.com/email/icons/upload-white.png" width="14" height="14" alt="" style="display:inline-block;vertical-align:-3px;border:0" />&nbsp; Enviar Ficha de registro</a>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:18px 32px 23px;border-top:1px solid #eee9ee;font-size:10px;line-height:1.6;color:#9a91a0">
            Este é um e-mail automático e não aceita respostas.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
