"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  KeyRound,
  LockKeyhole,
  Mail,
  Server,
  ShieldCheck,
  TimerReset,
  Users,
} from "lucide-react";

import { PrivacyGovernancePanel } from "@/components/privacy/privacy-governance-panel";

const inventoryRows = [
  {
    module: "Login e usuarios",
    data: "Nome, e-mail, senha, perfil, quiosques, status, foto",
    subject: "Usuario interno",
    purpose: "Acesso ao sistema e controle de permissoes",
    legalBasis: "Execucao de contrato / legitimo interesse",
    access: "Administradores e gestores autorizados",
    retention: "Enquanto houver vinculo ou necessidade operacional",
  },
  {
    module: "DP/RH",
    data: "Cargo, admissao, documentos, dados cadastrais, beneficios",
    subject: "Colaborador",
    purpose: "Gestao do vinculo de trabalho e obrigacoes trabalhistas",
    legalBasis: "Contrato / obrigacao legal / exercicio regular de direitos",
    access: "RH/DP e administracao autorizada",
    retention: "Conforme prazo trabalhista e defesa juridica",
  },
  {
    module: "Escalas",
    data: "Turnos, folgas, unidades, horarios, restricoes de acesso",
    subject: "Colaborador",
    purpose: "Organizacao da jornada e operacao das lojas",
    legalBasis: "Contrato / legitimo interesse",
    access: "RH/DP, lideres e gestores da unidade",
    retention: "Enquanto necessario para operacao e registros internos",
  },
  {
    module: "Recrutamento",
    data: "Nome, e-mail, telefone, curriculo, respostas e historico",
    subject: "Candidato",
    purpose: "Processo seletivo e banco de talentos",
    legalBasis: "Medidas pre-contratuais / legitimo interesse / consentimento",
    access: "RH, recrutamento e gestores envolvidos",
    retention: "6 a 12 meses apos encerramento, salvo banco de talentos",
  },
  {
    module: "Financeiro",
    data: "Dados de pagamentos, centros de custo, despesas e comprovantes",
    subject: "Colaborador ou fornecedor pessoa fisica",
    purpose: "Controle financeiro, pagamentos e prestacao de contas",
    legalBasis: "Contrato / obrigacao legal",
    access: "Financeiro e administracao autorizada",
    retention: "Conforme obrigacao fiscal, contabil e juridica",
  },
  {
    module: "Auditoria e logs",
    data: "Usuario, data, acao, registro afetado, IP/dispositivo quando disponivel",
    subject: "Usuario interno",
    purpose: "Seguranca, rastreabilidade e investigacao de incidentes",
    legalBasis: "Legitimo interesse / cumprimento de obrigacao legal",
    access: "Administradores e responsaveis por seguranca",
    retention: "365 dias, salvo investigacao ou obrigacao especifica",
  },
];

const supplierRows = [
  ["Google Firebase", "Autenticacao, banco de dados, storage e hosting"],
  ["Bizneo", "Dados cadastrais e informacoes de RH"],
  ["PDV Legal", "Operacao, vendas e dados relacionados ao PDV"],
  ["MarqPonto / ponto", "Registros de jornada, se integrado"],
  ["Contabilidade / folha", "Obrigacoes trabalhistas, fiscais e contabeis"],
];

const checklist = [
  { label: "Consentimento LGPD em candidaturas publicas", done: true },
  { label: "Controle de acesso por perfis", done: true },
  { label: "Reset de senha via e-mail do Firebase", done: true },
  { label: "Inventario inicial de dados por modulo", done: true },
  { label: "Auditoria centralizada de visualizacao/alteracao", done: true },
  { label: "Retencao tecnica com TTL por registro", done: true },
  { label: "Canal interno para pedidos de titulares", done: true },
  { label: "Registro interno de incidente de seguranca", done: true },
  { label: "MFA obrigatorio para administradores", done: true, note: "Nao aplicavel por decisao interna" },
];

const retentionRows = [
  ["Colaborador ativo", "Durante o vinculo"],
  ["Documentos trabalhistas", "Prazo legal aplicavel e defesa juridica"],
  ["Candidato nao contratado", "6 a 12 meses, salvo banco de talentos"],
  ["Logs tecnicos e auditoria", "365 dias, salvo investigacao"],
  ["Backups", "Prazo curto, controlado e com expiracao"],
];

