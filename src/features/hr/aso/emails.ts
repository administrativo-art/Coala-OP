import { renderEmailIconBox } from "@/lib/email/email-icon";

export const ASO_CLINIC_EMAIL_CIDS = {
  logo: "coala-email-logo",
  request: "aso-request-icon",
  attachment: "aso-attachment-icon",
  exam: "aso-exam-icon",
  company: "aso-company-icon",
  candidate: "aso-candidate-icon",
  calendar: "aso-calendar-icon",
} as const;

export const MEDCLINIC_CANDIDATE_LOCATION = {
  name: 'MedClinic',
  address: 'Av. Getúlio Vargas, 43 · Monte Castelo',
  city: 'São Luís/MA · CEP 65030-005',
  reference: 'Em frente ao SENAI',
  mapsUrl: 'https://maps.app.goo.gl/XMrzpX7e8x54HP939',
} as const;

export type AsoAttachmentDescription = { label: string; fileName: string };

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function candidateAsoProcessStartedEmailContent(input: {
  candidateName: string;
  clinicName: string;
  examType?: 'admission' | 'dismissal';
}) {
  const examLabel = input.examType === 'dismissal' ? 'demissional' : 'admissional';
  const message = [
    `Olá, ${input.candidateName}.`,
    '',
    `O RH iniciou a solicitação do seu exame ${examLabel} junto à ${input.clinicName}.`,
    'Assim que a clínica informar a data e o horário, você receberá um novo e-mail com o agendamento e as orientações para o exame.',
  ].join('\n');
  return {
    subject: `Seu exame ${examLabel} foi solicitado`,
    text: message,
  };
}

export function renderCandidateAsoProcessStartedEmail(input: {
  candidateName: string;
  clinicName: string;
  examType?: 'admission' | 'dismissal';
}) {
  const examLabel = input.examType === 'dismissal' ? 'demissional' : 'admissional';
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#eee8f3;font-family:Arial,sans-serif;color:#202137"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:24px;overflow:hidden"><tr><td style="padding:24px 30px;border-bottom:1px solid #eee9ee"><div style="font-size:11px;font-weight:900;letter-spacing:1.2px;color:#d92778">COALA SHAKES · ASO</div></td></tr><tr><td style="padding:30px"><h1 style="margin:0;font-size:22px;line-height:1.3">Olá, ${escapeHtml(input.candidateName)}.</h1><p style="margin:15px 0 0;font-size:14px;line-height:1.65;color:#596079">O RH iniciou a solicitação do seu exame <strong style="color:#202137">${escapeHtml(examLabel)}</strong> junto à <strong style="color:#202137">${escapeHtml(input.clinicName)}</strong>.</p><div style="margin-top:20px;padding:17px 18px;border-radius:16px;background:#e9f8fc;border:1px solid #b8e5ef;font-size:13px;line-height:1.6;color:#24566a"><strong>Próximo passo</strong><br />Assim que a clínica informar a data e o horário, você receberá um novo e-mail com o agendamento, o local e as orientações para o exame.</div></td></tr><tr><td style="padding:17px 30px 22px;border-top:1px solid #eee9ee;font-size:10px;line-height:1.6;color:#918999">Mensagem automática do processo de formalização.</td></tr></table></td></tr></table></body></html>`;
}

