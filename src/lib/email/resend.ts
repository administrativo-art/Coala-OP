import "server-only";

const RESEND_API_URL = "https://api.resend.com/emails";
export const EMAIL_SENDERS = {
  formalization:
    process.env.RESEND_FORMALIZATION_FROM?.trim() ||
    "RH Coala Shakes <formalizacao@coalashakes.com>",
  access:
    process.env.RESEND_ACCESS_FROM?.trim() ||
    "Zé da Senha | Coala One <acesso@coalashakes.com>",
} as const;

export type SendEmailInput = {
  from?: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export type SendEmailResult = {
  id: string;
};

type ResendErrorPayload = {
  message?: string;
  name?: string;
};

function normalizeRecipients(to: string | string[]) {
  const recipients = (Array.isArray(to) ? to : [to])
    .map((email) => email.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    throw new Error("Informe ao menos um destinatário para o e-mail.");
  }

  return recipients;
}

function requireEmailConfiguration() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY não está configurada no servidor.");
  }

  return {
    apiKey,
  };
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const recipients = normalizeRecipients(input.to);
  const subject = input.subject.trim();
  if (!subject) throw new Error("O assunto do e-mail é obrigatório.");
  if (!input.html.trim()) throw new Error("O conteúdo HTML do e-mail é obrigatório.");

  const { apiKey } = requireEmailConfiguration();
  const from = input.from?.trim() || EMAIL_SENDERS.formalization;
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "Coala-One/1.0",
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const payload = (await response.json().catch(() => ({}))) as
    | SendEmailResult
    | ResendErrorPayload;

  if (!response.ok) {
    const detail = "message" in payload && payload.message ? `: ${payload.message}` : "";
    throw new Error(`O Resend recusou o envio (${response.status})${detail}`);
  }

  if (!("id" in payload) || typeof payload.id !== "string") {
    throw new Error("O Resend não retornou o identificador do e-mail.");
  }

  return { id: payload.id };
}
