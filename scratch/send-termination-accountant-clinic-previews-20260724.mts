import { execFileSync } from "node:child_process";

import { clinicAsoEmailContent } from "../src/features/hr/aso/emails";
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

if (!apiKey) throw new Error("A chave do Resend não foi encontrada.");

async function send(input: {
  subject: string;
  html: string;
  text: string;
  category: string;
}) {
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
      subject: input.subject,
      html: input.html,
      text: input.text,
      tags: [
        { name: "category", value: input.category },
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
      `O Resend recusou ${input.category} (${response.status}): ${
        result.message ?? "resposta inválida"
      }`
    );
  }
  return { category: input.category, providerId: result.id };
}

const accountantSummary = [
  "Colaborador: COLABORADOR TESTE — NÃO REAL",
  "Protocolo: SIM-PD-20260722-001",
  "Término do contrato: 24/07/2026",
  "Prazo legal: 03/08/2026",
  "Aviso: indenizado",
].join("\n");
const accountantPortalUrl = "https://op.coalashakes.com";
const accountant = await send({
  category: "termination_accountant_preview",
  subject: "[SIMULAÇÃO] Desligamento CLT — COLABORADOR TESTE",
  html: renderCoalaEmail({
    brandName: "Coala Shakes",
    title: "Processamento de desligamento",
    message: accountantSummary,
    highlightBlock: {
      text: "Use o link seguro para consultar o resumo e anexar os documentos rescisórios.",
      tone: "green",
      action: { label: "Enviar documentos", url: accountantPortalUrl },
    },
    footer:
      "SIMULAÇÃO VISUAL — nenhum desligamento foi enviado à contabilidade. No envio real, a carta e a confirmação do pedido seguem anexadas. O link individual tem validade de 30 dias.",
  }),
  text: `[SIMULAÇÃO VISUAL]\n\n${accountantSummary}\n\nEnviar documentos: ${accountantPortalUrl}`,
});

const clinicContent = clinicAsoEmailContent({
  candidateName: "COLABORADOR TESTE — NÃO REAL",
  jobFunction: "Atendente de teste",
  companyName: "Coala Shakes — Unidade de Teste",
  companyCnpj: "00.000.000/0000-00",
  companyAddress: "São Luís/MA",
  companyContacts: "RH Coala Shakes",
  attachments: [
    { label: "Contrato social", fileName: "contrato-social.pdf" },
    {
      label: "Comprovante de pagamento",
      fileName: "comprovante-pagamento.pdf",
    },
    {
      label: "Guia de solicitação do ASO",
      fileName: "guia-aso-demissional.pdf",
    },
  ],
  examType: "dismissal",
});
const clinicReplyUrl = "https://op.coalashakes.com";
const clinic = await send({
  category: "aso_clinic_request_preview",
  subject: `[SIMULAÇÃO] ${clinicContent.subject}`,
  html: renderCoalaEmail({
    brandName: "Coala Shakes",
    title: clinicContent.title,
    message: clinicContent.message,
    highlightBlock: {
      text: clinicContent.emphasis,
      tone: "green",
      action: {
        label: "Informar data e horário",
        url: clinicReplyUrl,
      },
    },
    footer:
      "SIMULAÇÃO VISUAL — nenhum exame foi solicitado e nenhum documento real foi anexado.",
  }),
  text: `[SIMULAÇÃO VISUAL]\n\n${clinicContent.text}\n${clinicReplyUrl}`,
});

console.log(
  JSON.stringify({
    ok: true,
    recipient,
    messages: [accountant, clinic],
  })
);
