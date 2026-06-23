"use client";

import React, { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileUp, Loader2, Paperclip, Send, X } from "lucide-react";

type PublicOnboardingDocument = {
  id: string;
  label: string;
  required?: boolean;
  status?: "pending" | "received" | "approved" | "rejected";
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
  const [answers, setAnswers] = useState({ phone: "", birthDate: "", address: "", bankInfo: "", notes: "" });
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
        setAnswers({
          phone: typeof saved.phone === "string" ? saved.phone : "",
          birthDate: typeof saved.birthDate === "string" ? saved.birthDate : "",
          address: typeof saved.address === "string" ? saved.address : "",
          bankInfo: typeof saved.bankInfo === "string" ? saved.bankInfo : "",
          notes: typeof saved.notes === "string" ? saved.notes : "",
        });
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  const pendingDocuments = useMemo(
    () => (data?.documents ?? []).filter(document => document.status !== "approved"),
    [data?.documents]
  );

  const set = (field: keyof typeof answers) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setAnswers(current => ({ ...current, [field]: event.target.value }));

  async function uploadDocument(documentId: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("onboardingToken", token);
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
          <h1 className="fd text-[36px] leading-none md:text-[48px]">Envio de documentos</h1>
          <p className="mt-4 text-base leading-relaxed text-white/65">
            {data.candidateName ? `${data.candidateName}, ` : ""}complete os dados abaixo para seguirmos com a contratação.
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
                {(data.documents ?? []).filter(document => document.status === "approved" || document.status === "received").length}
                /{data.documents?.length ?? 0} enviados
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

          <h2 className="fd mb-1 text-[28px]">Dados complementares</h2>
          <p className="mb-5 text-sm text-[#5B4C5B]">Essas informações ajudam a preparar seu cadastro interno.</p>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-bold">Telefone / WhatsApp</label>
              <input value={answers.phone} onChange={set("phone")} className="fld" placeholder="(98) 9 0000-0000" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold">Data de nascimento</label>
              <input type="date" value={answers.birthDate} onChange={set("birthDate")} className="fld" />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-bold">Endereço</label>
              <input value={answers.address} onChange={set("address")} className="fld" placeholder="Rua, número, bairro, cidade" />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-bold">Dados bancários</label>
              <textarea value={answers.bankInfo} onChange={set("bankInfo")} rows={3} className="fld resize-none" placeholder="Banco, agência, conta ou chave Pix" />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-bold">Observações</label>
              <textarea value={answers.notes} onChange={set("notes")} rows={3} className="fld resize-none" placeholder="Algo que o RH precise saber?" />
            </div>
          </div>

          <div className="mt-7 border-t border-[#2A1F2A]/10 pt-6">
            <h3 className="fd mb-1 text-[24px]">Documentos</h3>
            <p className="mb-4 text-sm text-[#5B4C5B]">Envie PDF, DOC, DOCX, JPG ou PNG.</p>
            <div className="space-y-3">
              {pendingDocuments.map(document => {
                const file = files[document.id];
                return (
                  <div key={document.id} className="rounded-[18px] border border-[#2A1F2A]/10 bg-[#F4ECD8] p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-bold">{document.label}{document.required ? " *" : ""}</p>
                        <p className="mt-0.5 text-xs text-[#5B4C5B]">
                          {document.status === "received" ? "Recebido, aguardando conferência" : "Pendente"}
                        </p>
                      </div>
                      {file ? (
                        <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-bold text-[#5B4C5B]">
                          <Paperclip className="h-3.5 w-3.5" />
                          <span className="max-w-[160px] truncate">{file.name}</span>
                          <button type="button" onClick={() => setFiles(current => ({ ...current, [document.id]: null }))}>
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <label className="btn inline-flex h-10 cursor-pointer items-center gap-2 bg-white px-4 text-xs font-bold text-[#2A1F2A]">
                          <FileUp className="h-4 w-4" />
                          Anexar
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                            className="hidden"
                            onChange={event => setFiles(current => ({ ...current, [document.id]: event.target.files?.[0] ?? null }))}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
              {pendingDocuments.length === 0 && (
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
