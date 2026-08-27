import { renderEmailIconBox } from "./email-icon";

type FirstAccessEmailInput = {
  userName: string;
  actionUrl: string;
  expiryLabel?: string;
  integrationCompleted?: boolean;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderFirstAccessEmail(input: FirstAccessEmailInput) {
  const introduction = input.integrationCompleted
    ? "Sua formalização foi concluída e seu cadastro já está pronto. Defina sua senha de acesso pelo botão abaixo."
    : "Seu cadastro inicial já está pronto. Defina sua senha de acesso pelo botão abaixo.";

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
                  <td align="right" valign="middle"><span style="display:inline-flex;align-items:center;gap:5px;padding:7px 12px;border-radius:999px;background:#fff0f6;color:#d92778;font-size:10px;font-weight:800"><img src="https://op.coalashakes.com/email/icons/shield-check-pink.png" width="12" height="12" alt="" style="display:inline-block;border:0" /> Coala One</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td align="center" style="padding:29px 34px 27px">
            ${renderEmailIconBox({ src: "https://op.coalashakes.com/email/icons/lock-keyhole-white.png", iconSize: 27, boxSize: 58, background: "#df2c82", radius: 17 })}
            <h1 style="margin:18px 0 0;font-size:22px;line-height:1.2;color:#202137">Seu acesso ao Coala One<br />foi criado 🎉</h1>
            <p style="margin:14px auto 0;max-width:360px;font-size:12px;line-height:1.65;color:#596079">Olá, <strong style="color:#202137">${escapeHtml(input.userName)}</strong>. ${escapeHtml(introduction)}</p>
            <div style="margin-top:20px"><span style="display:inline-block;padding:7px 12px;border:1px solid #f6c9dc;border-radius:999px;background:#fff8fb;color:#d92778;font-size:10px;font-weight:900"><img src="https://op.coalashakes.com/email/icons/clock-3-pink.png" width="12" height="12" alt="" style="display:inline-block;vertical-align:-2px;border:0" />&nbsp; ${escapeHtml(input.expiryLabel ?? "Link individual · expira em 7 dias")}</span></div>
            <a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;margin-top:21px;padding:14px 24px;border-radius:12px;background:#e52c85;color:#fff;text-decoration:none;font-size:13px;font-weight:900;box-shadow:0 8px 16px rgba(229,44,133,.18)"><img src="https://op.coalashakes.com/email/icons/lock-keyhole-white.png" width="14" height="14" alt="" style="display:inline-block;vertical-align:-3px;border:0" />&nbsp; Definir minha senha</a>
            <p style="margin:17px 0 0;font-size:11px;line-height:1.6;color:#777d8e">Depois, acesse normalmente por aqui:<br /><a href="https://op.coalashakes.com" style="color:#e52c85;text-decoration:none;font-weight:900">Acessar o Coala One →</a></p>
          </td></tr>
          <tr><td style="padding:18px 32px 23px;border-top:1px solid #eee9ee;font-size:10px;line-height:1.6;color:#9a91a0">
            Link individual e temporário. Este é um e-mail automático e não aceita respostas.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function renderPasswordResetEmail(input: { actionUrl: string }) {
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
                  <td align="right" valign="middle"><span style="display:inline-block;padding:7px 12px;border-radius:999px;background:#fff0f6;color:#d92778;font-size:10px;font-weight:800"><img src="https://op.coalashakes.com/email/icons/key-round-pink.png" width="12" height="12" alt="" style="display:inline-block;vertical-align:-2px;border:0" />&nbsp; Segurança</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td align="center" style="padding:29px 34px 27px">
            ${renderEmailIconBox({ src: "https://op.coalashakes.com/email/icons/key-round-white.png", iconSize: 27, boxSize: 58, background: "#df2c82", radius: 17 })}
            <h1 style="margin:18px 0 0;font-size:22px;line-height:1.2;color:#202137">Vamos criar uma<br />nova senha?</h1>
            <p style="margin:14px auto 0;max-width:350px;font-size:12px;line-height:1.65;color:#596079">Recebemos uma solicitação para redefinir sua senha do <strong style="color:#202137">Coala One</strong>. Use o botão abaixo para continuar.</p>
            <a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;margin-top:21px;padding:14px 24px;border-radius:12px;background:#e52c85;color:#fff;text-decoration:none;font-size:13px;font-weight:900;box-shadow:0 8px 16px rgba(229,44,133,.18)"><img src="https://op.coalashakes.com/email/icons/key-round-white.png" width="14" height="14" alt="" style="display:inline-block;vertical-align:-3px;border:0" />&nbsp; Trocar minha senha</a>
            <p style="margin:17px 0 0;font-size:11px;line-height:1.6;color:#777d8e">Depois, acesse normalmente por aqui:<br /><a href="https://op.coalashakes.com" style="color:#e52c85;text-decoration:none;font-weight:900">Acessar o Coala One →</a></p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:25px;border:1px solid #e5e6eb;border-radius:13px;background:#f7f7f9">
              <tr>
                <td width="24" valign="top" style="padding:15px 0 15px 15px"><img src="https://op.coalashakes.com/email/icons/info-gray.png" width="14" height="14" alt="" style="display:block;border:0" /></td>
                <td align="left" style="padding:15px 15px 15px 8px;font-size:10px;line-height:1.55;color:#687087">Se você <strong style="color:#303548">não fez</strong> esta solicitação, é só ignorar esta mensagem — nada será alterado.</td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding:18px 32px 23px;border-top:1px solid #eee9ee;font-size:10px;line-height:1.6;color:#9a91a0">
            Link individual e temporário. Este é um e-mail automático e não aceita respostas.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function renderFormalizationStartedEmail(input: {
  candidateName: string;
  jobRole: string;
  jobFunction: string;
  deadlineLabel: string;
  actionUrl: string;
}) {
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
                  <td align="right" valign="middle"><span style="display:inline-block;padding:7px 12px;border-radius:999px;background:#fff0f6;color:#d92778;font-size:10px;font-weight:800"><img src="https://op.coalashakes.com/email/icons/check-pink.png" width="12" height="12" alt="" style="display:inline-block;vertical-align:-2px;border:0" />&nbsp; Formalização</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="padding:0;background:linear-gradient(135deg,#eb3d91,#c91968);color:#fff">
            <div style="padding:28px 32px 27px;background:radial-gradient(circle at 96% 10%,rgba(255,255,255,.13) 0,74px,transparent 75px)">
              <div style="font-size:9px;font-weight:900;letter-spacing:1.4px;color:#ffe2ef">QUE BOM TER VOCÊ AQUI</div>
              <h1 style="margin:9px 0 0;font-size:27px;line-height:1.05;color:#fff">Bem-vindo(a) à<br />Coala Shakes! 🎉</h1>
              <p style="margin:17px 0 0;font-size:12px;line-height:1.55;color:#fff">Olá, <strong>${escapeHtml(input.candidateName)}</strong>! Vamos iniciar a sua formalização.</p>
            </div>
          </td></tr>
          <tr><td style="padding:21px 32px 0">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #f4cade;border-radius:15px;background:#fff8fb">
              <tr>
                <td width="46" align="center" valign="middle" style="padding:15px 0 15px 13px">${renderEmailIconBox({ src: "https://op.coalashakes.com/email/icons/briefcase-business-white.png", iconSize: 19, boxSize: 38, background: "#df2c82", radius: 11 })}</td>
                <td style="padding:15px 17px">
                  <div style="font-size:8px;font-weight:900;letter-spacing:1.1px;color:#d92778">SEU CARGO</div>
                  <div style="margin-top:3px;font-size:15px;font-weight:900;color:#202137">${escapeHtml(input.jobRole)}</div>
                  <div style="margin-top:3px;font-size:10px;color:#7d8395">Função: ${escapeHtml(input.jobFunction)}</div>
                </td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding:22px 32px 0">
            <p style="margin:0;font-size:12px;line-height:1.65;color:#596079">Para continuar, preencha o formulário e envie as informações e documentos solicitados. É rapidinho.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px;border:1px solid #e5e6eb;border-radius:13px;background:#f7f7f9">
              <tr>
                <td width="24" valign="top" style="padding:15px 0 15px 15px"><img src="https://op.coalashakes.com/email/icons/clock-3-pink.png" width="14" height="14" alt="" style="display:block;border:0" /></td>
                <td style="padding:15px 15px 15px 8px;font-size:10px;line-height:1.55;color:#687087">Link individual disponível até <strong style="color:#303548">${escapeHtml(input.deadlineLabel)}</strong>. Não compartilhe este e-mail.</td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding:22px 32px 28px">
            <a href="${escapeHtml(input.actionUrl)}" style="display:block;padding:14px 20px;border-radius:12px;background:#e52c85;color:#fff;text-align:center;text-decoration:none;font-size:13px;font-weight:900;box-shadow:0 8px 16px rgba(229,44,133,.18)">Iniciar minha formalização&nbsp;&nbsp; →</a>
          </td></tr>
          <tr><td style="padding:18px 32px 23px;border-top:1px solid #eee9ee;font-size:10px;line-height:1.6;color:#9a91a0">
            Link individual e temporário. Este é um e-mail automático e não aceita respostas.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
