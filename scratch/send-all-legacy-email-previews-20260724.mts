import { execFileSync } from "node:child_process";

import { renderCoalaEmail } from "../src/lib/email/template";

const recipient = "tiagobrasilll@gmail.com";
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
      subject: `[MODELO ANTIGO · SIMULAÇÃO] ${input.subject}`,
      html: input.html,
      text: `[MODELO ANTIGO · SIMULAÇÃO]\n\n${input.text}`,
      tags: [
        { name: "category", value: input.category },
        { name: "source", value: "legacy_preview_20260724" },
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

const simulationFooter =
  "MODELO ANTIGO · SIMULAÇÃO VISUAL — nenhuma operação foi realizada e nenhum link individual foi gerado.";

const terminationSummary = [
  "Colaborador: COLABORADOR TESTE — NÃO REAL",
  "Protocolo: SIM-PD-20260722-001",
  "Término do contrato: 24/07/2026",
  "Prazo legal: 03/08/2026",
  "Aviso: indenizado",
].join("\n");

const messages = [
  {
    category: "legacy_termination_accountant",
    subject: "Desligamento CLT — COLABORADOR TESTE",
    html: renderCoalaEmail({
      brandName: "Coala Shakes",
      title: "Processamento de desligamento",
      message: terminationSummary,
      highlightBlock: {
        text: "Use o link seguro para consultar o resumo e anexar os documentos rescisórios.",
        tone: "green",
        action: { label: "Enviar documentos", url: previewUrl },
      },
      footer: `${simulationFooter} No envio real, o link é individual e válido por 30 dias.`,
    }),
    text: `${terminationSummary}\n\nEnviar documentos: ${previewUrl}`,
  },
  {
    category: "legacy_formalization_started",
    subject: "Bem-vindo(a) à Coala Shakes — complete sua formalização",
    html: renderCoalaEmail({
      brandName: "Coala Shakes",
      title: "Bem-vindo(a) à Coala Shakes!",
      message:
        "Olá, Tiago Brasil!\n\nEstamos iniciando sua formalização para o cargo de Atendente, na função Atendente de quiosque. Para continuar, preencha o formulário e envie as informações e documentos solicitados.\n\nEste link é individual e ficará disponível até 26/07/2026 às 10:50. Não compartilhe este e-mail.",
      action: { label: "Iniciar minha formalização", url: previewUrl },
      footer: simulationFooter,
    }),
    text:
      `Bem-vindo(a) à Coala Shakes!\n\nOlá, Tiago Brasil! Complete sua formalização pelo link: ${previewUrl}`,
  },
  {
    category: "legacy_integration_first_access",
    subject: "Seu acesso ao Coala One está pronto — cadastre sua senha",
    html: renderCoalaEmail({
      brandName: "Coala One",
      title: "Seu acesso ao Coala One está pronto",
      message:
        "Olá, Tiago Brasil!\n\nSua formalização foi concluída com sucesso e seu cadastro no Coala One já está disponível. Para acessar o sistema pela primeira vez, cadastre uma senha pessoal.\n\nO link é individual e temporário. Se ele estiver vencido, solicite um novo acesso ao RH. Seja bem-vindo(a) ao time Coala Shakes!",
      action: { label: "Cadastrar minha senha", url: previewUrl },
      secondaryAction: { label: "Acessar o Coala One", url: previewUrl },
      footer: simulationFooter,
    }),
    text:
      `Seu acesso ao Coala One está pronto.\n\nCadastrar minha senha: ${previewUrl}`,
  },
  {
    category: "legacy_manual_first_access",
    subject: "Defina sua senha de acesso ao Coala One",
    html: renderCoalaEmail({
      brandName: "Coala One",
      title: "Seu acesso ao Coala One foi criado",
      message:
        "Olá, Tiago Brasil. Seu cadastro inicial foi criado. Use o botão abaixo para definir sua senha de acesso. O link é individual e expira em 7 dias.",
      action: { label: "Definir minha senha", url: previewUrl },
      secondaryAction: { label: "Acessar o Coala One", url: previewUrl },
      footer: simulationFooter,
    }),
    text:
      `Seu acesso ao Coala One foi criado.\n\nDefinir minha senha: ${previewUrl}`,
  },
  {
    category: "legacy_password_reset",
    subject: "Redefina sua senha do Coala One",
    html: renderCoalaEmail({
      brandName: "Coala One",
      title: "Vamos criar uma nova senha?",
      message:
        "Recebemos uma solicitação para redefinir sua senha do Coala One. Use o botão abaixo para continuar. Se você não fez essa solicitação, ignore esta mensagem.",
      action: { label: "Trocar minha senha", url: previewUrl },
      secondaryAction: { label: "Acessar o Coala One", url: previewUrl },
      footer: simulationFooter,
    }),
    text: `Redefina sua senha do Coala One.\n\nTrocar minha senha: ${previewUrl}`,
  },
];

const results = [];
for (const message of messages) results.push(await send(message));

console.log(
  JSON.stringify({
    ok: true,
    recipient,
    count: results.length,
    messages: results,
  })
);
