import { execFileSync } from "node:child_process";

import { candidateAsoEmailContent } from "../src/features/hr/aso/emails";
import { renderCoalaEmail } from "../src/lib/email/template";

const recipient = "tiagobrasilll@gmail.com";
const apiKey = execFileSync(
  "/opt/homebrew/bin/gcloud",
  [
    "secrets",
    "versions",
    "access",
    "latest",
    "--secret=RESEND_API_KEY",
    "--project=smart-converter-752gf",
  ],
  { encoding: "utf8" }
).trim();

if (!apiKey) {
  throw new Error("A chave do Resend não foi encontrada.");
}

const content = candidateAsoEmailContent({
  candidateName: "Tiago Brasil",
  appointmentLabel: "segunda-feira, 27 de julho de 2026, às 09:30",
  instructions:
    "Esta é uma simulação visual do e-mail de agendamento. Não existe exame marcado.",
  uploadUrl: "https://op.coalashakes.com",
  examType: "admission",
});
const subject = `[SIMULAÇÃO] ${content.subject}`;
const html = renderCoalaEmail({
  brandName: "Coala Shakes",
  title: content.title,
  message: content.message,
  highlightBlock: {
    text: content.locationBlock,
    tone: "green",
    action: {
      label: "Abrir localização no Google Maps",
      url: content.mapsUrl,
    },
  },
  afterActionMessage: content.afterActionMessage,
  secondaryAction: {
    label: "Enviar ASO",
    url: "https://op.coalashakes.com",
  },
  secondaryActionLead:
    "Após o exame, envie o ASO digitalizado por esse link:",
  secondaryActionVariant: "highlight",
  footer:
    "SIMULAÇÃO VISUAL — nenhum exame foi agendado. Este é um e-mail automático e não aceita respostas.",
});

const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": "Coala-One/1.0",
  },
  body: JSON.stringify({
    from: "RH Coala Shakes <formalizacao@coalashakes.com>",
    to: [recipient],
    subject,
    html,
    text: `[SIMULAÇÃO VISUAL]\n\n${content.text}\n\nNenhum exame foi agendado.`,
    tags: [
      { name: "category", value: "aso_candidate_preview" },
      { name: "source", value: "manual_preview_20260724" },
    ],
  }),
  signal: AbortSignal.timeout(15_000),
});

const result = (await response.json().catch(() => ({}))) as {
  id?: string;
  message?: string;
};

if (!response.ok || !result.id) {
  throw new Error(
    `O Resend recusou o envio (${response.status}): ${
      result.message ?? "resposta inválida"
    }`
  );
}

console.log(
  JSON.stringify({
    ok: true,
    recipient,
    providerId: result.id,
    subject,
  })
);
