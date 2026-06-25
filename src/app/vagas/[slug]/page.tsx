"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  Coffee,
  Loader2,
  MapPin,
  Monitor,
  Paperclip,
  Send,
  Users,
  X,
} from "lucide-react";
import type { HrFormQuestion, JobRoleSalaryRange } from "@/types";
import {
  buildRecruitmentQuestionTree,
  getConditionallyVisibleRecruitmentQuestions,
  groupRecruitmentQuestionsBySection,
  type RecruitmentQuestionTreeNode,
} from "@/lib/recruitment-forms";

type WorkType = "presencial" | "remoto" | "hibrido";

interface PublicOpening {
  id: string;
  title: string;
  slug: string;
  jobRoleName?: string;
  description?: string;
  requirements?: string[];
  benefits?: string[];
  publicSalaryRange?: JobRoleSalaryRange | null;
  applyButtonLabel?: string | null;
  formQuestions?: HrFormQuestion[];
  location?: string;
  workSchedule?: string | null;
  workType?: WorkType;
  contractTypeLabel?: string | null;
  slots: number;
  closesAt?: string;
}

const WORK_TYPE_LABELS: Record<WorkType, string> = {
  presencial: "Presencial",
  remoto: "Remoto",
  hibrido: "Híbrido",
};

const BENEFITS = [
  { emoji: "🥤", title: "Shake na casa" },
  { emoji: "🚌", title: "Vale-transporte" },
  { emoji: "💰", title: "PLR semestral" },
  { emoji: "🎓", title: "Trilha de carreira" },
  { emoji: "🏥", title: "Plano Sulamérica" },
  { emoji: "🎉", title: "Day-off aniversário" },
];

const BENEFIT_EMOJIS = ["🥤", "🚌", "💰", "🎓", "🏥", "🎉"];

function getQuestionOptions(question: HrFormQuestion) {
  const options = question.config?.options;
  return Array.isArray(options)
    ? options.filter((option): option is string => typeof option === "string" && option.trim().length > 0)
    : [];
}

function hasAnswer(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function getLocationLabel(value?: string) {
  if (!value?.trim()) return "São Luís";
  return value
    .split(/[,-]/)[0]
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\p{L}/gu, (char) => char.toLocaleUpperCase("pt-BR"));
}

function daysUntil(date?: string) {
  if (!date) return null;
  const diff = new Date(date).getTime() - Date.now();
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

function formatPublicSalaryRange(range?: JobRoleSalaryRange | null) {
  if (!range?.visible) return null;
  const formatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: range.currency || "BRL",
    maximumFractionDigits: 0,
  });
  if (range.min !== undefined && range.max !== undefined) {
    return `${formatter.format(range.min)}-${formatter.format(range.max)}`;
  }
  if (range.min !== undefined) return `a partir de ${formatter.format(range.min)}`;
  if (range.max !== undefined) return `até ${formatter.format(range.max)}`;
  return "Salário a combinar";
}

function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-baseline gap-[0.3em] leading-none">
      <span className="fd text-[#EE6FA8]" style={{ fontSize: size, letterSpacing: "-0.04em" }}>coala</span>
      <span className="fd text-[#3FBCD9]" style={{ fontSize: size * 0.62 }}>shakes</span>
    </span>
  );
}

function PageStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
      .vaga-publica {
        --pk: #EE6FA8;
        --pk-d: #D9528E;
        --cy: #3FBCD9;
        --cr: #F4ECD8;
        --ik: #2A1F2A;
        --ik2: #5B4C5B;
        --mn: #C7E8C8;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .vaga-publica .fd {
        font-family: 'Baloo 2', system-ui, sans-serif;
        font-weight: 800;
        letter-spacing: -0.025em;
      }
      .vaga-publica .stk {
        box-shadow: 2px 2px 0 rgba(42,31,42,.12);
      }
      .vaga-publica .btn {
        border-radius: 999px;
        box-shadow: 0 4px 0 rgba(42,31,42,.15);
        transition: transform .12s, box-shadow .12s;
      }
      .vaga-publica .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 0 rgba(42,31,42,.15);
      }
      .vaga-publica .btn:active {
        transform: translateY(2px);
        box-shadow: 0 2px 0 rgba(42,31,42,.15);
      }
      .vaga-publica .fld {
        width: 100%;
        border-radius: 12px;
        border: 2px solid rgba(42,31,42,.1);
        background: var(--cr);
        padding: 10px 14px;
        font-size: 14px;
        color: var(--ik);
        outline: none;
        transition: border-color .15s;
      }
      .vaga-publica .fld:focus {
        border-color: var(--pk);
      }
    ` }} />
  );
}

function FormQuestionField({
  question,
  value,
  onChange,
}: {
  question: HrFormQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const options = getQuestionOptions(question);
  const label = `${question.text}${question.required ? " *" : ""}`;
  const placeholder = typeof question.config?.placeholder === "string" ? question.config.placeholder : "";

  if (question.type === "yes_no") {
    return (
      <div className="space-y-2">
        <p className="text-[11.5px] font-bold text-[#2A1F2A]">{label}</p>
        <div className="flex gap-3">
          {[
            { label: "Sim", value: true },
            { label: "Não", value: false },
          ].map((option) => (
            <label key={option.label} className="flex items-center gap-2 text-[13px] font-semibold text-[#5B4C5B]">
              <input
                type="radio"
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                className="accent-[#EE6FA8]"
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (question.type === "select") {
    return (
      <div>
        <label className="mb-1.5 block text-[11.5px] font-bold text-[#2A1F2A]">{label}</label>
        <select
          required={question.required}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className="fld"
        >
          <option value="">Selecione</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
    );
  }

  if (question.type === "multi_select") {
    const values = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    return (
      <div className="space-y-2">
        <p className="text-[11.5px] font-bold text-[#2A1F2A]">{label}</p>
        <div className="space-y-2">
          {options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-[13px] font-semibold text-[#5B4C5B]">
              <input
                type="checkbox"
                checked={values.includes(option)}
                onChange={(event) => onChange(event.target.checked ? [...values, option] : values.filter((entry) => entry !== option))}
                className="accent-[#EE6FA8]"
              />
              {option}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (question.type === "text") {
    const multiline = question.config?.multiline === true;
    return (
      <div>
        <label className="mb-1.5 block text-[11.5px] font-bold text-[#2A1F2A]">{label}</label>
        {multiline ? (
          <textarea
            required={question.required}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
            rows={3}
            placeholder={placeholder}
            className="fld resize-none"
          />
        ) : (
          <input
            required={question.required}
            type="text"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            className="fld"
          />
        )}
      </div>
    );
  }

  if (question.type === "date") {
    return (
      <div>
        <label className="mb-1.5 block text-[11.5px] font-bold text-[#2A1F2A]">{label}</label>
        <input
          required={question.required}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className="fld"
        />
      </div>
    );
  }

  if (question.type === "number_range") {
    return (
      <div>
        <label className="mb-1.5 block text-[11.5px] font-bold text-[#2A1F2A]">{label}</label>
        <input
          required={question.required}
          type="number"
          value={typeof value === "number" || typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value ? Number(event.target.value) : "")}
          placeholder={placeholder}
          className="fld"
        />
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1.5 block text-[11.5px] font-bold text-[#2A1F2A]">{label}</label>
      <input
        required={question.required}
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="fld"
      />
    </div>
  );
}

function FormQuestionNode({
  node,
  answers,
  onAnswer,
}: {
  node: RecruitmentQuestionTreeNode;
  answers: Record<string, unknown>;
  onAnswer: (questionId: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-3">
      <FormQuestionField
        question={node.question}
        value={answers[node.question.id]}
        onChange={(value) => onAnswer(node.question.id, value)}
      />
      {node.subquestions.length > 0 ? (
        <div className="ml-3 space-y-4 border-l-2 border-[#2A1F2A]/10 pl-4">
          {node.subquestions.map((subquestion) => (
            <FormQuestionNode
              key={subquestion.question.id}
              node={subquestion}
              answers={answers}
              onAnswer={onAnswer}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function VagaDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const [opening, setOpening] = useState<PublicOpening | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [consent, setConsent] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const visibleQuestions = opening
    ? getConditionallyVisibleRecruitmentQuestions(opening.formQuestions ?? [], answers)
    : [];
  const visibleQuestionSections = groupRecruitmentQuestionsBySection(visibleQuestions, "Perguntas de triagem");
  const handleQuestionAnswer = (questionId: string, value: unknown) => {
    if (!opening) return;
    setAnswers((current) => {
      const next = { ...current, [questionId]: value };
      const nextVisible = getConditionallyVisibleRecruitmentQuestions(opening.formQuestions ?? [], next);
      const nextVisibleIds = new Set(nextVisible.map((entry) => entry.id));
      return Object.fromEntries(
        Object.entries(next).filter(([entryQuestionId]) => nextVisibleIds.has(entryQuestionId))
      );
    });
  };

  useEffect(() => {
    fetch("/api/hr/openings/public")
      .then((response) => response.json())
      .then((data: PublicOpening[]) => {
        const found = data.find((item) => item.slug === slug);
        if (found) {
          setOpening(found);
          setAnswers({});
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  const set = (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      if (!opening) throw new Error("Vaga não encontrada ou encerrada.");
      const missingQuestion = visibleQuestions.find((question) => question.required && !hasAnswer(answers[question.id]));
      if (missingQuestion) throw new Error(`Responda a pergunta obrigatória: ${missingQuestion.text}`);
      const visibleQuestionIds = new Set(visibleQuestions.map((question) => question.id));
      const visibleAnswers = Object.fromEntries(
        Object.entries(answers).filter(([questionId]) => visibleQuestionIds.has(questionId))
      );

      const payload: Record<string, unknown> = {
        slug,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        message: form.message.trim(),
        source: "site",
        formAnswers: visibleAnswers,
      };

      if (resumeFile) {
        const fd = new FormData();
        fd.append("file", resumeFile);
        fd.append("slug", slug);
        fd.append("website", "");
        const uploadRes = await fetch("/api/hr/upload", { method: "POST", body: fd });
        if (!uploadRes.ok) {
          const data = await uploadRes.json().catch(() => null);
          throw new Error(data?.error ?? "Falha ao enviar currículo.");
        }

        const { url, path } = await uploadRes.json();
        payload.resumeUrl = url;
        if (path) payload.resumePath = path;
      }

      const response = await fetch("/api/hr/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, consentAccepted: consent, website: "" }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Falha ao enviar candidatura.");
      }

      setSubmitted(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Erro ao enviar. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="vaga-publica flex min-h-screen items-center justify-center bg-[#F4ECD8]">
        <PageStyles />
        <Loader2 className="h-8 w-8 animate-spin text-[#EE6FA8]" />
      </div>
    );
  }

  if (notFound || !opening) {
    return (
      <div className="vaga-publica flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F4ECD8] text-[#5B4C5B]">
        <PageStyles />
        <p className="text-lg font-bold">Vaga não encontrada ou encerrada.</p>
        <Link href="/vagas" className="flex items-center gap-1 text-sm font-bold text-[#EE6FA8] hover:text-[#D9528E]">
          <ArrowLeft className="h-4 w-4" /> Ver todas as vagas
        </Link>
      </div>
    );
  }

  const location = getLocationLabel(opening.location);
  const closingDays = daysUntil(opening.closesAt);
  const salaryLabel = formatPublicSalaryRange(opening.publicSalaryRange);
  const benefitItems = opening.benefits?.length
    ? opening.benefits.map((title, index) => ({ emoji: BENEFIT_EMOJIS[index % BENEFIT_EMOJIS.length], title }))
    : BENEFITS;
  const applyButtonLabel = opening.applyButtonLabel?.trim() || "Enviar candidatura";
  const workTypeLabel = opening.workType ? WORK_TYPE_LABELS[opening.workType] : null;
  const contractTypeLabel = opening.contractTypeLabel?.trim() || null;
  const badges: Array<{ icon: typeof MapPin; label: string }> = [
    { icon: MapPin, label: `Coala ${location}` },
    ...(workTypeLabel ? [{ icon: Monitor, label: workTypeLabel }] : []),
    ...(salaryLabel ? [{ icon: Banknote, label: salaryLabel }] : []),
    ...(opening.slots > 1 ? [{ icon: Users, label: `${opening.slots} vagas` }] : []),
    ...(closingDays != null ? [{ icon: Coffee, label: `Encerra em ${closingDays} dias` }] : []),
  ];

  return (
    <div className="vaga-publica min-h-screen bg-[#F4ECD8] text-[#2A1F2A]">
      <PageStyles />

      <header className="sticky top-0 z-40 border-b border-[#2A1F2A]/10 bg-[#F4ECD8]/95 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center gap-4 px-5">
          <Link href="/vagas" className="flex shrink-0 items-center gap-2 text-[13px] font-bold text-[#5B4C5B] transition hover:text-[#EE6FA8]">
            <ChevronLeft className="h-4 w-4" /> Início
          </Link>
          <Link href="/vagas" aria-label="Coala Shakes vagas">
            <Logo />
          </Link>
          <a href="#apply-form" className="btn ml-auto inline-flex h-10 items-center gap-1.5 bg-[#EE6FA8] px-5 text-[13px] font-bold text-white">
            {applyButtonLabel} <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      <main>
        <section className="bg-[#2A1F2A] px-5 py-12 md:py-16">
          <div className="mx-auto max-w-7xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white/80">
              <span className="h-2 w-2 rounded-full bg-[#C7E8C8]" />
              {opening.jobRoleName ?? "Vaga Coala"}
            </div>
            <h1 className="fd mb-6 max-w-4xl text-white" style={{ fontSize: "clamp(30px,5.5vw,66px)", lineHeight: 1 }}>
              {opening.title}
            </h1>
            <div className="flex flex-wrap gap-2">
              {badges.map((badge) => {
                const Icon = badge.icon;
                return (
                  <span key={badge.label} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-bold text-white/85">
                    <Icon className="h-3.5 w-3.5" /> {badge.label}
                  </span>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-8 px-5 py-10 md:py-14 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="stk rounded-[24px] bg-white p-5">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5B4C5B]">Local</div>
                <p className="text-[16px] font-bold text-[#2A1F2A]">{opening.location || `Coala ${location}`}</p>
              </div>
              <div className="stk rounded-[24px] bg-white p-5">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5B4C5B]">Jornada</div>
                <p className="whitespace-pre-line text-[16px] font-bold leading-snug text-[#2A1F2A]">
                  {opening.workSchedule || "Definida durante o processo"}
                </p>
              </div>
              <div className="stk rounded-[24px] bg-white p-5">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5B4C5B]">Forma de contratação</div>
                <p className="text-[16px] font-bold text-[#2A1F2A]">{contractTypeLabel || "A definir"}</p>
              </div>
            </div>

            <div className="stk rounded-[30px] bg-white p-7 md:p-8">
              <div className="mb-5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5B4C5B]">Sobre a vaga</div>
              <p className="whitespace-pre-line text-[17px] leading-relaxed text-[#5B4C5B]">
                {opening.description || "Rotina dinâmica, atendimento próximo e treinamento completo com o time Coala."}
              </p>
            </div>

            {opening.requirements && opening.requirements.length > 0 ? (
              <div className="stk rounded-[30px] bg-white p-7 md:p-8">
                <div className="mb-5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5B4C5B]">Requisitos</div>
                <ul className="space-y-4">
                  {opening.requirements.map((requirement, index) => (
                    <li key={`${requirement}-${index}`} className="flex items-start gap-3 text-[16px] text-[#5B4C5B]">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#C7E8C8]">
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#2A1F2A]" />
                      </span>
                      {requirement}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="stk rounded-[30px] bg-[#FCDFEB] p-7 md:p-8">
              <div className="mb-6 text-[11px] font-bold uppercase tracking-[0.18em] text-[#EE6FA8]">Benefícios</div>
              <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                {benefitItems.map((benefit) => (
                  <div key={benefit.title} className="flex items-center gap-3 text-[15px] font-bold">
                    <span>{benefit.emoji}</span>{benefit.title}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <aside id="apply-form" className="stk scroll-mt-24 rounded-[30px] bg-white p-7 md:p-8 lg:sticky lg:top-24">
            {submitted ? (
              <div className="py-8 text-center">
                <div className="mb-3 text-[56px]">🥳</div>
                <h3 className="fd mb-2 text-[26px]">Candidatura enviada!</h3>
                <p className="mb-6 text-[14px] text-[#5B4C5B]">Recebemos tudo. Entramos em contato em até 5 dias úteis.</p>
                <Link href="/vagas" className="btn inline-flex h-10 items-center gap-2 bg-[#F4ECD8] px-5 text-[13px] font-bold text-[#2A1F2A]">
                  <ArrowLeft className="h-3.5 w-3.5" /> Ver outras vagas
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <h2 className="fd mb-1 text-[28px] leading-none">Candidatar-se</h2>
                  <p className="text-[15px] text-[#5B4C5B]">Preencha abaixo. Respondemos em até 5 dias úteis.</p>
                </div>

                <div>
                  <label className="mb-1.5 block text-[12px] font-bold">Nome completo *</label>
                  <input required value={form.name} onChange={set("name")} placeholder="Seu nome" className="fld h-[54px]" />
                </div>

                <div>
                  <label className="mb-1.5 block text-[12px] font-bold">E-mail *</label>
                  <input required type="email" value={form.email} onChange={set("email")} placeholder="email@example.com" className="fld h-[54px]" />
                </div>

                <div>
                  <label className="mb-1.5 block text-[12px] font-bold">Telefone</label>
                  <input type="tel" value={form.phone} onChange={set("phone")} placeholder="(98) 9 0000-0000" className="fld h-[54px]" />
                </div>

                <div>
                  <label className="mb-1.5 block text-[12px] font-bold">Currículo (PDF, DOC)</label>
                  {resumeFile ? (
                    <div className="flex min-h-[54px] items-center gap-2.5 rounded-[12px] border-2 border-[#EE6FA8]/20 bg-[#F4ECD8] px-4 py-3">
                      <Paperclip className="h-4 w-4 shrink-0 text-[#EE6FA8]" />
                      <span className="flex-1 truncate text-[13px] text-[#5B4C5B]">{resumeFile.name}</span>
                      <button type="button" onClick={() => setResumeFile(null)} className="text-[#5B4C5B] hover:text-[#2A1F2A]" aria-label="Remover currículo">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex min-h-[54px] cursor-pointer items-center gap-3 rounded-[12px] border-2 border-dashed border-[#2A1F2A]/10 bg-[#F4ECD8] px-4 py-3 transition hover:border-[#EE6FA8]">
                      <Paperclip className="h-5 w-5 text-[#EE6FA8]" />
                      <span className="truncate text-[14px] text-[#5B4C5B]">Anexar currículo (opcional)</span>
                      <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)} />
                    </label>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-[12px] font-bold">Mensagem</label>
                  <textarea value={form.message} onChange={set("message")} rows={4} placeholder="Conte um pouco sobre você..." className="fld resize-none" />
                </div>

                {visibleQuestionSections.length > 0 ? (
                  <div className="space-y-4 border-t border-[#2A1F2A]/10 pt-5">
                    <h3 className="fd text-[18px]">Perguntas de triagem</h3>
                    {visibleQuestionSections.map((section) => (
                      <div key={section.id} className="space-y-4">
                        {visibleQuestionSections.length > 1 || !section.isFallback ? (
                          <h4 className="border-b border-[#2A1F2A]/10 pb-2 text-[12px] font-bold uppercase tracking-[0.14em] text-[#5B4C5B]">
                            {section.title}
                          </h4>
                        ) : null}
                        {buildRecruitmentQuestionTree(section.questions).map((node) => (
                          <FormQuestionNode
                            key={node.question.id}
                            node={node}
                            answers={answers}
                            onAnswer={handleQuestionAnswer}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                ) : null}

                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#EE6FA8]"
                  />
                  <span className="text-[11.5px] leading-relaxed text-[#5B4C5B]">
                    Autorizo o tratamento dos meus dados para recrutamento, conforme a LGPD.
                  </span>
                </label>

                {submitError ? (
                  <p className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {submitError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting || !consent}
                  className="btn inline-flex h-[52px] w-full items-center justify-center gap-2 bg-[#EE6FA8] text-[15px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {submitting ? "Enviando..." : applyButtonLabel}
                </button>

                <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-[#5B4C5B]">
                  <span>🔒 Dados protegidos pela LGPD</span>
                  <span>·</span>
                  <span>⏱ Respondemos em até 5 dias úteis</span>
                </div>
              </form>
            )}
          </aside>
        </section>
      </main>

      <footer className="bg-[#2A1F2A] px-5 py-10 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 text-[12px] text-white/35">
          <Logo />
          <span>{new Date().getFullYear()} Coala Shakes · vagas.coalashakes.com</span>
          <a href="mailto:vagas@coalashakes.com" className="hover:text-white/70">vagas@coalashakes.com</a>
        </div>
      </footer>
    </div>
  );
}
