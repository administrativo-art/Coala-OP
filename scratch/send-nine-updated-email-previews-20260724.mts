import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { renderAccountantAdmissionEmail } from "../src/features/hr/accountant/emails";
import {
  renderCandidateAsoAppointmentEmail,
  renderClinicAsoRequestEmail,
} from "../src/features/hr/aso/emails";
import { renderTerminationAccountantEmail } from "../src/features/hr/termination/emails";
import {
  renderFirstAccessEmail,
  renderFormalizationStartedEmail,
  renderPasswordResetEmail,
} from "../src/lib/email/first-access-template";

const recipient =
  process.env.PREVIEW_RECIPIENT?.trim() || "tiagobrasilll@gmail.com";
const previewUrl = "https://op.coalashakes.com";
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

const iconDirectory = path.resolve("public/email/icons");
const publicIconBase = "https://op.coalashakes.com/email/icons/";
const iconTagPattern =
  /<img\b(?=[^>]*\bsrc="https:\/\/op\.coalashakes\.com\/email\/icons\/([^"]+\.png)")(?=[^>]*\bwidth="(\d+)")(?=[^>]*\bheight="(\d+)")[^>]*>/g;

async function embedReferencedIcons(html: string) {
  const references = [
    ...html.matchAll(
      /<img\b(?=[^>]*\bsrc="https:\/\/op\.coalashakes\.com\/email\/icons\/([^"]+\.png)")(?=[^>]*\bwidth="(\d+)")(?=[^>]*\bheight="(\d+)")[^>]*>/g
    ),
  ].map((match) => ({
    filename: match[1],
    width: Number(match[2]),
    height: Number(match[3]),
  }));

  const uniqueReferences = [
    ...new Map(
      references.map((reference) => [
        `${reference.filename}:${reference.width}x${reference.height}`,
        reference,
      ])
    ).values(),
  ];

  const attachments = await Promise.all(
    uniqueReferences.map(async ({ filename, width, height }) => {
      const contentId = `coala-${filename.replace(
        /[^a-zA-Z0-9]/g,
        "-"
      )}-${width}x${height}`;
      const source = await readFile(path.join(iconDirectory, filename));
      const content = await sharp(source)
        .resize(width, height, { fit: "contain" })
        .png()
        .toBuffer();
      return {
        filename: `${filename.replace(/\.png$/, "")}-${width}x${height}.png`,
        content: content.toString("base64"),
        content_id: contentId,
      };
    })
  );

  const embeddedHtml = html.replace(
    iconTagPattern,
    (tag, filename: string, width: string, height: string) => {
      const contentId = `coala-${filename.replace(
        /[^a-zA-Z0-9]/g,
        "-"
      )}-${width}x${height}`;
      return tag.replace(
        `${publicIconBase}${filename}`,
        `cid:${contentId}`
      );
    }
  );

  return { html: embeddedHtml, attachments };
}

