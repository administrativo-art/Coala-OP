import { execFileSync } from "node:child_process";

import { accountantAdmissionEmailContent } from "../src/features/hr/accountant/emails";
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

const clinicContent = clinicAsoEmailContent({
  candidateName: "CANDIDATA TESTE — NÃO REAL",
  jobFunction: "Atendente",
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
      fileName: "guia-aso-admissional.pdf",
    },
  ],
  examType: "admission",
});
const clinicReplyUrl = "https://op.coalashakes.com";
const clinic = await send({
  category: "aso_admission_clinic_preview",
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

const registryUploadUrl = "https://op.coalashakes.com";
const accountantContent = accountantAdmissionEmailContent({
  candidateName: "CANDIDATA TESTE — NÃO REAL",
  jobFunction: "Atendente",
  companyName: "Coala Shakes — Unidade de Teste",
  companyCnpj: "00.000.000/0000-00",
  admissionDate: "03/08/2026",
  attachmentLabels: [
    "Formulário de admissão para a contabilidade",
    "ASO admissional finalizado",
    "Documento oficial com foto",
    "Comprovante de residência",
    "Dados bancários",
  ],
  registryUploadUrl,
});
const accountant = await send({
  category: "admission_accountant_preview",
  subject: `[SIMULAÇÃO] ${accountantContent.subject}`,
  html: renderCoalaEmail({
    brandName: "Coala Shakes",
    message: accountantContent.message,
    highlightBlock: {
      text: accountantContent.detailsBlock,
      tone: "green",
    },
    afterActionMessage: accountantContent.afterDetailsMessage,
    secondaryAction: {
      label: accountantContent.registryUploadLabel,
      url: registryUploadUrl,
    },
    secondaryActionLead: accountantContent.registryUploadLead,
    secondaryActionVariant: "highlight",
    footer:
      "SIMULAÇÃO VISUAL — nenhuma admissão foi encaminhada à contabilidade e nenhum documento real foi anexado.",
  }),
  text: `[SIMULAÇÃO VISUAL]\n\n${accountantContent.text}`,
});

console.log(
  JSON.stringify({
    ok: true,
    recipient,
    messages: [clinic, accountant],
  })
);
