"use client";

import React, { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, FileUp, Loader2, Paperclip, Send, X } from "lucide-react";
import { PjPublicOnboardingForm } from '@/features/hr/onboarding-pj/public-form';

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
  employmentRelationshipType?: 'clt' | 'pj' | 'internship' | null;
  providerCnpj?: string | null;
  providerLegalName?: string | null;
  providerTradeName?: string | null;
  employerUnitName?: string | null;
  pjWorkflow?: {
    terms?: {
      contractStartDate?: string;
      termType?: 'fixed' | 'indefinite';
      contractEndDate?: string | null;
      monthlyValue?: number;
      paymentDay?: number;
      serviceItems?: Array<{ id: string; front: string; deliverable: string; order: number }>;
    };
  } | null;
  status?: string | null;
  documents?: PublicOnboardingDocument[];
  publicFormAnswers?: Record<string, unknown>;
  publicFormSubmittedAt?: string | null;
  publicTokenExpiresAt?: string | null;
  publicTokenExtensionUsed?: boolean;
  privacyNotice?: {
    version: string;
    hash: string;
    title: string;
    summary: string;
    text: string;
    acknowledgementText: string;
    confirmationNote: string;
    allergyNoticeVersion: string;
    allergyNoticeHash: string;
    allergyNoticeTitle: string;
    allergyNoticeContext: string;
    allergyAcknowledgementText: string;
    allergyConfirmationNote: string;
  };
  imageVoiceConsentTerm?: {
    version: string;
    hash: string;
    title: string;
    explanation: string;
    checkboxText: string;
    termText: string;
  };
  publicPrivacyAcceptance?: {
    noticeVersion?: string;
    noticeHash?: string;
    acknowledged?: boolean;
    allergyNoticeVersion?: string;
    allergyNoticeHash?: string;
    allergyAcknowledged?: boolean;
    lastProtocol?: string;
  } | null;
};

type ChildAnswer = { birthDate: string; name: string; cpf: string };

type FormalizationAnswers = {
  fullName: string;
  cpf: string;
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
  hasFoodRestriction: string;
  foodRestrictions: string[];
  foodRestrictionOther: string;
  foodRestrictionActivityEffects: string[];
  hasChildren: string;
  childrenCount: number;
  children: ChildAnswer[];
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelation: string;
  educationLevel: string;
  educationCourse: string;
  educationInstitution: string;
  educationEndDate: string;
  notes: string;
};

const EMPTY_ANSWERS: FormalizationAnswers = {
  fullName: "",
  cpf: "",
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
  hasFoodRestriction: "",
  foodRestrictions: [],
  foodRestrictionOther: "",
  foodRestrictionActivityEffects: [],
  hasChildren: "",
  childrenCount: 0,
  children: [],
  emergencyName: "",
  emergencyPhone: "",
  emergencyRelation: "",
  educationLevel: "",
  educationCourse: "",
  educationInstitution: "",
  educationEndDate: "",
  notes: "",
};

const SHIRT_SIZES = ["PP", "P", "M", "G", "GG", "XG"];
const SHOE_SIZES = ["33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45"];
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_DOCUMENT_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
const FOOD_RESTRICTION_OPTIONS = ["Leite e derivados", "Trigo ou glúten", "Ovos", "Soja", "Amendoim", "Castanhas ou outras oleaginosas", "Corantes ou aromatizantes", "Outro ingrediente"];
const FOOD_RESTRICTION_ACTIVITY_EFFECTS = ["Apenas a ingestão ou degustação", "O contato ou a manipulação", "Ambos", "Preciso de avaliação pelo serviço de saúde ocupacional"];
const EMERGENCY_RELATIONS = ["Mãe/Pai", "Cônjuge", "Filho(a)", "Irmão/Irmã", "Parente", "Amigo(a)", "Outro"];
const EDUCATION_LEVELS = ["Fundamental incompleto", "Fundamental completo", "Médio incompleto", "Médio completo", "Superior incompleto", "Superior completo"];

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asChoice(value: unknown, allowed: readonly string[]) {
  const text = asString(value);
  return allowed.includes(text) ? text : "";
}

function asChoices(value: unknown, allowed: readonly string[]) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && allowed.includes(item))
    : [];
}