export function clinicAsoEmailContent(input: {
  candidateName: string;
  candidateCpf?: string | null;
  jobFunction: string;
  companyName: string;
  companyCnpj: string;
  companyAddress: string;
  companyContacts: string;
  attachments: AsoAttachmentDescription[];
  examType?: 'admission' | 'dismissal';
}) {
  const examLabel = input.examType === 'dismissal' ? 'DEMISSIONAL' : 'ADMISSIONAL';
  const attachmentLines = input.attachments.map((attachment, index) => `• ${attachment.label} - anexo ${index + 1}`).join('\n');
  const message = [
    'Prezados, boa tarde.',
    '',
    'Gostaria de agendar um exame para uma colaboradora. Os dados da solicitação seguem abaixo.',
    '',
    'Exame:',
    '',
    `• Atestado de saúde ocupacional - ASO ${examLabel}`,
    '',
    'Empresa:',
    '',
    `• ${input.companyName} | ${input.companyCnpj} | ${input.companyAddress} | ${input.companyContacts}.`,
    '',
    'Colaboradores:',
    '',
    `• ${input.candidateName}, ${input.jobFunction}${input.candidateCpf ? `, CPF ${input.candidateCpf}` : ''};`,
    ...(attachmentLines ? ['', 'Anexos:', '', attachmentLines] : []),
  ].join('\n');
  return {
    subject: `ASO ${input.examType === 'dismissal' ? 'demissional' : 'admissional'} - Solicitação - ${input.candidateName}`,
    title: undefined,
    message,
    emphasis: 'Por gentileza, responda este e-mail com o agendamento ou informe a data e o horário pelo link abaixo.',
    text: `${message}\n\nPor gentileza, responda este e-mail com o agendamento ou informe a data e o horário pelo link fornecido.`,
  };
}

