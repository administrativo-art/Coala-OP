"use client";

import React, { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileUp, Loader2, Paperclip, Send, X } from "lucide-react";

type PublicOnboardingDocument = {
  id: string;
  label: string;
  description?: string | null;
  required?: boolean;
  order?: number;
  status?: "pending" | "received" | "ai_approved" | "review_required" | "approved" | "rejected";
  fileUrl?: string | null;
  updatedAt?: string | null;
};

type PublicOnboarding = {
  id: string;
  candidateName?: string | null;
  candidateEmail?: string | null;
  jobRoleName?: string | null;
  functionName?: string | null;
  unitName?: string | null;
  status?: string | null;
  documents?: PublicOnboardingDocument[];
  publicFormAnswers?: Record<string, unknown>;
  publicFormSubmittedAt?: string | null;
};

type ChildAnswer = { birthDate: string };

type FormalizationAnswers = {
  identityDocumentType: string;
  bankName: string;
  bankAgency: string;
  bankAccount: string;
  pixKey: string;
  uniformShirtSize: string;
  uniformPantsSize: string;
  uniformShoeSize: string;
  hasCnh: string;
  wantsTransportVoucher: string;
  childrenCount: number;
  children: ChildAnswer[];
  notes: string;
};

const EMPTY_ANSWERS: FormalizationAnswers = {
  identityDocumentType: "",
  bankName: "",
  bankAgency: "",
  bankAccount: "",
  pixKey: "",
  uniformShirtSize: "",
  uniformPantsSize: "",
  uniformShoeSize: "",
  hasCnh: "",
  wantsTransportVoucher: "",
  childrenCount: 0,
  children: [],
  notes: "",
};

const SHIRT_SIZES = ["PP", "P", "M", "G", "GG", "XG"];
const SHOE_SIZES = ["33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45"];

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asChoice(value: unknown, allowed: readonly string[]) {
  const text = asString(value);
  return allowed.includes(text) ? text : "";
}

function asChildren(value: unknown, count: number): ChildAnswer[] {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => {
    const entry = list[index];
    const data = entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : {};
    const birthDate = asString(data.birthDate);
    return { birthDate: /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? birthDate : "" };
  });
}

function dependentAge(birthDate: string) {
  if (!birthDate) return null;
  const date = new Date(`${birthDate}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDelta = today.getMonth() - date.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < date.getDate())) age -= 1;
  return age;
}

function familyRequiredDocs(birthDate: string) {
  const age = dependentAge(birthDate);
  if (age == null) return ["birth_certificate"] as const;
  if (age < 0 || age >= 14) return [] as const;
  if (age < 4) return ["birth_certificate", "vaccination"] as const;
  if (age < 7) return ["birth_certificate", "vaccination", "school_attendance"] as const;
  return ["birth_certificate", "school_attendance"] as const;
}

function childDocumentLabel(kind: string, index: number) {
  const suffix = `Filho ${index + 1}`;
  if (kind === "birth_certificate") return `Certidão de nascimento - ${suffix}`;
  if (kind === "vaccination") return `Caderneta de vacinação - ${suffix}`;
  if (kind === "school_attendance") return `Comprovante de frequência escolar - ${suffix}`;
  return `Documento do filho - ${suffix}`;
}

function buildChildDocuments(children: ChildAnswer[]) {
  return children.flatMap((child, index) =>
    familyRequiredDocs(child.birthDate).map((kind, order) => ({
      id: `child_${index + 1}_${kind}`,
      label: childDocumentLabel(kind, index),
      description: "Obrigatório conforme a idade informada para salário-família.",
      required: true,
      status: "pending" as const,
      updatedAt: null,
      order: 100 + index * 10 + order,
    }))
  );
}

function canUploadDocument(document: PublicOnboardingDocument) {
  return !document.status || document.status === "pending" || document.status === "rejected";
}

function documentStatusLabel(document: PublicOnboardingDocument) {
  if (document.status === "rejected") return "Reprovado pelo RH. Envie novamente.";
  if (document.status === "approved") return "Aprovado pelo RH.";
  if (document.status === "ai_approved") return "Analisado pelo sistema. Aguardando validação do RH.";
  if (document.status === "review_required") return "Em revisão pelo RH.";
  if (document.status === "received") return "Enviado. Aguardando análise.";
  return "Pendente";
}

function documentIsSubmitted(document: PublicOnboardingDocument) {
  return Boolean(document.status && document.status !== "pending" && document.status !== "rejected");
}

function Logo({ size = 28 }: { size?: number }) {
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
      .onboarding-publico {
        --pk: #EE6FA8;
        --cr: #F4ECD8;
        --ik: #2A1F2A;
        --ik2: #5B4C5B;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .onboarding-publico .fd {
        font-family: 'Baloo 2', system-ui, sans-serif;
        font-weight: 800;
        letter-spacing: -0.025em;
      }
      .onboarding-publico .stk {
        box-shadow: 2px 2px 0 rgba(42,31,42,.12);
      }
      .onboarding-publico .fld {
        width: 100%;
        border-radius: 14px;
        border: 2px solid rgba(42,31,42,.1);
        background: var(--cr);
        padding: 12px 14px;
        font-size: 14px;
        color: var(--ik);
        outline: none;
      }
      .onboarding-publico .fld:focus {
        border-color: var(--pk);
      }
      .onboarding-publico .btn {
        border-radius: 999px;
        box-shadow: 0 4px 0 rgba(42,31,42,.15);
      }
    ` }} />
  );
}

