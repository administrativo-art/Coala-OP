"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Instagram, Loader2, Mail, Paperclip, Send, X } from "lucide-react";
import type { HrFormQuestion, RecruitmentFormConfig } from "@/types";
import {
  DEFAULT_TALENT_POOL_FORM,
  getRecruitmentQuestionOptions,
} from "@/lib/recruitment-forms";

const FALLBACK_PUBLIC_UNITS = [
  "Tirirical",
  "João Paulo",
  "Tirimai",
  "Administrativo/CTA",
];

function formatUnitName(name: string) {
  return name.replace(/^\s*(qui[oa]?sque|loja|unidade)\s+/i, "").trim() || name;
}

function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-baseline gap-[0.3em] leading-none">
      <span className="fd text-[#EE6FA8]" style={{ fontSize: size, letterSpacing: "-0.04em" }}>coala</span>
      <span className="fd text-[#3FBCD9]" style={{ fontSize: size * 0.62 }}>shakes</span>
    </span>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}


function PageStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
      .talentos-publico {
        --pk: #EE6FA8;
        --cr: #F4ECD8;
        --ik: #2A1F2A;
        --ik2: #5B4C5B;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .talentos-publico .fd {
        font-family: 'Baloo 2', system-ui, sans-serif;
        font-weight: 800;
        letter-spacing: -0.025em;
      }
      .talentos-publico .stk {
        box-shadow: 2px 2px 0 rgba(42,31,42,.12);
      }
      .talentos-publico .btn {
        border-radius: 999px;
        box-shadow: 0 4px 0 rgba(42,31,42,.15);
        transition: transform .12s, box-shadow .12s;
      }
      .talentos-publico .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 0 rgba(42,31,42,.15);
      }
      .talentos-publico .fld {
        width: 100%;
        border-radius: 12px;
        border: 2px solid rgba(42,31,42,.1);
        background: var(--cr);
        padding: 10px 14px;
        font-size: 14px;
        color: var(--ik);
        outline: none;
      }
      .talentos-publico .fld:focus {
        border-color: var(--pk);
      }
    ` }} />
  );
}

function TalentQuestionField({
  question,
  value,
  units,
  onChange,
}: {
  question: HrFormQuestion;
  value: unknown;
  units: string[];
  onChange: (value: unknown) => void;
}) {
  const options = getRecruitmentQuestionOptions(question, { units });
  const label = `${question.text}${question.required ? " *" : ""}`;
  const placeholder = typeof question.config?.placeholder === "string" ? question.config.placeholder : "";

  if (question.type === "yes_no") {
    return (
      <div>
        <p className="mb-2 block text-[11.5px] font-bold">{label}</p>
        <div className="flex gap-2">
          {[
            { label: "Sim", value: true },
            { label: "Não", value: false },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => onChange(option.value)}
              className={`h-10 rounded-full border px-4 text-[13px] font-bold transition ${
                value === option.value
                  ? "border-[#EE6FA8] bg-[#EE6FA8] text-white"
                  : "border-[#2A1F2A]/10 bg-[#F4ECD8] text-[#5B4C5B]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (question.type === "select") {
    return (
      <div>
        <label className="mb-1.5 block text-[11.5px] font-bold">{label}</label>
        <div className="relative">
          <select
            required={question.required}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
            className="fld appearance-none"
          >
            <option value="">Selecione</option>
            {options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
        </div>
      </div>
    );
  }

  if (question.type === "multi_select") {
    const values = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    return (
      <div>
        <p className="mb-2 block text-[11.5px] font-bold">{label}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <label key={option} className="flex cursor-pointer items-center gap-2 rounded-xl bg-[#F4ECD8] px-3 py-2 text-[13px] font-bold text-[#5B4C5B]">
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

  if (question.type === "date") {
    return (
      <div>
        <label className="mb-1.5 block text-[11.5px] font-bold">{label}</label>
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
        <label className="mb-1.5 block text-[11.5px] font-bold">{label}</label>
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

  const multiline = question.config?.multiline === true;
  return (
    <div>
      <label className="mb-1.5 block text-[11.5px] font-bold">{label}</label>
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

export default function BancoDeTalentosPage() {
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [formConfig, setFormConfig] = useState<RecruitmentFormConfig>(DEFAULT_TALENT_POOL_FORM);
  const [formAnswers, setFormAnswers] = useState<Record<string, unknown>>({});
  const [consent, setConsent] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [units, setUnits] = useState<string[]>(FALLBACK_PUBLIC_UNITS);

  useEffect(() => {
    fetch("/api/hr/public-stats")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const fetchedUnits = data && Array.isArray(data.units)
          ? data.units.map(formatUnitName).filter(Boolean)
          : [];
        setUnits(fetchedUnits.length > 0 ? fetchedUnits : FALLBACK_PUBLIC_UNITS);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch("/api/hr/recruitment/forms/talent-pool/public")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data && typeof data === "object") setFormConfig(data as RecruitmentFormConfig);
      })
      .catch(() => undefined);
  }, []);

  const set = (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        rolePreference: typeof formAnswers.preferred_role === "string" ? formAnswers.preferred_role.trim() : "",
        unitPreference: typeof formAnswers.preferred_unit === "string" ? formAnswers.preferred_unit.trim() : "",
        message: typeof formAnswers.message === "string" ? formAnswers.message.trim() : "",
        formAnswers,
        consentAccepted: consent,
        website: "",
      };

      if (resumeFile) {
        const fd = new FormData();
        fd.append("file", resumeFile);
        fd.append("talentPool", "true");
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

      const response = await fetch("/api/hr/talent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Falha ao enviar cadastro.");
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="talentos-publico min-h-screen bg-[#F4ECD8] text-[#2A1F2A]">
      <PageStyles />

      <header className="sticky top-0 z-40 border-b border-[#2A1F2A]/10 bg-[#F4ECD8]/95 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center gap-4 px-5">
          <Link href="/vagas" className="flex shrink-0 items-center gap-1.5 text-[13px] font-bold text-[#5B4C5B] transition hover:text-[#EE6FA8]">
            <ChevronRight className="h-4 w-4" /> Início
          </Link>
          <Link href="/vagas" aria-label="Coala Shakes vagas">
            <Logo />
          </Link>
          <a
            href="#cadastro"
            className="btn ml-auto inline-flex h-10 items-center gap-1.5 bg-[#EE6FA8] px-4 text-[13px] font-bold text-white"
          >
            Candidatar-se <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      <main>
        <section className="bg-[#2A1F2A] px-5 py-12 md:py-16">
          <div className="mx-auto max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white/80">
              <span className="h-2 w-2 rounded-full bg-[#C7E8C8]" /> Banco de talentos
            </div>
            <h1 className="fd text-white" style={{ fontSize: "clamp(32px,5vw,60px)", lineHeight: 1 }}>
              Quer trabalhar na Coala?
            </h1>
            <p className="mt-3 text-[15px] text-white/65">
              Deixa seu contato aqui. Quando abrir uma vaga perto de você, a gente te chama primeiro.
            </p>
          </div>
        </section>

        <section id="cadastro" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-10 md:py-14">
          <div className="stk rounded-3xl bg-white p-7 md:p-10">
            {submitted ? (
              <div className="py-10 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#C7E8C8]">
                  <CheckCircle2 className="h-7 w-7 text-[#2A1F2A]" />
                </div>
                <h2 className="fd mb-2 text-[26px]">Cadastro realizado!</h2>
                <p className="mb-6 text-[14px] text-[#5B4C5B]">Recebemos tudo. Te avisamos assim que abrir algo perto do seu perfil.</p>
                <Link href="/vagas" className="btn inline-flex h-10 items-center gap-2 bg-[#F4ECD8] px-5 text-[13px] font-bold text-[#2A1F2A]">
                  Ver vagas abertas <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <h2 className="fd mb-1 text-[24px]">Seus dados</h2>
                  <p className="text-[13px] text-[#5B4C5B]">{formConfig.description || "Rápido — só o essencial."}</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-[11.5px] font-bold">Nome completo *</label>
                    <input required value={form.name} onChange={set("name")} placeholder="Seu nome" className="fld" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11.5px] font-bold">Telefone / WhatsApp</label>
                    <input type="tel" value={form.phone} onChange={set("phone")} placeholder="(98) 9 0000-0000" className="fld" />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11.5px] font-bold">E-mail *</label>
                  <input required type="email" value={form.email} onChange={set("email")} placeholder="email@exemplo.com" className="fld" />
                </div>

                {formConfig.questions.length > 0 ? (
                  <div className="border-t border-[#2A1F2A]/10 pt-5">
                    <h3 className="fd mb-4 text-[18px]">Perfil e preferências</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {formConfig.questions.map((question) => (
                        <div key={question.id} className={question.config?.multiline === true || question.type === "multi_select" ? "sm:col-span-2" : ""}>
                          <TalentQuestionField
                            question={question}
                            value={formAnswers[question.id]}
                            units={units}
                            onChange={(value) => setFormAnswers((current) => ({ ...current, [question.id]: value }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div>
                  <label className="mb-1.5 block text-[11.5px] font-bold">Currículo (PDF, DOC)</label>
                  {resumeFile ? (
                    <div className="flex items-center gap-2.5 rounded-[12px] border-2 border-[#EE6FA8]/20 bg-[#F4ECD8] px-4 py-3">
                      <Paperclip className="h-4 w-4 shrink-0 text-[#EE6FA8]" />
                      <span className="flex-1 truncate text-[13px] text-[#5B4C5B]">{resumeFile.name}</span>
                      <button type="button" onClick={() => setResumeFile(null)} className="text-[#5B4C5B] hover:text-[#2A1F2A]" aria-label="Remover currículo">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-[#2A1F2A]/10 bg-[#F4ECD8] px-5 py-4 transition hover:border-[#EE6FA8]">
                      <Paperclip className="h-5 w-5 text-[#EE6FA8]" />
                      <div>
                        <p className="text-[13px] font-bold">Anexar currículo</p>
                        <p className="text-[11px] text-[#5B4C5B]">PDF, DOC até 10 MB</p>
                      </div>
                      <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)} />
                    </label>
                  )}
                </div>

                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#EE6FA8]" />
                  <span className="text-[11.5px] leading-relaxed text-[#5B4C5B]">
                    {formConfig.consentText || "Autorizo o tratamento dos meus dados para fins de recrutamento, conforme a LGPD."}
                  </span>
                </label>

                {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">{error}</p> : null}

                <button
                  type="submit"
                  disabled={submitting || !consent}
                  className="btn inline-flex h-[52px] w-full items-center justify-center gap-2 bg-[#EE6FA8] text-[15px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {submitting ? "Enviando..." : formConfig.submitLabel || "Enviar cadastro"}
                </button>

                <div className="flex items-center justify-center gap-4 text-[11px] text-[#5B4C5B]">
                  <span>🔒 Dados protegidos pela LGPD</span>
                  <span>·</span>
                  <span>⏱ Retorno em até 5 dias úteis</span>
                </div>
              </form>
            )}
          </div>
        </section>
      </main>

      <footer className="bg-[#2A1F2A] px-5 py-14 text-white">
        <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-6 max-w-[420px] text-[14px] leading-relaxed text-white/50">
              Shakes únicos, rotina dinâmica e um ambiente bom para trabalhar. Estamos em São Luís desde 2019.
            </p>
            <div className="mt-6 flex gap-2">
              <a href="https://www.instagram.com/coalashakes/" target="_blank" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:-translate-y-0.5" rel="noreferrer">
                <Instagram className="h-[18px] w-[18px]" />
              </a>
              <a href="https://wa.me/5598999072739" target="_blank" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:-translate-y-0.5" rel="noreferrer">
                <WhatsAppIcon className="h-[18px] w-[18px]" />
              </a>
              <a href="mailto:vagas@coalashakes.com" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:-translate-y-0.5" aria-label="Enviar e-mail">
                <Mail className="h-[18px] w-[18px]" />
              </a>
            </div>
          </div>
          {units.length > 0 ? (
            <div>
              <div className="mb-5 text-[10.5px] font-bold uppercase tracking-widest text-white/35">Unidades</div>
              <ul className="space-y-3 text-[14px] text-white/55">
                {units.map((location) => (
                  <li key={location} className="grid grid-cols-[6px_1fr] items-start gap-3">
                    <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[#EE6FA8]" />
                    <span className="min-w-0 leading-snug">
                      <span className="block text-white/58">Coala {location}</span>
                      <span className="mt-0.5 block text-[12px] text-white/30">São Luís · MA</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <div className="mb-5 text-[10.5px] font-bold uppercase tracking-widest text-white/35">Fala com a gente</div>
            <div className="flex flex-col space-y-3 text-[14px] text-white/55">
              <a href="mailto:vagas@coalashakes.com" className="transition hover:text-white">vagas@coalashakes.com</a>
              <a href="https://wa.me/5598999072739" target="_blank" className="transition hover:text-white" rel="noreferrer">Contato: (98) 99907-2739</a>
            </div>
          </div>
        </div>
        <div className="mx-auto mt-10 flex max-w-7xl flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-[12px] text-white/30">
          <span>© {new Date().getFullYear()} Coala Shakes · vagas.coalashakes.com</span>
          <Link href="/vagas" className="transition hover:text-white/60">Ver vagas abertas</Link>
        </div>
      </footer>
    </div>
  );
}
