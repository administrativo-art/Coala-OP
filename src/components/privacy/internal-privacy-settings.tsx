"use client";

import { useState } from "react";

import { ControlPanel } from "@/components/patterns/control-panel";
import { FilterChips } from "@/components/patterns/filter-chips";
import { LiftRow } from "@/components/patterns/lift-row";
import { PanelField, PanelSection } from "@/components/patterns/side-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { PrivacyGovernancePanel } from "@/components/privacy/privacy-governance-panel";

const inventoryRows = [
  {
    module: "Login e usuários",
    data: "Nome, e-mail, senha, perfil, quiosques, status, foto",
    subject: "Usuário interno",
    purpose: "Acesso ao sistema e controle de permissões",
    legalBasis: "Execução de contrato / legítimo interesse",
    access: "Administradores e gestores autorizados",
    retention: "Enquanto houver vínculo ou necessidade operacional",
  },
  {
    module: "DP/RH",
    data: "Cargo, admissão, documentos, dados cadastrais, benefícios",
    subject: "Colaborador",
    purpose: "Gestão do vínculo de trabalho e obrigações trabalhistas",
    legalBasis: "Contrato / obrigação legal / exercício regular de direitos",
    access: "RH/DP e administração autorizada",
    retention: "Conforme prazo trabalhista e defesa jurídica",
  },
  {
    module: "Escalas",
    data: "Turnos, folgas, unidades, horários, restrições de acesso",
    subject: "Colaborador",
    purpose: "Organização da jornada e operação das lojas",
    legalBasis: "Contrato / legítimo interesse",
    access: "RH/DP, líderes e gestores da unidade",
    retention: "Enquanto necessário para operação e registros internos",
  },
  {
    module: "Recrutamento",
    data: "Nome, e-mail, telefone, currículo, respostas e histórico",
    subject: "Candidato",
    purpose: "Processo seletivo e banco de talentos",
    legalBasis: "Medidas pré-contratuais / legítimo interesse / consentimento",
    access: "RH, recrutamento e gestores envolvidos",
    retention: "6 a 12 meses após encerramento, salvo banco de talentos",
  },
  {
    module: "Financeiro",
    data: "Dados de pagamentos, centros de custo, despesas e comprovantes",
    subject: "Colaborador ou fornecedor pessoa física",
    purpose: "Controle financeiro, pagamentos e prestação de contas",
    legalBasis: "Contrato / obrigação legal",
    access: "Financeiro e administração autorizada",
    retention: "Conforme obrigação fiscal, contábil e jurídica",
  },
  {
    module: "Auditoria e logs",
    data: "Usuário, data, ação, registro afetado, IP/dispositivo quando disponível",
    subject: "Usuário interno",
    purpose: "Segurança, rastreabilidade e investigação de incidentes",
    legalBasis: "Legítimo interesse / cumprimento de obrigação legal",
    access: "Administradores e responsáveis por segurança",
    retention: "365 dias, salvo investigação ou obrigação específica",
  },
];

const supplierRows = [
  ["Google Firebase", "Autenticação, banco de dados, storage e hosting"],
  ["Bizneo", "Dados cadastrais e informações de RH"],
  ["PDV Legal", "Operação, vendas e dados relacionados ao PDV"],
  ["MarqPonto / ponto", "Registros de jornada, se integrado"],
  ["Contabilidade / folha", "Obrigações trabalhistas, fiscais e contábeis"],
];

const checklist = [
  { label: "Consentimento LGPD em candidaturas públicas", done: true },
  { label: "Controle de acesso por perfis", done: true },
  { label: "Reset de senha via e-mail do Firebase", done: true },
  { label: "Inventário inicial de dados por módulo", done: true },
  { label: "Auditoria centralizada de visualização/alteração", done: true },
  { label: "Retenção técnica com TTL por registro", done: true },
  { label: "Canal interno para pedidos de titulares", done: true },
  { label: "Registro interno de incidente de segurança", done: true },
  { label: "MFA obrigatório para administradores", done: true, note: "Não aplicável por decisão interna" },
];

const retentionRows = [
  ["Colaborador ativo", "Durante o vínculo"],
  ["Documentos trabalhistas", "Prazo legal aplicável e defesa jurídica"],
  ["Candidato não contratado", "6 a 12 meses, salvo banco de talentos"],
  ["Logs técnicos e auditoria", "365 dias, salvo investigação"],
  ["Backups", "Prazo curto, controlado e com expiração"],
];

const nextControls = [
  "Registrar eventos de auditoria para visualização, edição, exportação e reset de senha.",
  "Bloquear dados sensíveis de RH para perfis que não sejam RH/DP ou administração autorizada.",
  "Criar fluxo de solicitação do titular: acesso, correção, informação e eliminação quando aplicável.",
  "Manter registro interno de incidente com dados afetados, titulares, gravidade e medidas tomadas.",
  "Revisar periodicamente usuários administradores e remover acessos inativos.",
];

const facts = [
  ["Titulares", "colaboradores, candidatos e usuários internos"],
  ["Finalidades", "RH, escalas, operação, financeiro e segurança"],
  ["Acesso", "por perfil, função e necessidade operacional"],
  ["Retenção", "prazo por tipo de dado e obrigação legal"],
];