function StatusPill({ done }: { done: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
        done ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
      }`}
    >
      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {done ? "Ativo" : "Pendente"}
    </span>
  );
}

export function InternalPrivacySettings() {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase text-pink-500">LGPD interna</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Aviso interno de privacidade</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              O Coala One e um sistema interno da empresa para gestao operacional, administrativa,
              financeira, de RH/DP e recrutamento. Os dados pessoais sao tratados pela empresa para
              executar atividades internas, cumprir obrigacoes legais, organizar a operacao e proteger
              o ambiente corporativo.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-950 p-4 text-white">
            <p className="text-xs font-black uppercase text-white/50">Responsavel interno</p>
            <p className="mt-2 text-sm font-bold">Privacidade / Administracao</p>
            <p className="mt-1 text-xs text-white/60">Definir e-mail oficial do encarregado.</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {[
            [Users, "Titulares", "colaboradores, candidatos e usuarios internos"],
            [FileText, "Finalidades", "RH, escalas, operacao, financeiro e seguranca"],
            [LockKeyhole, "Acesso", "por perfil, funcao e necessidade operacional"],
            [TimerReset, "Retencao", "prazo por tipo de dado e obrigacao legal"],
          ].map(([Icon, title, text]) => (
            <div key={String(title)} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <Icon className="h-5 w-5 text-pink-500" />
              <p className="mt-3 text-sm font-black text-slate-950">{String(title)}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{String(text)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Database className="h-5 w-5 text-pink-500" />
            <h3 className="text-lg font-black text-slate-950">Inventario inicial de tratamento</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left text-xs">
              <thead className="border-b border-slate-100 text-[11px] uppercase text-slate-400">
                <tr>
                  <th className="py-3 pr-4">Modulo</th>
                  <th className="py-3 pr-4">Dados</th>
                  <th className="py-3 pr-4">Titular</th>
                  <th className="py-3 pr-4">Finalidade</th>
                  <th className="py-3 pr-4">Base legal provavel</th>
                  <th className="py-3 pr-4">Acesso</th>
                  <th className="py-3">Retencao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inventoryRows.map((row) => (
                  <tr key={row.module} className="align-top">
                    <td className="py-3 pr-4 font-black text-slate-900">{row.module}</td>
                    <td className="py-3 pr-4 text-slate-600">{row.data}</td>
                    <td className="py-3 pr-4 text-slate-600">{row.subject}</td>
                    <td className="py-3 pr-4 text-slate-600">{row.purpose}</td>
                    <td className="py-3 pr-4 text-slate-600">{row.legalBasis}</td>
                    <td className="py-3 pr-4 text-slate-600">{row.access}</td>
                    <td className="py-3 text-slate-600">{row.retention}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-pink-500" />
              <h3 className="text-lg font-black text-slate-950">Status LGPD</h3>
            </div>
            <div className="space-y-3">
              {checklist.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
                  <div>
                    <p className="text-xs font-bold text-slate-700">{item.label}</p>
                    {"note" in item && item.note ? <p className="mt-1 text-[10px] font-semibold text-slate-400">{item.note}</p> : null}
                  </div>
                  <StatusPill done={item.done} />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Server className="h-5 w-5 text-pink-500" />
              <h3 className="text-lg font-black text-slate-950">Fornecedores mapeados</h3>
            </div>
            <div className="space-y-3">
              {supplierRows.map(([name, purpose]) => (
                <div key={name} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs font-black text-slate-900">{name}</p>
                  <p className="mt-1 text-xs text-slate-500">{purpose}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <PrivacyGovernancePanel />

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <TimerReset className="h-5 w-5 text-pink-500" />
            <h3 className="text-lg font-black text-slate-950">Retencao inicial</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {retentionRows.map(([data, retention]) => (
              <div key={data} className="grid grid-cols-[180px_1fr] gap-4 py-3 text-sm">
                <p className="font-black text-slate-900">{data}</p>
                <p className="text-slate-600">{retention}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-pink-500" />
            <h3 className="text-lg font-black text-slate-950">Proximos controles tecnicos</h3>
          </div>
          <div className="space-y-3 text-sm text-slate-600">
            <p>1. Registrar eventos de auditoria para visualizacao, edicao, exportacao e reset de senha.</p>
            <p>2. Bloquear dados sensiveis de RH para perfis que nao sejam RH/DP ou administracao autorizada.</p>
            <p>3. Criar fluxo de solicitacao do titular: acesso, correcao, informacao e eliminacao quando aplicavel.</p>
            <p>4. Manter registro interno de incidente com dados afetados, titulares, gravidade e medidas tomadas.</p>
            <p>5. Revisar periodicamente usuarios administradores e remover acessos inativos.</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex gap-3">
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <p className="text-sm font-black text-amber-900">Pendente de decisao administrativa final</p>
            <p className="mt-1 text-sm leading-6 text-amber-800">
              Definir oficialmente o e-mail externo de privacidade, responsavel interno definitivo
              e revisao periodica de fornecedores. Esta tela e o ponto inicial de governanca,
              nao substitui revisao juridica quando necessaria.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