export default function OnboardingPublicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<PublicOnboarding | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [answers, setAnswers] = useState<FormalizationAnswers>(EMPTY_ANSWERS);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/hr/onboarding/public/${token}`)
      .then(response => {
        if (!response.ok) throw new Error("not-found");
        return response.json();
      })
      .then((payload: PublicOnboarding) => {
        setData(payload);
        const saved = payload.publicFormAnswers ?? {};
        const rawChildrenCount = Number(saved.childrenCount);
        const childrenCount = Number.isFinite(rawChildrenCount)
          ? Math.max(0, Math.min(12, Math.trunc(rawChildrenCount)))
          : Array.isArray(saved.children) ? saved.children.length : 0;
        setAnswers({
          identityDocumentType: asChoice(saved.identityDocumentType, ["identity", "cnh"]),
          bankName: asString(saved.bankName),
          bankAgency: asString(saved.bankAgency),
          bankAccount: asString(saved.bankAccount),
          pixKey: asString(saved.pixKey),
          uniformShirtSize: asString(saved.uniformShirtSize),
          uniformPantsSize: asString(saved.uniformPantsSize),
          uniformShoeSize: asString(saved.uniformShoeSize),
          hasCnh: asChoice(saved.hasCnh, ["yes", "no"]),
          wantsTransportVoucher: asChoice(saved.wantsTransportVoucher, ["yes", "no"]),
          childrenCount,
          children: asChildren(saved.children, childrenCount),
          notes: asString(saved.notes),
        });
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  const visibleDocuments = useMemo(() => {
    const existingById = new Map((data?.documents ?? []).map(document => [document.id, document]));
    const dynamicDocuments = buildChildDocuments(answers.children).map(document => ({
      ...document,
      ...existingById.get(document.id),
    }));
    const baseDocuments = (data?.documents ?? []).filter(document => {
      if (document.id.startsWith("child_")) return false;
      if (document.id === "cnh") return answers.hasCnh === "yes" && answers.identityDocumentType !== "cnh";
      return true;
    });
    return [...baseDocuments, ...dynamicDocuments]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [answers.children, answers.hasCnh, answers.identityDocumentType, data?.documents]);

  const set = (field: keyof FormalizationAnswers) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setAnswers(current => ({ ...current, [field]: event.target.value }));

  function setChildrenCount(value: string) {
    const count = Math.max(0, Math.min(12, Math.trunc(Number(value) || 0)));
    setAnswers(current => ({
      ...current,
      childrenCount: count,
      children: Array.from({ length: count }, (_, index) => current.children[index] ?? { birthDate: "" }),
    }));
  }

  function setChildBirthDate(index: number, value: string) {
    setAnswers(current => ({
      ...current,
      children: current.children.map((child, childIndex) => childIndex === index ? { ...child, birthDate: value } : child),
    }));
  }

  async function uploadDocument(documentId: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("onboardingToken", token);
    fd.append("onboardingDocumentId", documentId);
    fd.append("website", "");
    const response = await fetch("/api/hr/upload", { method: "POST", body: fd });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error ?? "Falha ao enviar documento.");
    }
    const payload = await response.json();
    return {
      documentId,
      fileUrl: payload.url as string,
      filePath: typeof payload.path === "string" ? payload.path : null,
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!data) return;
    setSubmitting(true);
    setError(null);
    try {
      const uploadedEntries = await Promise.all(
        Object.entries(files)
          .filter((entry): entry is [string, File] => entry[1] instanceof File)
          .map(([documentId, file]) => uploadDocument(documentId, file))
      );
      const documents = Object.fromEntries(
        uploadedEntries.map(entry => [
          entry.documentId,
          { fileUrl: entry.fileUrl, filePath: entry.filePath },
        ])
      );

      const response = await fetch(`/api/hr/onboarding/public/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, documents, website: "" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Falha ao enviar onboarding.");
      }
      const updated = await response.json();
      setData(updated);
      setFiles({});
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="onboarding-publico flex min-h-screen items-center justify-center bg-[#F4ECD8]">
        <PageStyles />
        <Loader2 className="h-8 w-8 animate-spin text-[#EE6FA8]" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="onboarding-publico flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F4ECD8] px-5 text-center text-[#5B4C5B]">
        <PageStyles />
        <p className="text-lg font-bold">Link de onboarding não encontrado.</p>
        <Link href="/vagas" className="inline-flex items-center gap-2 text-sm font-bold text-[#EE6FA8]">
          <ArrowLeft className="h-4 w-4" /> Voltar para vagas
        </Link>
      </div>
    );
  }

  return (
    <div className="onboarding-publico min-h-screen bg-[#F4ECD8] text-[#2A1F2A]">
      <PageStyles />
      <header className="border-b border-[#2A1F2A]/10 bg-[#F4ECD8]/95">
        <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between px-5">
          <Link href="/vagas" aria-label="Coala Shakes vagas"><Logo /></Link>
          <span className="rounded-full bg-white px-4 py-2 text-xs font-bold text-[#5B4C5B] stk">Onboarding</span>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[0.85fr_1.15fr]">
        <section className="stk rounded-[30px] bg-[#2A1F2A] p-7 text-white md:p-8">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-white/40">Próximo passo</p>
          <h1 className="fd text-[36px] leading-none md:text-[48px]">Formalização</h1>
          <p className="mt-4 text-base leading-relaxed text-white/65">
            {data.candidateName ? `${data.candidateName}, ` : ""}envie os documentos e confirme os dados necessários para seguirmos com a contratação.
          </p>
          <div className="mt-8 space-y-3 rounded-[24px] bg-white/8 p-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/35">Vaga</p>
              <p className="mt-1 font-bold">{data.jobRoleName ?? "Cargo não informado"}{data.functionName ? ` | ${data.functionName}` : ""}</p>
            </div>
            {data.unitName && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-white/35">Unidade</p>
                <p className="mt-1 font-bold">{data.unitName}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/35">Documentos</p>
              <p className="mt-1 font-bold">
                {visibleDocuments.filter(document => documentIsSubmitted(document)).length}
                /{visibleDocuments.length} enviados
              </p>
            </div>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="stk rounded-[30px] bg-white p-6 md:p-8">
          {submitted && (
            <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              <CheckCircle2 className="mr-2 inline h-4 w-4" />
              Informações recebidas. O RH vai conferir os documentos.
            </div>
          )}

          <h2 className="fd mb-1 text-[28px]">Dados para cadastro</h2>
          <p className="mb-5 text-sm text-[#5B4C5B]">Os documentos serão lidos pelo sistema. Preencha apenas o que depende da sua escolha.</p>

          <div className="space-y-6">
            <section className="rounded-[22px] border border-[#2A1F2A]/10 bg-[#F4ECD8]/60 p-4">
              <h3 className="mb-3 text-sm font-extrabold">Identificação e CNH</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold">O documento de identificação anexado será</label>
                  <select value={answers.identityDocumentType} onChange={set("identityDocumentType")} className="fld">
                    <option value="">Selecione</option>
                    <option value="identity">RG / CIN</option>
                    <option value="cnh">CNH</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Você possui CNH?</label>
                  <select value={answers.hasCnh} onChange={set("hasCnh")} className="fld">
                    <option value="">Selecione</option>
                    <option value="yes">Sim</option>
                    <option value="no">Não</option>
                  </select>
                </div>
              </div>
              {answers.hasCnh === "yes" && answers.identityDocumentType !== "cnh" && (
                <p className="mt-3 rounded-2xl bg-white px-4 py-3 text-xs font-semibold text-[#5B4C5B]">
                  Como você informou que possui CNH e não usará a CNH como identificação, um anexo de CNH será solicitado abaixo.
                </p>
              )}
            </section>

            <section className="rounded-[22px] border border-[#2A1F2A]/10 bg-[#F4ECD8]/60 p-4">
              <h3 className="mb-3 text-sm font-extrabold">Banco</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Banco</label>
                  <input value={answers.bankName} onChange={set("bankName")} className="fld" placeholder="Ex.: Nubank, Caixa, Banco do Brasil" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Agência</label>
                  <input value={answers.bankAgency} onChange={set("bankAgency")} className="fld" placeholder="Ex.: 0001" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Conta</label>
                  <input value={answers.bankAccount} onChange={set("bankAccount")} className="fld" placeholder="Conta com dígito" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Chave Pix</label>
                  <input value={answers.pixKey} onChange={set("pixKey")} className="fld" placeholder="CPF, e-mail, telefone ou chave aleatória" />
                </div>
              </div>
            </section>

            <section className="rounded-[22px] border border-[#2A1F2A]/10 bg-[#F4ECD8]/60 p-4">
              <h3 className="mb-3 text-sm font-extrabold">Uniforme</h3>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Camisa</label>
                  <select value={answers.uniformShirtSize} onChange={set("uniformShirtSize")} className="fld">
                    <option value="">Selecione</option>
                    {SHIRT_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Calça</label>
                  <select value={answers.uniformPantsSize} onChange={set("uniformPantsSize")} className="fld">
                    <option value="">Selecione</option>
                    {SHIRT_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Calçado</label>
                  <select value={answers.uniformShoeSize} onChange={set("uniformShoeSize")} className="fld">
                    <option value="">Selecione</option>
                    {SHOE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                  </select>
                </div>
              </div>
            </section>

            <section className="rounded-[22px] border border-[#2A1F2A]/10 bg-[#F4ECD8]/60 p-4">
              <h3 className="mb-3 text-sm font-extrabold">Vale-transporte</h3>
              <label className="mb-1.5 block text-xs font-bold">Você quer receber vale-transporte?</label>
              <select value={answers.wantsTransportVoucher} onChange={set("wantsTransportVoucher")} className="fld">
                <option value="">Selecione</option>
                <option value="yes">Sim</option>
                <option value="no">Não</option>
              </select>
              <p className="mt-3 rounded-2xl bg-white px-4 py-3 text-xs font-semibold text-[#5B4C5B]">
                O vale-transporte considera uma passagem de ida e uma passagem de volta para cada dia trabalhado.
              </p>
            </section>

            <section className="rounded-[22px] border border-[#2A1F2A]/10 bg-[#F4ECD8]/60 p-4">
              <h3 className="mb-3 text-sm font-extrabold">Filhos</h3>
              <label className="mb-1.5 block text-xs font-bold">Quantos filhos você tem?</label>
              <input
                type="number"
                min={0}
                max={12}
                value={answers.childrenCount}
                onChange={event => setChildrenCount(event.target.value)}
                className="fld max-w-[180px]"
              />
              {answers.children.length > 0 && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {answers.children.map((child, index) => (
                    <div key={index}>
                      <label className="mb-1.5 block text-xs font-bold">Data de nascimento do filho {index + 1}</label>
                      <input
                        type="date"
                        value={child.birthDate}
                        onChange={event => setChildBirthDate(index, event.target.value)}
                        className="fld"
                      />
                      <p className="mt-1 text-[11px] font-semibold text-[#5B4C5B]">
                        {familyRequiredDocs(child.birthDate).length > 0
                          ? "A documentação exigida será listada abaixo."
                          : "Nenhuma documentação de salário-família exigida pela idade informada."}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div>
              <label className="mb-1.5 block text-xs font-bold">Observações</label>
              <textarea value={answers.notes} onChange={set("notes")} rows={3} className="fld resize-none" placeholder="Algo que o RH precise saber?" />
            </div>
          </div>

          <div className="mt-7 border-t border-[#2A1F2A]/10 pt-6">
            <h3 className="fd mb-1 text-[24px]">Documentos</h3>
            <p className="mb-3 text-sm text-[#5B4C5B]">Envie PDF, DOC, DOCX, JPG ou PNG.</p>
            <div className="mb-4 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              Confira cada arquivo antes de enviar. Depois do envio, o documento fica bloqueado e só poderá ser substituído se o RH reprovar.
            </div>
            <div className="space-y-3">
              {visibleDocuments.map(document => {
                const file = files[document.id];
                const canUpload = canUploadDocument(document);
                return (
                  <div key={document.id} className="rounded-[18px] border border-[#2A1F2A]/10 bg-[#F4ECD8] p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-bold">{document.label}{document.required ? " *" : ""}</p>
                        {document.description && (
                          <p className="mt-1 max-w-xl text-xs leading-relaxed text-[#5B4C5B]">{document.description}</p>
                        )}
                        <p className="mt-0.5 text-xs text-[#5B4C5B]">
                          {documentStatusLabel(document)}
                        </p>
                        {!canUpload && (
                          <p className="mt-1 text-[11px] font-semibold text-[#5B4C5B]">
                            Este documento já foi enviado e só poderá ser trocado se for reprovado pelo RH.
                          </p>
                        )}
                        {document.fileUrl && (
                          <a href={document.fileUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-xs font-bold text-[#EE6FA8] hover:underline">
                            Ver arquivo enviado
                          </a>
                        )}
                      </div>
                      {file ? (
                        <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-bold text-[#5B4C5B]">
                          <Paperclip className="h-3.5 w-3.5" />
                          <span className="max-w-[160px] truncate">{file.name}</span>
                          <button type="button" onClick={() => setFiles(current => ({ ...current, [document.id]: null }))}>
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : canUpload ? (
                        <label className="btn inline-flex h-10 cursor-pointer items-center gap-2 bg-white px-4 text-xs font-bold text-[#2A1F2A]">
                          <FileUp className="h-4 w-4" />
                          {document.status === "rejected" ? "Substituir" : "Anexar"}
                          <input
                            type="file"
                            accept={document.id === "profile_photo" ? ".jpg,.jpeg,.png,image/jpeg,image/png" : ".pdf,.doc,.docx,.jpg,.jpeg,.png"}
                            className="hidden"
                            onChange={event => setFiles(current => ({ ...current, [document.id]: event.target.files?.[0] ?? null }))}
                          />
                        </label>
                      ) : (
                        <span className="inline-flex h-10 items-center rounded-full bg-white px-4 text-xs font-bold text-[#5B4C5B]">
                          Enviado
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {visibleDocuments.length === 0 && (
                <div className="rounded-[18px] border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                  Todos os documentos configurados já foram recebidos ou aprovados.
                </div>
              )}
            </div>
          </div>

          {error && (
            <p className="mt-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn mt-7 inline-flex h-[52px] w-full items-center justify-center gap-2 bg-[#EE6FA8] text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? "Enviando..." : "Enviar onboarding"}
          </button>
        </form>
      </main>
    </div>
  );
}