export function renderClinicAsoRequestEmail(input: {
  candidateName: string;
  candidateCpf?: string | null;
  jobFunction: string;
  companyName: string;
  companyCnpj: string;
  companyAddress: string;
  companyContacts: string;
  attachments: AsoAttachmentDescription[];
  replyUrl: string;
  examType?: 'admission' | 'dismissal';
}) {
  const examLabel = input.examType === 'dismissal' ? 'ASO demissional' : 'ASO admissional';
  const attachmentRows = input.attachments
    .map(
      (attachment, index) => `
        <tr><td style="padding-top:${index === 0 ? '0' : '8px'}">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #eee8ee;border-radius:12px;background:#fff">
            <tr>
              <td width="38" align="center" valign="middle" style="padding:11px 0 11px 10px">${renderEmailIconBox({ src: `cid:${ASO_CLINIC_EMAIL_CIDS.attachment}`, iconSize: 14, boxSize: 28, background: "#fff0f6", radius: 8 })}</td>
              <td style="padding:10px 8px;font-size:12px;line-height:1.35;color:#202137"><strong>${escapeHtml(attachment.label)}</strong><br /><span style="font-size:10px;color:#9a91a0">anexo ${index + 1}</span></td>
              <td width="30" align="center" style="padding-right:8px;color:#a7adbd;font-size:15px">↓</td>
            </tr>
          </table>
        </td></tr>`
    )
    .join('');

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
                  <td valign="middle"><img src="cid:${ASO_CLINIC_EMAIL_CIDS.logo}" width="88" alt="Coala Shakes" style="display:block;width:88px;height:auto;border:0" /></td>
                  <td align="right" valign="middle"><span style="display:inline-block;padding:7px 12px;border-radius:999px;background:#e9f8fc;color:#1594ae;font-size:10px;font-weight:800"><img src="cid:${ASO_CLINIC_EMAIL_CIDS.request}" width="12" height="12" alt="" style="display:inline-block;vertical-align:-2px;border:0" />&nbsp; Solicitação de exame</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="padding:29px 32px 0">
            <h1 style="margin:0;font-size:20px;line-height:1.3;color:#202137">Prezados, boa tarde.</h1>
            <p style="margin:12px 0 0;font-size:12px;line-height:1.65;color:#596079">Gostaria de agendar um exame para um(a) colaborador(a). Os dados da solicitação seguem abaixo.</p>
          </td></tr>
          <tr><td style="padding:22px 32px 0">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #b8e5ef;border-radius:17px;background:#e3f7fb">
              <tr>
                <td width="48" align="center" valign="middle" style="padding:17px 0 17px 16px">${renderEmailIconBox({ src: `cid:${ASO_CLINIC_EMAIL_CIDS.exam}`, iconSize: 20, boxSize: 36, background: "#28b3d0", radius: 11 })}</td>
                <td style="padding:16px 18px">
                  <div style="font-size:9px;font-weight:900;letter-spacing:1.2px;color:#1494ae">EXAME</div>
                  <div style="margin-top:4px;font-size:15px;line-height:1.35;font-weight:900;color:#202137">Atestado de Saúde Ocupacional<br />— ${escapeHtml(examLabel)}</div>
                </td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding:22px 32px 0">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td width="32" align="center" valign="top">${renderEmailIconBox({ src: `cid:${ASO_CLINIC_EMAIL_CIDS.company}`, iconSize: 14, boxSize: 28, background: "#fff0f6", radius: 9 })}</td>
                <td style="padding-left:8px">
                  <div style="font-size:9px;font-weight:900;letter-spacing:1.1px;color:#e72d87">EMPRESA</div>
                  <div style="margin-top:5px;font-size:12px;line-height:1.55;color:#3b4054"><strong style="color:#202137">${escapeHtml(input.companyName)}</strong><br />CNPJ ${escapeHtml(input.companyCnpj)} · ${escapeHtml(input.companyAddress)}<br /><span style="color:#9297a8">${escapeHtml(input.companyContacts)}</span></div>
                </td>
              </tr>
              <tr>
                <td width="32" align="center" valign="top" style="padding-top:17px">${renderEmailIconBox({ src: `cid:${ASO_CLINIC_EMAIL_CIDS.candidate}`, iconSize: 14, boxSize: 28, background: "#fff0f6", radius: 9 })}</td>
                <td style="padding:17px 0 0 8px">
                  <div style="font-size:9px;font-weight:900;letter-spacing:1.1px;color:#e72d87">COLABORADOR(A)</div>
                  <div style="margin-top:5px;font-size:12px;line-height:1.5;color:#3b4054"><strong style="color:#202137">${escapeHtml(input.candidateName)}</strong> · ${escapeHtml(input.jobFunction)}${input.candidateCpf ? `<br />CPF ${escapeHtml(input.candidateCpf)}` : ''}</div>
                </td>
              </tr>
            </table>
          </td></tr>
          ${input.attachments.length ? `<tr><td style="padding:22px 32px 0">
            <div style="margin-bottom:10px;font-size:9px;font-weight:900;letter-spacing:1.1px;color:#83899d">ANEXOS · ${input.attachments.length} ARQUIVOS</div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${attachmentRows}</table>
          </td></tr>` : ''}
          <tr><td style="padding:24px 32px 28px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff1f7;border:1px solid #f7c8dc;border-radius:17px">
              <tr><td style="padding:19px 20px">
                <div style="font-size:13px;line-height:1.5;font-weight:900;color:#202137">Por gentileza, responda este e-mail com o agendamento — ou informe a data e o horário pelo link abaixo.</div>
                <a href="${escapeHtml(input.replyUrl)}" style="display:inline-block;margin-top:14px;padding:13px 18px;border-radius:12px;background:#e92b86;color:#fff;text-decoration:none;font-size:12px;font-weight:900"><img src="cid:${ASO_CLINIC_EMAIL_CIDS.calendar}" width="14" height="14" alt="" style="display:inline-block;vertical-align:-3px;border:0" />&nbsp; Informar data e horário</a>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:18px 32px 23px;border-top:1px solid #eee9ee;font-size:10px;line-height:1.6;color:#9a91a0">
            E-mail automático enviado pelo RH Coala Shakes.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function candidateAsoEmailContent(input: {
  candidateName: string;
  appointmentLabel: string;
  instructions?: string | null;
  uploadUrl: string;
  examType?: 'admission' | 'dismissal';
}) {
  const location = MEDCLINIC_CANDIDATE_LOCATION;
  const message = [
    `Olá, ${input.candidateName}.`,
    '',
    `Seu exame ${input.examType === 'dismissal' ? 'demissional' : 'admissional'} foi agendado para ${input.appointmentLabel}.`,
    '',
  ].join('\n');
  const locationBlock = [
    `Clínica: ${location.name}`,
    `Endereço: ${location.address}`,
    location.city,
    `Referência: ${location.reference}`,
  ].join('\n');
  const afterActionMessage = [
    ...(input.instructions ? [`Orientações adicionais: ${input.instructions}`, ''] : []),
    'Apresente-se com antecedência e leve um documento oficial com foto, como CIN ou RG, CNH ou passaporte.',
  ].join('\n');
  return {
    subject: `ASO ${input.examType === 'dismissal' ? 'demissional' : 'admissional'} - Agendamento`,
    title: undefined,
    message,
    locationBlock,
    afterActionMessage,
    text: `${message}\n\n${locationBlock}\nLocalização: ${location.mapsUrl}\n\n${afterActionMessage}\n\nApós o exame, envie o ASO digitalizado por esse link: ${input.uploadUrl}`,
    mapsUrl: location.mapsUrl,
  };
}

export function renderCandidateAsoAppointmentEmail(input: {
  candidateName: string;
  appointmentDate: string;
  appointmentTime: string;
  uploadUrl: string;
  instructions?: string | null;
  examType?: 'admission' | 'dismissal';
}) {
  const location = MEDCLINIC_CANDIDATE_LOCATION;
  const examLabel = input.examType === 'dismissal' ? 'Exame demissional' : 'Exame admissional';
  const examDescription = input.examType === 'dismissal'
    ? 'Tudo pronto para o seu exame demissional. Guarde este bilhete — é só apresentar na recepção.'
    : 'Tudo pronto para o seu exame admissional. Guarde este bilhete — é só apresentar na recepção.';
  const appointment = new Date(`${input.appointmentDate}T12:00:00-03:00`);
  const weekday = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    timeZone: 'America/Belem',
  }).format(appointment).replace('-feira', '-feira').toUpperCase();
  const monthYear = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Belem',
  }).format(appointment).toUpperCase();
  const day = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    timeZone: 'America/Belem',
  }).format(appointment);
  const name = escapeHtml(input.candidateName || 'candidato(a)');
  const extraInstructions = input.instructions
    ? `<tr><td width="30" align="center" valign="top" style="padding-top:13px">${renderEmailIconBox({ src: "https://op.coalashakes.com/email/icons/info-gray.png", iconSize: 13, boxSize: 26, background: "#fff1f7", radius: 8 })}</td><td valign="top" style="padding:13px 0 0 8px;font-size:13px;line-height:1.55;color:#22233b;word-break:normal;overflow-wrap:break-word"><strong>Orientação da clínica:</strong> ${escapeHtml(input.instructions)}</td></tr>`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#eee8f3;font-family:Arial,sans-serif;color:#202137">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eee8f3;padding:28px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fffdfc;border-radius:26px;overflow:hidden;box-shadow:0 12px 30px rgba(44,34,62,.08)">
          <tr>
            <td style="padding:25px 32px 19px;border-bottom:1px solid #eee9ee">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td valign="middle"><img src="https://op.coalashakes.com/coala-email-logo.jpg" width="88" alt="Coala Shakes" style="display:block;width:88px;height:auto;border:0" /></td>
                  <td align="right" valign="middle"><span style="display:inline-block;padding:7px 12px;border-radius:999px;background:#fff0f6;color:#db2777;font-size:11px;font-weight:800"><img src="https://op.coalashakes.com/email/icons/calendar-days-white.png" width="12" height="12" alt="" style="display:inline-block;vertical-align:-2px;border:0;background:#db2777;border-radius:3px" />&nbsp; ${escapeHtml(examLabel)}</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="padding:28px 32px 20px">
            <h1 style="margin:0;font-size:21px;line-height:1.3;color:#202137">Olá, ${name} 👋</h1>
            <p style="margin:12px 0 0;font-size:13px;line-height:1.55;color:#596079">${escapeHtml(examDescription)}</p>
          </td></tr>
          <tr><td style="padding:0 32px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;border-radius:19px;overflow:hidden;box-shadow:0 8px 22px rgba(219,39,119,.10)">
              <tr>
                <td width="36%" valign="top" style="padding:23px 20px;background:linear-gradient(155deg,#ef4b9b,#cf1f70);color:#ffffff">
                  <div style="font-size:9px;font-weight:900;letter-spacing:1.4px">${escapeHtml(weekday)}</div>
                  <div style="margin-top:5px;font-size:43px;line-height:1;font-weight:900">${escapeHtml(day)}</div>
                  <div style="margin-top:8px;font-size:11px;font-weight:900">${escapeHtml(monthYear)}</div>
                  <div style="height:1px;margin:15px 0;background:rgba(255,255,255,.35)"></div>
                  <table role="presentation" cellspacing="0" cellpadding="0">
                    <tr>
                      <td width="18" align="center" valign="middle" style="padding:0;line-height:0"><img src="https://op.coalashakes.com/email/icons/clock-3-white.png" width="16" height="16" alt="" style="display:block;width:16px;height:16px;margin:0 auto;border:0" /></td>
                      <td valign="middle" style="padding:0 0 0 7px;font-size:18px;line-height:18px;font-weight:900;color:#ffffff">${escapeHtml(input.appointmentTime)}</td>
                    </tr>
                  </table>
                </td>
                <td valign="top" style="padding:23px 22px;background:#ffffff;border:1px solid #f2edf1;border-left:0">
                  <div style="font-size:9px;font-weight:900;letter-spacing:1.3px;color:#20aeca">LOCAL DO EXAME</div>
                  <div style="margin-top:8px;font-size:16px;font-weight:900;color:#202137">${escapeHtml(location.name)}</div>
                  <div style="margin-top:14px;font-size:12px;line-height:1.65;color:#394057"><img src="https://op.coalashakes.com/email/icons/map-pin-pink.png" width="13" height="13" alt="" style="display:inline-block;vertical-align:-2px;border:0" />&nbsp; ${escapeHtml(location.address)}<br />&nbsp;&nbsp;&nbsp;&nbsp;${escapeHtml(location.city)}</div>
                  <div style="margin-top:3px;font-size:11px;color:#8a8fa2">&nbsp;&nbsp;&nbsp;&nbsp;Referência: ${escapeHtml(location.reference)}</div>
                </td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding:15px 32px 0">
            <a href="${escapeHtml(location.mapsUrl)}" style="display:block;padding:14px 18px;border-radius:13px;background:#202137;color:#ffffff;text-align:center;text-decoration:none;font-size:13px;font-weight:900"><img src="https://op.coalashakes.com/email/icons/map-pin-white.png" width="14" height="14" alt="" style="display:inline-block;vertical-align:-3px;border:0" />&nbsp;&nbsp; Abrir no Google Maps</a>
          </td></tr>
          <tr><td style="padding:27px 32px 0">
            <div style="font-size:9px;font-weight:900;letter-spacing:1.3px;color:#db2777">ANTES DE IR</div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:11px">
              <tr><td width="30" align="center" valign="top">${renderEmailIconBox({ src: "https://op.coalashakes.com/email/icons/file-text-pink.png", iconSize: 13, boxSize: 26, background: "#fff1f7", radius: 8 })}</td><td style="padding-left:8px;font-size:13px;line-height:1.5;color:#22233b"><strong>Documento oficial com foto</strong> — CIN ou RG, CNH ou passaporte.</td></tr>
              <tr><td width="30" align="center" valign="top" style="padding-top:13px">${renderEmailIconBox({ src: "https://op.coalashakes.com/email/icons/clock-3-teal.png", iconSize: 13, boxSize: 26, background: "#e9f9fd", radius: 8 })}</td><td style="padding:13px 0 0 8px;font-size:13px;line-height:1.5;color:#22233b"><strong>Chegue com antecedência</strong> para o cadastro na recepção.</td></tr>
              ${extraInstructions}
            </table>
          </td></tr>
          <tr><td style="padding:24px 32px 28px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff1f7;border:1px solid #f8c8dc;border-radius:17px">
              <tr>
                <td style="padding:20px">
                  <div style="font-size:13px;font-weight:900;color:#202137">Depois do exame</div>
                  <div style="margin-top:7px;font-size:12px;line-height:1.5;color:#8b5871">Envie o <strong style="color:#db2777">ASO digitalizado</strong> por este link.</div>
                </td>
                <td width="132" align="right" style="padding:20px 20px 20px 0">
                  <a href="${escapeHtml(input.uploadUrl)}" style="display:inline-block;padding:13px 18px;border-radius:12px;background:#e92b86;color:#ffffff;text-decoration:none;font-size:12px;font-weight:900"><img src="https://op.coalashakes.com/email/icons/upload-white.png" width="14" height="14" alt="" style="display:inline-block;vertical-align:-3px;border:0" />&nbsp; Enviar ASO</a>
                </td>
              </tr>
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