async function send(input: {
  number: number;
  subject: string;
  html: string;
  text: string;
  category: string;
}) {
  const embedded = await embedReferencedIcons(input.html);
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
      subject: `[${input.number}/9 · NOVO DESIGN · SIMULAÇÃO] ${input.subject}`,
      html: embedded.html,
      text: `[${input.number}/9 · NOVO DESIGN · SIMULAÇÃO]\n\n${input.text}`,
      attachments: embedded.attachments,
      tags: [
        { name: "category", value: input.category },
        { name: "source", value: "updated_preview_20260724" },
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
  return { number: input.number, category: input.category, providerId: result.id };
}

const clinicBase = {
  candidateName: "COLABORADOR TESTE — NÃO REAL",
  jobFunction: "Atendente",
  companyName: "Coala Shakes — Unidade de Teste",
  companyCnpj: "00.000.000/0000-00",
  companyAddress: "São Luís/MA",
  companyContacts: "RH Coala Shakes",
  attachments: [
    { label: "Contrato social", fileName: "contrato-social.pdf" },
    { label: "Comprovante de pagamento", fileName: "comprovante-pagamento.pdf" },
    { label: "Guia de solicitação do ASO", fileName: "guia-aso.pdf" },
  ],
  replyUrl: previewUrl,
} as const;

const previews = [
  {
    number: 1,
    category: "updated_aso_admission_clinic",
    subject: "ASO admissional — solicitação para a clínica",
    html: renderClinicAsoRequestEmail({ ...clinicBase, examType: "admission" }),
    text: "Simulação do novo e-mail de solicitação de ASO admissional para a clínica.",
  },
  {
    number: 2,
    category: "updated_aso_dismissal_clinic",
    subject: "ASO demissional — solicitação para a clínica",
    html: renderClinicAsoRequestEmail({ ...clinicBase, examType: "dismissal" }),
    text: "Simulação do novo e-mail de solicitação de ASO demissional para a clínica.",
  },
  {
    number: 3,
    category: "updated_aso_admission_candidate",
    subject: "Agendamento do ASO admissional — colaborador",
    html: renderCandidateAsoAppointmentEmail({
      candidateName: "Tiago Brasil",
      appointmentDate: "2026-07-27",
      appointmentTime: "09:30",
      uploadUrl: previewUrl,
      instructions: "Simulação visual. Nenhum exame foi agendado.",
      examType: "admission",
    }),
    text: "Simulação do novo aviso de agendamento do ASO admissional.",
  },
  {
    number: 4,
    category: "updated_aso_dismissal_candidate",
    subject: "Agendamento do ASO demissional — colaborador",
    html: renderCandidateAsoAppointmentEmail({
      candidateName: "Tiago Brasil",
      appointmentDate: "2026-07-27",
      appointmentTime: "09:30",
      uploadUrl: previewUrl,
      instructions: "Simulação visual. Nenhum exame foi agendado.",
      examType: "dismissal",
    }),
    text: "Simulação do novo aviso de agendamento do ASO demissional.",
  },
  {
    number: 5,
    category: "updated_admission_accountant",
    subject: "Formalização admissional — contador",
    html: renderAccountantAdmissionEmail({
      candidateName: "CANDIDATA TESTE — NÃO REAL",
      jobFunction: "Atendente",
      companyName: "Coala Shakes — Unidade de Teste",
      companyCnpj: "00.000.000/0000-00",
      admissionDate: "03/08/2026",
      attachmentLabels: [
        "Formulário de admissão",
        "ASO admissional finalizado",
        "Documento oficial com foto",
        "Comprovante de residência",
        "Dados bancários",
      ],
      registryUploadUrl: previewUrl,
    }),
    text: "Simulação do novo e-mail de formalização enviado ao contador.",
  },
  {
    number: 6,
    category: "updated_termination_accountant",
    subject: "Desligamento CLT — contador",
    html: renderTerminationAccountantEmail({
      employeeName: "COLABORADOR TESTE — NÃO REAL",
      protocol: "SIM-PD-20260722-001",
      contractEndDate: "2026-07-24",
      legalPaymentDueDate: "2026-08-03",
      noticeLabel: "Indenizado",
      documentsUrl: previewUrl,
    }),
    text: "Simulação do novo e-mail de desligamento enviado ao contador.",
  },
  {
    number: 7,
    category: "updated_first_access",
    subject: "Primeiro acesso ao Coala One",
    html: renderFirstAccessEmail({
      userName: "Tiago Brasil",
      actionUrl: previewUrl,
      integrationCompleted: true,
    }),
    text: "Simulação do novo e-mail de primeiro acesso ao Coala One.",
  },
  {
    number: 8,
    category: "updated_password_reset",
    subject: "Redefinição de senha do Coala One",
    html: renderPasswordResetEmail({ actionUrl: previewUrl }),
    text: "Simulação do novo e-mail de redefinição de senha.",
  },
  {
    number: 9,
    category: "updated_formalization_started",
    subject: "Convite para iniciar a formalização",
    html: renderFormalizationStartedEmail({
      candidateName: "Tiago Brasil",
      jobRole: "Atendente",
      jobFunction: "Atendente de quiosque",
      deadlineLabel: "26/07/2026 às 10:50",
      actionUrl: previewUrl,
    }),
    text: "Simulação do novo convite para iniciar a formalização.",
  },
];

const results = [];
for (const preview of previews) results.push(await send(preview));

console.log(
  JSON.stringify({
    ok: true,
    recipient,
    count: results.length,
    messages: results,
  })
);