const SECTIONS = [
  { value: "inventory", label: "Inventário", count: inventoryRows.length },
  { value: "status", label: "Status LGPD", count: checklist.length },
  { value: "suppliers", label: "Fornecedores", count: supplierRows.length },
  { value: "governance", label: "Pedidos e incidentes" },
  { value: "retention", label: "Retenção e controles" },
];

export function InternalPrivacySettings() {
  /** `null` é o primeiro chip ("Inventário"), o padrão do FilterChips. */
  const [section, setSection] = useState<string | null>(null);
  const active = section ?? "inventory";

  return (
    <div className="space-y-5">
      <ControlPanel className="flex flex-col gap-5 px-[26px] pb-5 pt-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">LGPD interna</p>
            <h2 className="mt-1.5 text-[26px] font-extrabold tracking-[-0.03em]">Aviso interno de privacidade</h2>
            <p className="mt-2 text-[13.5px] leading-6 text-ds-on-dark-2">
              O Coala One é um sistema interno da empresa para gestão operacional, administrativa, financeira, de RH/DP e
              recrutamento. Os dados pessoais são tratados pela empresa para executar atividades internas, cumprir obrigações
              legais, organizar a operação e proteger o ambiente corporativo.
            </p>
          </div>
          <div className="min-w-[220px] rounded-ds-card bg-white/[0.07] p-4">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">Responsável interno</p>
            <p className="mt-1.5 text-sm font-bold">Privacidade / Administração</p>
            <p className="mt-0.5 text-xs text-ds-on-dark-sub">Definir e-mail oficial do encarregado.</p>
          </div>
        </div>
        <dl className="m-0 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          {facts.map(([title, text]) => (
            <div key={title}>
              <dt className="text-[13px] font-extrabold">{title}</dt>
              <dd className="m-0 mt-0.5 text-xs leading-5 text-ds-on-dark-sub">{text}</dd>
            </div>
          ))}
        </dl>
        <FilterChips
          chips={SECTIONS.slice(1).map((item) => ({ value: item.value, label: item.label, count: item.count }))}
          value={section}
          onChange={setSection}
          allLabel="Inventário"
          allCount={inventoryRows.length}
        />
      </ControlPanel>

      <p role="note" className="rounded-ds-btn border border-ds-alert-border bg-ds-alert-bg px-4 py-3 text-[13px] leading-6 text-ds-alert-ink">
        <strong className="font-extrabold">Pendente de decisão administrativa final.</strong> Definir oficialmente o e-mail externo de
        privacidade, o responsável interno definitivo e a revisão periódica de fornecedores. Esta tela é o ponto inicial de
        governança e não substitui revisão jurídica quando necessária.
      </p>

      {active === "inventory" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {inventoryRows.map((row) => (
            <PanelSection key={row.module} title={row.module} aside={row.subject}>
              <PanelField label="Dados">{row.data}</PanelField>
              <PanelField label="Finalidade">{row.purpose}</PanelField>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <PanelField label="Base legal provável">{row.legalBasis}</PanelField>
                <PanelField label="Acesso">{row.access}</PanelField>
              </div>
              <PanelField label="Retenção">{row.retention}</PanelField>
            </PanelSection>
          ))}
        </div>
      ) : null}

      {active === "status" ? (
        <section className="rounded-ds-card-lg border border-ds-border bg-ds-warm">
          {checklist.map((item) => (
            <LiftRow key={item.label} interactive={false} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[13.5px] font-bold">{item.label}</p>
                {"note" in item && item.note ? <p className="mt-0.5 text-xs text-ds-ink-muted">{item.note}</p> : null}
              </div>
              <StatusPill variant={item.done ? "ok" : "warn"}>{item.done ? "Ativo" : "Pendente"}</StatusPill>
            </LiftRow>
          ))}
        </section>
      ) : null}

      {active === "suppliers" ? (
        <section className="rounded-ds-card-lg border border-ds-border bg-ds-warm">
          {supplierRows.map(([name, purpose]) => (
            <LiftRow key={name} interactive={false}>
              <p className="text-[13.5px] font-bold">{name}</p>
              <p className="mt-0.5 text-xs text-ds-ink-muted">{purpose}</p>
            </LiftRow>
          ))}
        </section>
      ) : null}

      {active === "governance" ? <PrivacyGovernancePanel /> : null}

      {active === "retention" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <PanelSection title="Retenção inicial">
            <dl className="m-0 divide-y divide-ds-divider">
              {retentionRows.map(([data, retention]) => (
                <div key={data} className="grid grid-cols-[170px_1fr] gap-4 py-2.5 first:pt-0 last:pb-0 text-[13px]">
                  <dt className="font-bold">{data}</dt>
                  <dd className="m-0 text-ds-ink-2">{retention}</dd>
                </div>
              ))}
            </dl>
          </PanelSection>
          <PanelSection title="Próximos controles técnicos">
            <ol className="m-0 list-decimal space-y-2.5 pl-5 text-[13px] leading-5 text-ds-ink-2">
              {nextControls.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </PanelSection>
        </div>
      ) : null}
    </div>
  );
}