function formatRemainingTime(expiresAt: string | null | undefined, now: number) {
  if (!expiresAt) return "Prazo indisponível";
  const remaining = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return "Prazo encerrado";
  const totalMinutes = Math.ceil(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}min restantes`;
}

function formatCompactRemainingTime(expiresAt: string | null | undefined, now: number) {
  const label = formatRemainingTime(expiresAt, now);
  return label.replace(" restantes", "");
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function asChildren(value: unknown, count: number): ChildAnswer[] {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => {
    const entry = list[index];
    const data = entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : {};
    const birthDate = asString(data.birthDate);
    return {
      birthDate: /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? birthDate : "",
      name: asString(data.name),
      cpf: asString(data.cpf),
    };
  });
}

function formatCpf(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
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
  if (age == null) return [] as const;
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
  const [unavailableMessage, setUnavailableMessage] = useState("Link de onboarding não encontrado.");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [answers, setAnswers] = useState<FormalizationAnswers>(EMPTY_ANSWERS);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [allergyAcknowledged, setAllergyAcknowledged] = useState(false);
  // Consentimento facultativo: cada abertura da tela começa sem autorização.
  const [imageVoiceAuthorized, setImageVoiceAuthorized] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setSessionId(window.crypto.randomUUID());
  }, []);

  useEffect(() => {
    fetch(`/api/hr/onboarding/public/${token}`)
      .then(async response => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Link de onboarding não encontrado.");
        return payload;
      })
      .then((payload: PublicOnboarding) => {
        setData(payload);
        const saved = payload.publicFormAnswers ?? {};
        const rawChildrenCount = Number(saved.childrenCount);
        const childrenCount = Number.isFinite(rawChildrenCount)
          ? Math.max(0, Math.min(12, Math.trunc(rawChildrenCount)))
          : Array.isArray(saved.children) ? saved.children.length : 0;
        const hasChildren = asChoice(saved.hasChildren, ["yes", "no"]) || (childrenCount > 0 ? "yes" : "");
        setAnswers({
          fullName: asString(saved.fullName) || asString(payload.candidateName),
          cpf: formatCpf(asString(saved.cpf)),
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
          hasFoodRestriction: asChoice(saved.hasFoodRestriction, ["yes", "no"]),
          foodRestrictions: asChoices(saved.foodRestrictions, FOOD_RESTRICTION_OPTIONS),
          foodRestrictionOther: asString(saved.foodRestrictionOther),
          foodRestrictionActivityEffects: asChoices(saved.foodRestrictionActivityEffects, FOOD_RESTRICTION_ACTIVITY_EFFECTS),
          hasChildren,
          childrenCount,
          children: asChildren(saved.children, childrenCount),
          emergencyName: asString(saved.emergencyName),
          emergencyPhone: formatPhone(asString(saved.emergencyPhone)),
          emergencyRelation: asChoice(saved.emergencyRelation, EMERGENCY_RELATIONS),
          educationLevel: asChoice(saved.educationLevel, EDUCATION_LEVELS),
          educationCourse: asString(saved.educationCourse),
          educationInstitution: asString(saved.educationInstitution),
          educationEndDate: asString(saved.educationEndDate),
          notes: asString(saved.notes),
        });
        const currentAcceptance = payload.publicPrivacyAcceptance;
        const acceptanceMatchesNotice = Boolean(
          currentAcceptance?.noticeVersion &&
          currentAcceptance.noticeVersion === payload.privacyNotice?.version &&
          currentAcceptance.noticeHash === payload.privacyNotice?.hash
        );
        setPrivacyAcknowledged(acceptanceMatchesNotice && currentAcceptance?.acknowledged === true);
        const allergyAcceptanceMatches = Boolean(
          acceptanceMatchesNotice &&
          currentAcceptance?.allergyNoticeVersion === payload.privacyNotice?.allergyNoticeVersion &&
          currentAcceptance?.allergyNoticeHash === payload.privacyNotice?.allergyNoticeHash
        );
        setAllergyAcknowledged(allergyAcceptanceMatches && currentAcceptance?.allergyAcknowledged === true);
      })
      .catch(error => {
        setUnavailableMessage(error instanceof Error ? error.message : "Link de onboarding não encontrado.");
        setNotFound(true);
      })
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
      if (document.id === "cnh") return false;
      return true;
    });
    return [...baseDocuments, ...dynamicDocuments]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [answers.children, answers.hasCnh, answers.identityDocumentType, data?.documents]);
  const linkExpired = Boolean(data?.publicTokenExpiresAt && new Date(data.publicTokenExpiresAt).getTime() <= clockNow);
  const set = (field: keyof FormalizationAnswers) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setAnswers(current => ({ ...current, [field]: event.target.value }));

  function setChildrenCount(value: string) {
    const count = Math.max(0, Math.min(12, Math.trunc(Number(value) || 0)));
    setAnswers(current => ({
      ...current,
      childrenCount: count,
      children: Array.from({ length: count }, (_, index) => current.children[index] ?? { birthDate: "", name: "", cpf: "" }),
    }));
  }

  function setHasChildren(value: string) {
    setAnswers(current => ({
      ...current,
      hasChildren: value,
      childrenCount: value === "no" ? 0 : current.childrenCount,
      children: value === "no" ? [] : current.children,
    }));
  }

  function setEducationLevel(value: string) {
    const isHigherEducation = value === "Superior incompleto" || value === "Superior completo";
    setAnswers(current => ({
      ...current,
      educationLevel: value,
      educationCourse: isHigherEducation ? current.educationCourse : "",
    }));
  }

  function setChildField(index: number, field: keyof ChildAnswer, value: string) {
    setAnswers(current => ({
      ...current,
      children: current.children.map((child, childIndex) => childIndex === index ? { ...child, [field]: value } : child),
    }));
  }

  function toggleFoodRestriction(option: string) {
    setAnswers(current => ({
      ...current,
      foodRestrictions: current.foodRestrictions.includes(option)
        ? current.foodRestrictions.filter(item => item !== option)
        : [...current.foodRestrictions, option],
    }));
  }

  function toggleFoodRestrictionEffect(option: string) {
    setAnswers(current => ({
      ...current,
      foodRestrictionActivityEffects: current.foodRestrictionActivityEffects.includes(option)
        ? current.foodRestrictionActivityEffects.filter(item => item !== option)
        : [...current.foodRestrictionActivityEffects, option],
    }));
  }

  function selectDocumentFile(documentId: string, file: File | null) {
    if (!file) return;
    if (!ALLOWED_DOCUMENT_MIME.has(file.type)) {
      setError("Formato não aceito. Envie somente PDF, JPG ou PNG.");
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError("O arquivo ultrapassa o limite de 10 MB.");
      return;
    }
    setError(null);
    setFiles(current => ({ ...current, [documentId]: file }));
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
      sha256: typeof payload.sha256 === "string" ? payload.sha256 : null,
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!data) return;
    setError(null);
    setSubmitted(false);
    if (!data.privacyNotice || !privacyAcknowledged) {
      setError("Leia e confirme o Aviso de Privacidade para enviar o onboarding.");
      return;
    }
    if (!allergyAcknowledged) {
      setError("Confirme a ciência sobre o tratamento de informações de alergias e restrições alimentares.");
      return;
    }
    setSubmitting(true);
    try {
      const uploadedEntries = await Promise.all(
        Object.entries(files)
          .filter((entry): entry is [string, File] => entry[1] instanceof File)
          .map(([documentId, file]) => uploadDocument(documentId, file))
      );
      const documents = Object.fromEntries(
        uploadedEntries.map(entry => [
          entry.documentId,
          { fileUrl: entry.fileUrl, filePath: entry.filePath, sha256: entry.sha256 },
        ])
      );

      const response = await fetch(`/api/hr/onboarding/public/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          documents,
          privacyAcceptance: {
            noticeVersion: data.privacyNotice.version,
            noticeHash: data.privacyNotice.hash,
            acknowledged: privacyAcknowledged,
            allergyAcknowledged,
            allergyNoticeVersion: data.privacyNotice.allergyNoticeVersion,
            allergyNoticeHash: data.privacyNotice.allergyNoticeHash,
          },
          imageVoiceConsent: {
            authorized: imageVoiceAuthorized,
            termVersion: data.imageVoiceConsentTerm?.version,
            termHash: data.imageVoiceConsentTerm?.hash,
          },
          sessionId,
          website: "",
        }),
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
        <p className="text-lg font-bold">{unavailableMessage}</p>
        <Link href="/vagas" className="inline-flex items-center gap-2 text-sm font-bold text-[#EE6FA8]">
          <ArrowLeft className="h-4 w-4" /> Voltar para vagas
        </Link>
      </div>
    );
  }

  if (data.employmentRelationshipType === 'pj') {
    return <PjPublicOnboardingForm token={token} data={data} expired={linkExpired} onUpdated={updated => setData(updated as PublicOnboarding)} />;
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

      <div
        className={`fixed right-0 top-[22%] z-40 flex -translate-y-1/2 items-center gap-1.5 rounded-l-full border border-r-0 px-2.5 py-2 shadow-sm backdrop-blur-md transition-[opacity,transform] hover:opacity-100 focus-within:opacity-100 ${
          linkExpired
            ? "border-red-200 bg-red-50/95 text-red-800 opacity-100"
            : "border-[#2A1F2A]/10 bg-white/90 text-[#2A1F2A] opacity-75"
        }`}
        role="status"
        aria-live="polite"
        title="Prazo restante do link"
      >
        <Clock3 className="h-3.5 w-3.5 shrink-0 text-[#EE6FA8]" />
        <strong className="whitespace-nowrap text-[11px]">{formatCompactRemainingTime(data.publicTokenExpiresAt, clockNow)}</strong>
      </div>

      <main className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[0.85fr_1.15fr]">
        <section className="stk rounded-[30px] bg-[#2A1F2A] p-7 text-white md:p-8">
          <div className="px-5">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-white/40">Próximo passo</p>
            <h1 className="fd text-[36px] leading-none md:text-[44px]">Formalização</h1>
            <p className="mt-4 text-base leading-relaxed text-white/65">
              {data.candidateName ? `${data.candidateName}, ` : ""}envie os documentos e confirme os dados necessários para seguirmos com a contratação.
            </p>
            <div className="mt-8 space-y-3 text-left">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-white/35">Vaga</p>
                <p className="mt-1 font-bold leading-snug">
                  {data.jobRoleName ?? "Cargo não informado"}
                  {data.functionName ? <span className="block text-white/75">{data.functionName}</span> : null}
                </p>
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
          </div>

          <div className="mt-4 rounded-[24px] border border-white/10 bg-white/[0.06] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-white/40">Como funciona o envio</p>
              <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-extrabold text-white">
                {formatRemainingTime(data.publicTokenExpiresAt, clockNow)}
              </span>
            </div>
            <ol className="mt-3 space-y-3 text-sm leading-relaxed text-white/70">
              <li className="flex gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-black text-white">1</span>
                <span><strong className="text-white">Anexar</strong> apenas seleciona o arquivo. Antes de concluir, você ainda pode removê-lo ou trocá-lo.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-black text-white">2</span>
                <span>Ao clicar em <strong className="text-white">Enviar onboarding</strong>, os dados e arquivos são enviados ao RH. Os documentos ficam imediatamente bloqueados e não podem ser trocados até a análise do RH.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-black text-white">3</span>
                <span>O link é válido por <strong className="text-white">72 horas</strong>. Enquanto houver prazo, os dados textuais podem ser corrigidos e enviados novamente. Prazo atual: <strong className="text-white">{formatRemainingTime(data.publicTokenExpiresAt, clockNow)}</strong>.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-black text-white">4</span>
                <span>O RH analisará os documentos. Se algum for reprovado, somente esse arquivo será liberado para substituição.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-black text-white">5</span>
                <span>O RH pode conceder <strong className="text-white">uma única prorrogação de 24 horas</strong>. A prorrogação mantém os dados e arquivos já enviados e não desbloqueia documentos. Depois do prazo, o formulário fica indisponível.</span>
              </li>
            </ol>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="stk rounded-[30px] bg-white p-6 md:p-8">
          {submitted && (
            <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              <CheckCircle2 className="mr-2 inline h-4 w-4" />
              Informações recebidas. O RH vai conferir os documentos.
              {data.publicPrivacyAcceptance?.lastProtocol ? (
                <span className="ml-1 whitespace-nowrap">Protocolo: {data.publicPrivacyAcceptance.lastProtocol}.</span>
              ) : null}
            </div>
          )}

          <h2 className="fd mb-1 text-[28px]">Dados para cadastro</h2>
          <p className="mb-5 text-sm text-[#5B4C5B]">Os documentos serão lidos pelo sistema. Preencha apenas o que depende da sua escolha.</p>

          <div className="space-y-6">
            <section className="rounded-[22px] border border-[#2A1F2A]/10 bg-[#F4ECD8]/60 p-4">
              <h3 className="mb-3 text-sm font-extrabold">Identificação</h3>
              <div className="mb-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Nome completo</label>
                  <input
                    value={answers.fullName}
                    onChange={set("fullName")}
                    className="fld"
                    placeholder="Nome completo"
                    autoComplete="name"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold">CPF</label>
                  <input
                    value={answers.cpf}
                    onChange={event => setAnswers(current => ({ ...current, cpf: formatCpf(event.target.value) }))}
                    className="fld"
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={14}
                    pattern="\d{3}\.\d{3}\.\d{3}-\d{2}"
                    title="Informe os 11 dígitos do CPF"
                    required
                  />
                </div>
              </div>
              <div>
                  <label className="mb-1.5 block text-xs font-bold">Você possui CNH?</label>
                  <select
                    value={answers.hasCnh}
                    onChange={event => {
                      const hasCnh = event.target.value;
                      setAnswers(current => ({
                        ...current,
                        hasCnh,
                        identityDocumentType: hasCnh === "yes" ? "cnh" : hasCnh === "no" ? "identity" : "",
                      }));
                    }}
                    className="fld"
                  >
                    <option value="">Selecione</option>
                    <option value="yes">Sim</option>
                    <option value="no">Não</option>
                  </select>
              </div>
              {answers.hasCnh === "yes" && (
                <p className="mt-3 rounded-2xl border border-[#EE6FA8]/20 bg-white px-4 py-3 text-xs font-semibold leading-relaxed text-[#5B4C5B]">
                  Anexe sua CNH no campo <strong className="text-[#2A1F2A]">Documento de identidade ou CNH</strong>, na seção de documentos pessoais abaixo.
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
              <h3 className="mb-1 text-sm font-extrabold">Saúde e segurança</h3>
              <h4 className="mt-3 text-xs font-extrabold">{data.privacyNotice?.allergyNoticeTitle}</h4>
              <p className="mt-2 text-justify text-xs leading-relaxed text-[#5B4C5B]">
                {data.privacyNotice?.allergyNoticeContext}
              </p>
              <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#2A1F2A]/10 bg-white px-4 py-3 text-xs font-semibold leading-relaxed">
                <input
                  type="checkbox"
                  checked={allergyAcknowledged}
                  onChange={event => setAllergyAcknowledged(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#EE6FA8]"
                />
                <span>{data.privacyNotice?.allergyAcknowledgementText}</span>
              </label>
              <p className="mb-4 mt-3 text-justify text-[11px] font-semibold leading-relaxed text-[#5B4C5B]">
                {data.privacyNotice?.allergyConfirmationNote}
              </p>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Existe alguma restrição relacionada ao contato, à manipulação ou à eventual degustação dos ingredientes utilizados na atividade?</label>
                  <select value={answers.hasFoodRestriction} onChange={set("hasFoodRestriction")} className="fld">
                    <option value="">Selecione</option>
                    <option value="no">Não</option>
                    <option value="yes">Sim</option>
                  </select>
                </div>
                {answers.hasFoodRestriction === "yes" ? (
                  <div className="space-y-3 rounded-2xl border border-[#2A1F2A]/10 bg-white/55 p-3">
                    <p className="text-xs font-bold">A restrição está relacionada a:</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {FOOD_RESTRICTION_OPTIONS.map(option => (
                        <label key={option} className="flex items-center gap-2 rounded-xl border border-[#2A1F2A]/10 bg-white px-3 py-2 text-xs font-semibold">
                          <input type="checkbox" checked={answers.foodRestrictions.includes(option)} onChange={() => toggleFoodRestriction(option)} />
                          {option}
                        </label>
                      ))}
                    </div>
                    {answers.foodRestrictions.includes("Outro ingrediente") ? (
                      <div>
                        <label className="mb-1.5 block text-xs font-bold">Outro ingrediente</label>
                        <input value={answers.foodRestrictionOther} onChange={set("foodRestrictionOther")} className="fld" maxLength={160} />
                      </div>
                    ) : null}
                    <p className="pt-1 text-xs font-bold">A restrição afeta:</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {FOOD_RESTRICTION_ACTIVITY_EFFECTS.map(option => (
                        <label key={option} className="flex items-center gap-2 rounded-xl border border-[#2A1F2A]/10 bg-white px-3 py-2 text-xs font-semibold">
                          <input type="checkbox" checked={answers.foodRestrictionActivityEffects.includes(option)} onChange={() => toggleFoodRestrictionEffect(option)} />
                          {option}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-[22px] border border-[#2A1F2A]/10 bg-[#F4ECD8]/60 p-4">
              <h3 className="mb-3 text-sm font-extrabold">Filhos</h3>
              <label className="mb-1.5 block text-xs font-bold">Você possui filhos?</label>
              <select value={answers.hasChildren} onChange={event => setHasChildren(event.target.value)} className="fld max-w-[280px]" required>
                <option value="">Selecione</option>
                <option value="no">Não</option>
                <option value="yes">Sim</option>
              </select>
              {answers.hasChildren === "yes" ? (
                <div className="mt-4 max-w-[280px]">
                  <label className="mb-1.5 block text-xs font-bold">Quantos filhos você tem?</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={answers.childrenCount || ""}
                    onChange={event => setChildrenCount(event.target.value)}
                    className="fld"
                    required
                  />
                </div>
              ) : null}
              {answers.hasChildren === "yes" && answers.children.length > 0 && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {answers.children.map((child, index) => (
                    <div key={index} className="rounded-2xl border border-[#2A1F2A]/10 bg-white/55 p-3 md:col-span-2">
                      <label className="mb-1.5 block text-xs font-bold">Data de nascimento do filho {index + 1}</label>
                      <input
                        type="date"
                        value={child.birthDate}
                        onChange={event => setChildField(index, "birthDate", event.target.value)}
                        className="fld md:max-w-[280px]"
                      />
                      {child.birthDate ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div>
                            <label className="mb-1.5 block text-xs font-bold">Nome completo do filho {index + 1}</label>
                            <input
                              value={child.name}
                              onChange={event => setChildField(index, "name", event.target.value)}
                              className="fld"
                              placeholder="Nome completo"
                              required
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-xs font-bold">CPF do filho {index + 1}</label>
                            <input
                              value={child.cpf}
                              onChange={event => setChildField(index, "cpf", formatCpf(event.target.value))}
                              className="fld"
                              placeholder="000.000.000-00"
                              inputMode="numeric"
                              maxLength={14}
                              required
                            />
                          </div>
                          <p className="text-[11px] font-semibold text-[#5B4C5B] md:col-span-2">
                            {familyRequiredDocs(child.birthDate).length > 0
                              ? "A documentação exigida será listada no bloco de salário-família abaixo."
                              : "Nenhuma documentação de salário-família exigida pela idade informada."}
                          </p>
                        </div>
                      ) : (
                        <p className="mt-1 text-[11px] font-semibold text-[#5B4C5B]">
                          Informe a data para calcular a idade e definir os documentos necessários.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-[22px] border border-[#2A1F2A]/10 bg-[#F4ECD8]/60 p-4">
              <h3 className="mb-3 text-sm font-extrabold">Contato de emergência</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Nome completo</label>
                  <input value={answers.emergencyName} onChange={set("emergencyName")} className="fld" autoComplete="name" required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Celular com DDD</label>
                  <input
                    value={answers.emergencyPhone}
                    onChange={event => setAnswers(current => ({ ...current, emergencyPhone: formatPhone(event.target.value) }))}
                    className="fld"
                    placeholder="(98) 99999-9999"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={15}
                    required
                  />
                </div>
                <div className="md:col-span-2 md:max-w-[50%] md:pr-2">
                  <label className="mb-1.5 block text-xs font-bold">Grau de parentesco</label>
                  <select value={answers.emergencyRelation} onChange={set("emergencyRelation")} className="fld" required>
                    <option value="">Selecione</option>
                    {EMERGENCY_RELATIONS.map(relation => <option key={relation} value={relation}>{relation}</option>)}
                  </select>
                </div>
              </div>
            </section>

            <section className="rounded-[22px] border border-[#2A1F2A]/10 bg-[#F4ECD8]/60 p-4">
              <h3 className="mb-3 text-sm font-extrabold">Formação acadêmica</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Grau de instrução</label>
                  <select value={answers.educationLevel} onChange={event => setEducationLevel(event.target.value)} className="fld">
                    <option value="">Selecione</option>
                    {EDUCATION_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
                  </select>
                </div>
                {(answers.educationLevel === "Superior incompleto" || answers.educationLevel === "Superior completo") ? (
                  <div>
                    <label className="mb-1.5 block text-xs font-bold">Curso</label>
                    <input value={answers.educationCourse} onChange={set("educationCourse")} className="fld" required />
                  </div>
                ) : null}
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Instituição</label>
                  <input value={answers.educationInstitution} onChange={set("educationInstitution")} className="fld" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold">Data de conclusão</label>
                  <input type="date" value={answers.educationEndDate} onChange={set("educationEndDate")} className="fld" />
                </div>
              </div>
            </section>

            <div>
              <label className="mb-1.5 block text-xs font-bold">Observações</label>
              <textarea value={answers.notes} onChange={set("notes")} rows={3} className="fld resize-none" placeholder="Algo que o RH precise saber?" />
            </div>
          </div>

          <div className="mt-7 border-t border-[#2A1F2A]/10 pt-6">
            <h3 className="fd mb-1 text-[24px]">Documentos</h3>
            <p className="mb-3 text-sm text-[#5B4C5B]">Envie somente PDF, JPG ou PNG, com até 10 MB por arquivo.</p>
            <div className="mb-4 grid gap-2 rounded-[18px] border border-[#2A1F2A]/10 bg-[#F4ECD8]/45 px-4 py-3 text-xs font-semibold text-[#5B4C5B] sm:grid-cols-2">
              <span>• Imagem colorida, nítida e sem reflexos.</span>
              <span>• Documento inteiro e sem cortes.</span>
              <span>• Frente e verso, quando aplicável.</span>
              <span>• PDF sem senha ou proteção.</span>
              <span className="sm:col-span-2">• Arquivos compactados ou editáveis não são aceitos.</span>
            </div>
            <div className="mb-4 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              Confira cada arquivo antes de concluir. Enquanto estiver apenas anexado, você pode removê-lo ou trocá-lo. Depois de clicar em “Enviar onboarding”, o documento fica bloqueado e só poderá ser substituído se o RH reprovar.
            </div>
            <div className="space-y-5">
              <section>
                <div className="mb-2">
                  <h4 className="text-sm font-extrabold">Documentos pessoais</h4>
                  <p className="text-xs text-[#5B4C5B]">Identificação, registros funcionais, endereço e demais documentos do candidato.</p>
                </div>
                <div className="space-y-3">
              {visibleDocuments.filter(document => !document.id.startsWith("child_")).map(document => {
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
                            accept={document.id === "profile_photo" ? ".jpg,.jpeg,.png,image/jpeg,image/png" : ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"}
                            className="hidden"
                            onChange={event => selectDocumentFile(document.id, event.target.files?.[0] ?? null)}
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
                </div>
              </section>

              {answers.children.some(child => Boolean(child.birthDate)) ? (
                <section className="space-y-3 border-t border-[#2A1F2A]/10 pt-5">
                  <div>
                    <h4 className="text-sm font-extrabold">Salário-família</h4>
                    <p className="text-xs text-[#5B4C5B]">Documentos exigidos conforme a idade informada de cada filho.</p>
                  </div>
                  {answers.children.map((child, index) => {
                    if (!child.birthDate) return null;
                    const childDocuments = visibleDocuments.filter(document => document.id.startsWith(`child_${index + 1}_`));
                    return (
                      <div key={index} className="rounded-[20px] border border-[#2A1F2A]/10 bg-[#F4ECD8]/45 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-extrabold">{child.name || `Filho ${index + 1}`}</p>
                            <p className="text-[11px] font-semibold text-[#5B4C5B]">Filho {index + 1} · nascimento {new Date(`${child.birthDate}T12:00:00`).toLocaleDateString("pt-BR")}</p>
                          </div>
                          {child.cpf ? <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#5B4C5B]">CPF {child.cpf}</span> : null}
                        </div>
                        {childDocuments.length > 0 ? (
                          <div className="space-y-3">
                            {childDocuments.map(document => {
                              const file = files[document.id];
                              const canUpload = canUploadDocument(document);
                              return (
                                <div key={document.id} className="rounded-[18px] border border-[#2A1F2A]/10 bg-[#F4ECD8] p-4">
                                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                      <p className="font-bold">{document.label}{document.required ? " *" : ""}</p>
                                      {document.description ? <p className="mt-1 max-w-xl text-xs leading-relaxed text-[#5B4C5B]">{document.description}</p> : null}
                                      <p className="mt-0.5 text-xs text-[#5B4C5B]">{documentStatusLabel(document)}</p>
                                      {document.fileUrl ? <a href={document.fileUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-xs font-bold text-[#EE6FA8] hover:underline">Ver arquivo enviado</a> : null}
                                    </div>
                                    {file ? (
                                      <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-bold text-[#5B4C5B]">
                                        <Paperclip className="h-3.5 w-3.5" /><span className="max-w-[160px] truncate">{file.name}</span>
                                        <button type="button" onClick={() => setFiles(current => ({ ...current, [document.id]: null }))}><X className="h-3.5 w-3.5" /></button>
                                      </div>
                                    ) : canUpload ? (
                                      <label className="btn inline-flex h-10 cursor-pointer items-center gap-2 bg-white px-4 text-xs font-bold text-[#2A1F2A]">
                                        <FileUp className="h-4 w-4" />{document.status === "rejected" ? "Substituir" : "Anexar"}
                                        <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="hidden" onChange={event => selectDocumentFile(document.id, event.target.files?.[0] ?? null)} />
                                      </label>
                                    ) : <span className="inline-flex h-10 items-center rounded-full bg-white px-4 text-xs font-bold text-[#5B4C5B]">Enviado</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[#5B4C5B]">Nenhum documento exigido para a idade informada.</p>
                        )}
                      </div>
                    );
                  })}
                </section>
              ) : null}

              {visibleDocuments.length === 0 && (
                <div className="rounded-[18px] border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                  Todos os documentos configurados já foram recebidos ou aprovados.
                </div>
              )}
            </div>
          </div>

          {data.privacyNotice ? (
            <section className="mt-7 rounded-[22px] border border-[#2A1F2A]/10 bg-[#F4ECD8]/45 p-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#5B4C5B]">Privacidade e proteção de dados</p>
                <h3 className="mt-1 text-sm font-extrabold">{data.privacyNotice.title}</h3>
              </div>
              <div className="mt-3 whitespace-pre-line text-xs leading-relaxed text-[#5B4C5B]">
                {data.privacyNotice.summary}
              </div>
              <details className="mt-3 rounded-2xl border border-[#2A1F2A]/10 bg-white/70 px-4 py-3">
                <summary className="cursor-pointer text-xs font-extrabold">Ler o Aviso de Privacidade completo</summary>
                <div className="mt-3 max-h-[55vh] space-y-3 overflow-y-auto whitespace-pre-line pr-2 text-xs leading-relaxed text-[#5B4C5B]">
                  {data.privacyNotice.text}
                </div>
              </details>
              <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#2A1F2A]/10 bg-white px-4 py-3 text-xs font-semibold leading-relaxed">
                <input
                  type="checkbox"
                  checked={privacyAcknowledged}
                  onChange={event => setPrivacyAcknowledged(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#EE6FA8]"
                />
                <span>{data.privacyNotice.acknowledgementText}</span>
              </label>
              <p className="mt-3 text-[11px] font-semibold leading-relaxed text-[#5B4C5B]">
                {data.privacyNotice.confirmationNote}
              </p>

            </section>
          ) : null}

          {data.imageVoiceConsentTerm ? (
            <section
              aria-label="Tela de consentimento opcional para uso de imagem e voz"
              className="mt-7 rounded-[22px] border-2 border-[#EE6FA8]/25 bg-[#EE6FA8]/[0.06] p-5"
            >
              <p className="text-xs font-bold uppercase tracking-wider text-[#EE6FA8]">Tela opcional</p>
              <h3 className="mt-1 text-base font-extrabold">{data.imageVoiceConsentTerm.title}</h3>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-[#5B4C5B]">
                {data.imageVoiceConsentTerm.explanation}
              </p>
              <details className="mt-4 rounded-2xl border border-[#2A1F2A]/10 bg-white/80 px-4 py-3">
                <summary className="cursor-pointer text-xs font-extrabold">
                  Ler o Termo de Consentimento para Uso de Imagem e Voz
                </summary>
                <div className="mt-3 max-h-[40vh] overflow-y-auto whitespace-pre-line pr-2 text-xs leading-relaxed text-[#5B4C5B]">
                  {data.imageVoiceConsentTerm.termText}
                </div>
              </details>
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#2A1F2A]/10 bg-white px-4 py-4 text-sm font-semibold leading-relaxed">
                <input
                  type="checkbox"
                  checked={imageVoiceAuthorized}
                  onChange={event => setImageVoiceAuthorized(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#EE6FA8]"
                />
                <span>{data.imageVoiceConsentTerm.checkboxText}</span>
              </label>
              <p className="mt-3 text-[11px] font-semibold leading-relaxed text-[#5B4C5B]">
                Você pode enviar o onboarding normalmente com esta opção marcada ou desmarcada.
              </p>
            </section>
          ) : null}

          {error && (
            <p className="mt-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </p>
          )}

          {submitted && (
            <div
              role="status"
              aria-live="polite"
              className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
            >
              <CheckCircle2 className="mr-2 inline h-4 w-4" />
              Onboarding enviado com sucesso. Sua resposta foi registrada.
              {data.publicPrivacyAcceptance?.lastProtocol ? (
                <span className="ml-1 whitespace-nowrap">Protocolo: {data.publicPrivacyAcceptance.lastProtocol}.</span>
              ) : null}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || linkExpired || !privacyAcknowledged || !allergyAcknowledged}
            className="btn mt-7 inline-flex h-[52px] w-full items-center justify-center gap-2 bg-[#EE6FA8] text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting
              ? "Enviando..."
              : linkExpired
                ? "Prazo encerrado"
                : submitted
                  ? "Enviar novamente"
                  : "Enviar onboarding"}
          </button>
        </form>
      </main>
    </div>
  );
}
