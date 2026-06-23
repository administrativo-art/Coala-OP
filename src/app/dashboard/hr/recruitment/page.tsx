"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '@/hooks/use-auth';
import { fetchHrBootstrap } from '@/features/hr/lib/client';
import type {
  Candidate,
  CandidateDecisionAction,
  CandidateStageHistoryEntry,
  CandidateStatus,
  DPShiftDefinition,
  DPUnit,
  HrFormQuestion,
  JobFunction,
  JobRole,
  JobOpening,
  JobOpeningStatus,
  OnboardingDocument,
  OnboardingProcess,
  RecruitmentFormConfig,
  RecruitmentStage,
} from '@/types';
import { DEFAULT_TALENT_POOL_FORM, mergeRecruitmentQuestionModels } from '@/lib/recruitment-forms';
import {
  createCandidateStageHistoryEntry,
  mergeRecruitmentStageModels,
  normalizeRecruitmentStages,
  RECRUITMENT_PIPELINE_STATUSES,
} from '@/lib/recruitment-pipeline';
import {
  UserPlus, Search, Filter, MoreHorizontal, Mail, Phone,
  FileText, Calendar, Star, Clock, CheckCircle2, XCircle,
  ArrowRight, Kanban, List, Loader2, X, Trash2, AlertTriangle,
  Briefcase, ChevronDown, ChevronRight, ExternalLink, Paperclip,
  Globe, PauseCircle, Archive, Plus, Pencil, SlidersHorizontal,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<CandidateStatus, { label: string; color: string; icon: React.ElementType }> = {
  applied:        { label: 'Inscrito',      color: 'bg-blue-500',   icon: Clock },
  screening:      { label: 'Triagem',       color: 'bg-indigo-500', icon: Filter },
  interview:      { label: 'Entrevista',    color: 'bg-purple-500', icon: Calendar },
  technical_test: { label: 'Avaliação Prática', color: 'bg-pink-500',   icon: FileText },
  offer:          { label: 'Proposta',      color: 'bg-yellow-500', icon: Star },
  hired:          { label: 'Contratado',    color: 'bg-green-500',  icon: CheckCircle2 },
  rejected:       { label: 'Reprovado',     color: 'bg-red-500',    icon: XCircle },
  withdrawn:      { label: 'Desistência',   color: 'bg-slate-500',  icon: ArrowRight },
  talent_pool:    { label: 'Banco de talentos', color: 'bg-cyan-500', icon: Star },
};

const PIPELINE_STATUSES: CandidateStatus[] = [...RECRUITMENT_PIPELINE_STATUSES];
const ARCHIVED_STATUSES: CandidateStatus[] = ['rejected', 'withdrawn'];
const TALENT_POOL_STATUS: CandidateStatus = 'talent_pool';
const ALL_STATUSES = Object.keys(STATUS_CONFIG) as CandidateStatus[];

const DECISION_ACTION_LABELS: Record<CandidateDecisionAction, string> = {
  created: 'Criado',
  advanced: 'Avançou',
  status_changed: 'Status alterado',
  hired: 'Contratação',
  rejected: 'Reprovação',
  withdrawn: 'Desistência',
  talent_pool: 'Banco de talentos',
};

const OPENING_STATUS_CONFIG: Record<JobOpeningStatus, { label: string; color: string; icon: React.ElementType }> = {
  open:   { label: 'Aberta',   color: 'text-green-400 bg-green-500/10 border-green-500/20',  icon: Globe },
  paused: { label: 'Pausada',  color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20', icon: PauseCircle },
  closed: { label: 'Encerrada',color: 'text-slate-400 bg-slate-500/10 border-slate-500/20',  icon: Archive },
};

const SOURCE_OPTIONS = ['LinkedIn', 'Indicação', 'Site', 'Indeed', 'Catho', 'Espontâneo', 'Outro'];
const PUBLIC_RECRUITMENT_URL = 'https://vagas.coalashakes.com';
const WORK_TYPE_OPTIONS = [
  { value: 'presencial', label: 'Presencial' },
  { value: 'remoto',     label: 'Remoto' },
  { value: 'hibrido',    label: 'Híbrido' },
];

const QUESTION_TYPES: Array<{ value: HrFormQuestion['type']; label: string }> = [
  { value: 'text', label: 'Texto' },
  { value: 'yes_no', label: 'Sim/Não' },
  { value: 'select', label: 'Seleção única' },
  { value: 'multi_select', label: 'Múltipla escolha' },
  { value: 'date', label: 'Data' },
  { value: 'number_range', label: 'Número' },
];

const EMPTY_QUESTION_DRAFT = {
  text: '',
  type: 'text' as HrFormQuestion['type'],
  optionsText: '',
  required: false,
  eliminatory: false,
};

const MS_DAY = 86_400_000;

function dateInputToIso(value: string, endOfDay = false) {
  if (!value) return null;
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).toISOString();
}

function safeDateTime(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function getCandidateStageStartedAt(candidate: Candidate, status = candidate.status) {
  const history = [
    ...(candidate.latestApplication?.stageHistory ?? []),
    ...(candidate.recruitmentHistory ?? []),
  ]
    .filter((entry): entry is CandidateStageHistoryEntry => !!entry?.createdAt && entry.toStatus === status)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return safeDateTime(history[0]?.createdAt) ?? safeDateTime(candidate.appliedAt) ?? safeDateTime(candidate.updatedAt) ?? Date.now();
}

function getCandidateStageTiming(candidate: Candidate, stage?: RecruitmentStage, now = Date.now()) {
  if (!stage || stage.dueDays === null || stage.dueDays === undefined) {
    return { daysInStage: 0, daysLeft: null as number | null, overdueDays: 0, isOverdue: false };
  }

  const startedAt = getCandidateStageStartedAt(candidate, stage.id);
  const daysInStage = Math.max(0, Math.floor((now - startedAt) / MS_DAY));
  const deadline = startedAt + stage.dueDays * MS_DAY;
  const rawDaysLeft = Math.ceil((deadline - now) / MS_DAY);
  const overdueDays = rawDaysLeft < 0 ? Math.abs(rawDaysLeft) : 0;

  return {
    daysInStage,
    daysLeft: rawDaysLeft,
    overdueDays,
    isOverdue: rawDaysLeft < 0,
  };
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(path: string, getToken: () => Promise<string>, init?: RequestInit) {
  const token = await getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

type ResumeUpload = {
  url: string;
  path?: string;
};

type CandidateProfileApplication = {
  id: string;
  jobOpeningId?: string | null;
  jobRoleName?: string | null;
  functionName?: string | null;
  unitName?: string | null;
  stage?: CandidateStatus;
  status?: string | null;
  source?: string | null;
  notes?: string | null;
  appliedAt?: string | null;
  updatedAt?: string | null;
  formAnswers?: Record<string, unknown>;
  formQuestionSnapshot?: HrFormQuestion[];
};

type CandidateProfilePayload = {
  candidate: Candidate;
  applications: CandidateProfileApplication[];
  onboardingProcesses: OnboardingProcess[];
};

async function uploadResume(file: File, getToken: () => Promise<string>): Promise<ResumeUpload> {
  const token = await getToken();
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/hr/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error ?? 'Falha ao enviar currículo.');
  }
  const { url, path } = await res.json();
  return { url: url as string, path: typeof path === 'string' ? path : undefined };
}

// ─── Small shared components ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: CandidateStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border border-current/20">
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.color} opacity-80`} />
      <span className="text-slate-300">{cfg.label}</span>
    </span>
  );
}

function RatingStars({ value, onChange, readonly }: {
  value: number; onChange?: (v: number) => void; readonly?: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star} type="button" disabled={readonly}
          onClick={() => onChange?.(star)}
          className={`transition-transform ${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'}`}
        >
          <Star className={`h-3 w-3 ${star <= value ? 'fill-yellow-400 text-yellow-400' : 'text-slate-700'}`} />
        </button>
      ))}
    </div>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  return (
    <p className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" /> {msg}
    </p>
  );
}

function formatFormAnswer(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  return String(value);
}

function ResumeInput({ value, onChange }: { value: File | null; onChange: (f: File | null) => void }) {
  return value ? (
    <div className="flex items-center gap-2 p-2.5 bg-slate-900 border border-indigo-500/30 rounded-xl">
      <Paperclip className="h-4 w-4 text-indigo-400 flex-shrink-0" />
      <span className="text-sm text-slate-300 truncate flex-1">{value.name}</span>
      <button type="button" onClick={() => onChange(null)} className="text-slate-500 hover:text-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  ) : (
    <label className="flex items-center gap-2 p-2.5 bg-slate-900 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700 transition-colors">
      <Paperclip className="h-4 w-4 text-slate-500" />
      <span className="text-sm text-slate-500">Anexar currículo (PDF, DOC)</span>
      <input
        type="file" accept=".pdf,.doc,.docx" className="hidden"
        onChange={e => onChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

// ─── NewCandidateModal ────────────────────────────────────────────────────────

function NewCandidateModal({ roles, openings, getToken, onClose, onCreated }: {
  roles: JobRole[];
  openings: JobOpening[];
  getToken: () => Promise<string>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', jobRoleId: '', jobOpeningId: '', source: '', notes: '',
  });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));

  // When opening is selected, auto-fill the jobRole
  const handleOpeningChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const openingId = e.target.value;
    const opening = openings.find(o => o.id === openingId);
    setForm(prev => ({
      ...prev,
      jobOpeningId: openingId,
      jobRoleId: opening?.jobRoleId ?? prev.jobRoleId,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.jobRoleId) {
      setError('Nome, e-mail e cargo são obrigatórios.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let resumeUrl: string | undefined;
      let resumePath: string | undefined;
      if (resumeFile) {
        const uploaded = await uploadResume(resumeFile, getToken);
        resumeUrl = uploaded.url;
        resumePath = uploaded.path;
      }

      const role = roles.find(r => r.id === form.jobRoleId);
      await apiFetch('/api/hr/candidates', getToken, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          jobRoleId: form.jobRoleId,
          jobRoleName: role?.name,
          jobOpeningId: form.jobOpeningId || undefined,
          source: form.source || undefined,
          notes: form.notes.trim() || undefined,
          resumeUrl,
          resumePath,
          status: 'applied',
          rating: 0,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const activeOpenings = openings.filter(o => o.status === 'open');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">Novo Candidato</h2>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {activeOpenings.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Vaga (opcional)</label>
              <select value={form.jobOpeningId} onChange={handleOpeningChange}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Sem vaga vinculada</option>
                {activeOpenings.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Nome *</label>
              <input type="text" value={form.name} onChange={set('name')} required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                placeholder="Nome completo" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">E-mail *</label>
              <input type="email" value={form.email} onChange={set('email')} required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                placeholder="email@exemplo.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Telefone</label>
              <input type="tel" value={form.phone} onChange={set('phone')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                placeholder="(11) 9 0000-0000" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Cargo *</label>
              <select value={form.jobRoleId} onChange={set('jobRoleId')} required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Selecione</option>
                {roles.filter(r => r.isActive !== false).map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Origem</label>
              <select value={form.source} onChange={set('source')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Não informado</option>
                {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Currículo</label>
              <ResumeInput value={resumeFile} onChange={setResumeFile} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Observações</label>
              <textarea value={form.notes} onChange={set('notes')} rows={2}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm resize-none"
                placeholder="Anotações iniciais…" />
            </div>
          </div>
          {error && <ErrorLine msg={error} />}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-xl hover:bg-slate-800">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-medium text-sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {saving ? 'Salvando…' : 'Adicionar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── CandidateDetailPanel ─────────────────────────────────────────────────────

function CandidateDetailPanel({ candidate, roles, openings, getToken, canManage, onClose, onUpdated, onDeleted }: {
  candidate: Candidate;
  roles: JobRole[];
  openings: JobOpening[];
  getToken: () => Promise<string>;
  canManage: boolean;
  onClose: () => void;
  onUpdated: (c: Candidate) => void;
  onDeleted: (id: string) => void;
}) {
  const [form, setForm] = useState({
    name: candidate.name,
    email: candidate.email,
    phone: candidate.phone ?? '',
    notes: candidate.notes ?? '',
    status: candidate.status,
    rating: candidate.rating ?? 0,
    source: candidate.source ?? '',
  });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<CandidateStatus | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<CandidateProfilePayload | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setProfileLoading(true);
    setProfileError(null);
    apiFetch(`/api/hr/candidates/${candidate.id}/profile`, getToken)
      .then((payload: CandidateProfilePayload) => {
        if (alive) setProfile(payload);
      })
      .catch((err) => {
        if (alive) setProfileError(err instanceof Error ? err.message : 'Falha ao carregar perfil completo.');
      })
      .finally(() => {
        if (alive) setProfileLoading(false);
      });
    return () => { alive = false; };
  }, [candidate.id, getToken]);

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      let resumeUrl = candidate.resumeUrl;
      let resumePath = candidate.resumePath;
      if (resumeFile) {
        const uploaded = await uploadResume(resumeFile, getToken);
        resumeUrl = uploaded.url;
        resumePath = uploaded.path;
      }

      const patch = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
        status: form.status,
        ...(form.status !== candidate.status ? { decisionAction: 'status_changed' as CandidateDecisionAction } : {}),
        rating: form.rating,
        source: form.source || null,
        ...(resumeUrl !== candidate.resumeUrl ? { resumeUrl } : {}),
        ...(resumePath !== candidate.resumePath ? { resumePath } : {}),
      };
      await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onUpdated({
        ...candidate, ...form,
        phone: form.phone || undefined,
        notes: form.notes || undefined,
        source: form.source || undefined,
        resumeUrl: resumeUrl ?? undefined,
        resumePath: resumePath ?? undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, { method: 'DELETE' });
      onDeleted(candidate.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleStatusAction = async (status: CandidateStatus, decisionAction: CandidateDecisionAction) => {
    setStatusAction(status);
    setError(null);
    const now = new Date().toISOString();
    try {
      const result = await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify({ status, decisionAction }),
      });
      const onboardingId = typeof result?.onboardingId === 'string' ? result.onboardingId : candidate.onboardingId;
      const historyEntry = createCandidateStageHistoryEntry({
        fromStatus: candidate.status,
        toStatus: status,
        action: decisionAction,
        actorId: null,
        actorEmail: null,
        createdAt: now,
      });
      const updated = {
        ...candidate,
        status,
        onboardingId,
        hiredAt: status === 'hired' ? candidate.hiredAt ?? now : candidate.hiredAt,
        updatedAt: now,
        recruitmentHistory: [...(candidate.recruitmentHistory ?? []), historyEntry],
        latestApplication: candidate.latestApplication
          ? {
              ...candidate.latestApplication,
              stage: status,
              onboardingId,
              stageHistory: [...(candidate.latestApplication.stageHistory ?? []), historyEntry],
            }
          : candidate.latestApplication,
      };
      setForm(prev => ({ ...prev, status }));
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar etapa.');
    } finally {
      setStatusAction(null);
    }
  };

  const role = roles.find(r => r.id === candidate.jobRoleId);
  const opening = openings.find(o => o.id === candidate.jobOpeningId);
  const formAnswers = candidate.latestApplication?.formAnswers ?? candidate.formAnswers ?? {};
  const questionSnapshot = candidate.latestApplication?.formQuestionSnapshot ?? candidate.formQuestionSnapshot ?? opening?.formQuestions ?? role?.formQuestions ?? [];
  const questionsById = new Map((questionSnapshot as HrFormQuestion[]).map(question => [question.id, question]));
  const answerEntries = Object.entries(formAnswers);
  const stageHistory = (
    candidate.latestApplication?.stageHistory?.length
      ? candidate.latestApplication.stageHistory
      : candidate.recruitmentHistory ?? []
  )
    .filter((entry): entry is CandidateStageHistoryEntry => !!entry && !!entry.createdAt)
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const profileApplications = profile?.applications ?? [];
  const profileOnboarding = profile?.onboardingProcesses ?? [];
  const hasChanges =
    form.name !== candidate.name || form.email !== candidate.email ||
    form.phone !== (candidate.phone ?? '') || form.notes !== (candidate.notes ?? '') ||
    form.status !== candidate.status || form.rating !== (candidate.rating ?? 0) ||
    form.source !== (candidate.source ?? '') || !!resumeFile;

  const currentResume = resumeFile ? null : candidate.resumeUrl;
  const nextPipelineStatus = PIPELINE_STATUSES.includes(form.status)
    ? PIPELINE_STATUSES[PIPELINE_STATUSES.indexOf(form.status) + 1] ?? null
    : 'applied';
  const hasPipelineNext = nextPipelineStatus && nextPipelineStatus !== form.status;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md h-full bg-slate-950 border-l border-slate-800 flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between p-6 border-b border-slate-800 gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">
              {role?.name ?? candidate.jobRoleName ?? '—'}
              {opening && <span className="text-indigo-400"> · {opening.title}</span>}
            </p>
            <h2 className="text-lg font-bold text-white truncate">{candidate.name}</h2>
            <p className="text-sm text-slate-500 truncate mt-0.5">{candidate.email}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800 flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {canManage && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Decisão do processo</p>
                  <p className="mt-0.5 text-sm font-semibold text-white">{STATUS_CONFIG[form.status].label}</p>
                </div>
                <StatusBadge status={form.status} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {hasPipelineNext && nextPipelineStatus && (
                  <button
                    type="button"
                    onClick={() => handleStatusAction(nextPipelineStatus, 'advanced')}
                    disabled={!!statusAction}
                    className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {statusAction === nextPipelineStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                    Avançar para {STATUS_CONFIG[nextPipelineStatus].label}
                  </button>
                )}
                {form.status !== 'hired' && (
                  <button
                    type="button"
                    onClick={() => handleStatusAction('hired', 'hired')}
                    disabled={!!statusAction}
                    className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/15 disabled:opacity-50"
                  >
                    {statusAction === 'hired' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Aprovar contratação
                  </button>
                )}
                {form.status !== TALENT_POOL_STATUS && (
                  <button
                    type="button"
                    onClick={() => handleStatusAction(TALENT_POOL_STATUS, 'talent_pool')}
                    disabled={!!statusAction}
                    className="flex items-center justify-center gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/15 disabled:opacity-50"
                  >
                    {statusAction === TALENT_POOL_STATUS ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5" />}
                    Banco de talentos
                  </button>
                )}
                {form.status !== 'rejected' && (
                  <button
                    type="button"
                    onClick={() => handleStatusAction('rejected', 'rejected')}
                    disabled={!!statusAction}
                    className="flex items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300 transition hover:bg-red-500/15 disabled:opacity-50"
                  >
                    {statusAction === 'rejected' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                    Reprovar
                  </button>
                )}
                {form.status !== 'withdrawn' && (
                  <button
                    type="button"
                    onClick={() => handleStatusAction('withdrawn', 'withdrawn')}
                    disabled={!!statusAction}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {statusAction === 'withdrawn' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                    Desistência
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Status</label>
              {canManage ? (
                <select value={form.status}
                  onChange={e => setForm(prev => ({ ...prev, status: e.target.value as CandidateStatus }))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
                </select>
              ) : (
                <div className="mt-1"><StatusBadge status={form.status} /></div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Avaliação</label>
              <div className="py-2.5">
                <RatingStars value={form.rating}
                  onChange={canManage ? v => setForm(p => ({ ...p, rating: v })) : undefined}
                  readonly={!canManage} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Nome</label>
              <input type="text" value={form.name} onChange={set('name')} disabled={!canManage}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm disabled:opacity-60" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Telefone</label>
              <input type="tel" value={form.phone} onChange={set('phone')} disabled={!canManage}
                placeholder="—"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm disabled:opacity-60" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">E-mail</label>
            <input type="email" value={form.email} onChange={set('email')} disabled={!canManage}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm disabled:opacity-60" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Origem</label>
            {canManage ? (
              <select value={form.source} onChange={set('source')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Não informado</option>
                {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <p className="text-sm text-slate-300">{candidate.source || '—'}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Currículo</label>
            {canManage ? (
              <div className="space-y-2">
                {currentResume && !resumeFile && (
                  <a href={currentResume} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300">
                    <ExternalLink className="h-3.5 w-3.5" /> Ver currículo atual
                  </a>
                )}
                <ResumeInput value={resumeFile} onChange={setResumeFile} />
              </div>
            ) : currentResume ? (
              <a href={currentResume} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300">
                <ExternalLink className="h-3.5 w-3.5" /> Ver currículo
              </a>
            ) : (
              <p className="text-sm text-slate-500">—</p>
            )}
          </div>

          {(candidate.talentPool?.rolePreference || candidate.talentPool?.unitPreference || candidate.talentPool?.formVersion) && (
            <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4">
              <h3 className="text-xs font-bold text-cyan-200 uppercase tracking-wider">Banco de talentos</h3>
              <div className="mt-3 grid gap-3 text-sm">
                {candidate.talentPool?.rolePreference && (
                  <div>
                    <p className="text-xs font-medium text-slate-500">Cargo de interesse</p>
                    <p className="mt-0.5 text-slate-200">{candidate.talentPool.rolePreference}</p>
                  </div>
                )}
                {candidate.talentPool?.unitPreference && (
                  <div>
                    <p className="text-xs font-medium text-slate-500">Unidade preferida</p>
                    <p className="mt-0.5 text-slate-200">{candidate.talentPool.unitPreference}</p>
                  </div>
                )}
                {candidate.talentPool?.formVersion && (
                  <p className="text-xs text-slate-600">Formulário v{candidate.talentPool.formVersion}</p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-800 bg-slate-900/45 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Perfil completo</h3>
                <p className="mt-0.5 text-xs text-slate-600">Histórico consolidado do recrutamento e onboarding.</p>
              </div>
              {profileLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            </div>
            {profileError ? <ErrorLine msg={profileError} /> : null}
            {!profileLoading && !profileError && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Inscrições</p>
                    <p className="mt-1 text-xl font-bold text-white">{profileApplications.length}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Onboarding</p>
                    <p className="mt-1 text-xl font-bold text-white">{profileOnboarding.length}</p>
                  </div>
                </div>

                {profileApplications.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Histórico de vagas</p>
                    {profileApplications.slice(0, 5).map(application => {
                      const stage = application.stage && STATUS_CONFIG[application.stage] ? application.stage : null;
                      const title = [
                        application.jobRoleName,
                        application.functionName,
                      ].filter(Boolean).join(' | ') || 'Vaga sem cargo informado';
                      return (
                        <div key={application.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-100">{title}</p>
                              <p className="mt-0.5 truncate text-xs text-slate-500">{application.unitName || application.source || 'Origem não informada'}</p>
                            </div>
                            {stage ? <StatusBadge status={stage} /> : null}
                          </div>
                          {application.notes ? <p className="mt-2 text-xs text-slate-400">{application.notes}</p> : null}
                          <p className="mt-2 text-[10px] font-medium text-slate-600">
                            {application.appliedAt
                              ? new Date(application.appliedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
                              : 'Data não informada'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {profileOnboarding.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Onboarding vinculado</p>
                    {profileOnboarding.slice(0, 3).map(process => (
                      <div key={process.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-100">
                              {process.jobRoleName ?? 'Cargo não informado'}
                              {process.functionName ? ` | ${process.functionName}` : ''}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">{ONBOARDING_STATUS_LABELS[process.status] ?? process.status}</p>
                          </div>
                          {process.publicToken ? (
                            <a
                              href={`${PUBLIC_RECRUITMENT_URL}/onboarding/${process.publicToken}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-300 hover:bg-slate-800"
                            >
                              <ExternalLink className="h-3 w-3" /> Público
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {profileApplications.length === 0 && profileOnboarding.length === 0 && (
                  <p className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-sm text-slate-500">
                    Nenhum histórico adicional encontrado para este candidato.
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Observações</label>
            <textarea value={form.notes} onChange={set('notes')} disabled={!canManage} rows={4}
              placeholder={canManage ? 'Anotações sobre o candidato…' : '—'}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm resize-none disabled:opacity-60" />
          </div>

          {stageHistory.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Histórico do processo</h3>
              <div className="space-y-2">
                {stageHistory.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-100">
                          {DECISION_ACTION_LABELS[entry.action] ?? 'Movimentação'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {entry.fromStatus ? STATUS_CONFIG[entry.fromStatus]?.label ?? entry.fromStatus : 'Início'}
                          {' → '}
                          {STATUS_CONFIG[entry.toStatus]?.label ?? entry.toStatus}
                        </p>
                        {entry.note && <p className="mt-1 text-xs text-slate-400">{entry.note}</p>}
                      </div>
                      <span className="shrink-0 text-[10px] font-medium text-slate-600">
                        {new Date(entry.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {answerEntries.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Respostas do formulário</h3>
              <div className="space-y-2">
                {answerEntries.map(([questionId, answer]) => {
                  const question = questionsById.get(questionId);
                  return (
                    <div key={questionId} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                      <p className="text-xs font-medium text-slate-400">{question?.text ?? 'Pergunta removida'}</p>
                      <p className="mt-1 text-sm text-slate-200">{formatFormAnswer(answer)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="text-xs text-slate-600 space-y-0.5">
            <p>Inscrito em {new Date(candidate.appliedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
            <p>Atualizado em {new Date(candidate.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
          </div>

          {error && <ErrorLine msg={error} />}
        </div>

        {canManage && (
          <div className="p-4 border-t border-slate-800">
            {confirmDelete ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 space-y-3">
                <p className="text-sm text-red-400 font-medium">Confirmar exclusão?</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)}
                    className="flex-1 px-3 py-2 text-xs text-slate-400 hover:text-white border border-slate-700 rounded-lg">
                    Cancelar
                  </button>
                  <button onClick={handleDelete} disabled={deleting}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
                    {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    Excluir
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(true)}
                  className="p-2 text-slate-600 hover:text-red-400 rounded-lg hover:bg-red-500/10">
                  <Trash2 className="h-4 w-4" />
                </button>
                <button onClick={handleSave} disabled={saving || !hasChanges}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl font-medium text-sm">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {saving ? 'Salvando…' : 'Salvar alterações'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Kanban DnD ───────────────────────────────────────────────────────────────

const COLUMN_ACCENT: Record<CandidateStatus, string> = {
  applied:        'from-sky-50 to-blue-50 border-blue-100',
  screening:      'from-violet-50 to-indigo-50 border-indigo-100',
  interview:      'from-fuchsia-50 to-pink-50 border-pink-100',
  technical_test: 'from-amber-50 to-orange-50 border-orange-100',
  offer:          'from-emerald-50 to-teal-50 border-teal-100',
  hired:          'from-lime-50 to-green-50 border-green-100',
  rejected:       'from-rose-50 to-red-50 border-red-100',
  withdrawn:      'from-slate-50 to-zinc-50 border-slate-200',
  talent_pool:    'from-cyan-50 to-sky-50 border-cyan-100',
};

const CARD_ACCENT: Record<CandidateStatus, string> = {
  applied:        'bg-blue-100/80 border-blue-200 text-blue-950',
  screening:      'bg-violet-100/80 border-violet-200 text-violet-950',
  interview:      'bg-pink-100/80 border-pink-200 text-pink-950',
  technical_test: 'bg-orange-100/80 border-orange-200 text-orange-950',
  offer:          'bg-emerald-100/80 border-emerald-200 text-emerald-950',
  hired:          'bg-cyan-100/80 border-cyan-200 text-cyan-950',
  rejected:       'bg-rose-100/80 border-rose-200 text-rose-950',
  withdrawn:      'bg-slate-100 border-slate-200 text-slate-950',
  talent_pool:    'bg-cyan-100/80 border-cyan-200 text-cyan-950',
};

function CandidateInitials({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase();
  const colors = [
    'bg-indigo-500', 'bg-purple-500', 'bg-pink-500', 'bg-blue-500',
    'bg-teal-500', 'bg-orange-500', 'bg-green-500', 'bg-rose-500',
  ];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className={`h-7 w-7 rounded-full ${color} flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-white flex-shrink-0`}>
      {initials}
    </div>
  );
}

const SOURCE_TAG_COLORS: Record<string, string> = {
  LinkedIn:    'bg-white/75 text-blue-700 border-blue-100',
  Indicação:   'bg-white/75 text-green-700 border-green-100',
  Site:        'bg-white/75 text-violet-700 border-violet-100',
  Indeed:      'bg-white/75 text-orange-700 border-orange-100',
  Catho:       'bg-white/75 text-yellow-700 border-yellow-100',
  Espontâneo:  'bg-white/75 text-slate-600 border-slate-200',
  Outro:       'bg-white/75 text-slate-600 border-slate-200',
  site:        'bg-white/75 text-violet-700 border-violet-100',
};

function DraggableCard({ candidate, stage, onOpen }: { candidate: Candidate; stage?: RecruitmentStage; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: candidate.id,
    data: { candidate },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.35 : 1,
  };

  const sourceColor = candidate.source
    ? (SOURCE_TAG_COLORS[candidate.source] ?? SOURCE_TAG_COLORS['Outro'])
    : null;

  const isNew = (Date.now() - new Date(candidate.appliedAt).getTime()) < 7 * 86_400_000;
  const timing = getCandidateStageTiming(candidate, stage);

  return (
    <div
      ref={setNodeRef} style={style} {...attributes}
      className={`rounded-2xl border p-3 shadow-sm transition-all group hover:-translate-y-0.5 hover:shadow-md ${CARD_ACCENT[candidate.status]}`}
    >
      <button onClick={onOpen} className="w-full text-left">
        <div className="mb-3 flex items-start gap-2.5">
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="mb-2 flex items-center gap-1.5 flex-wrap">
              {sourceColor && candidate.source && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${sourceColor}`}>
                  #{candidate.source}
                </span>
              )}
              {isNew && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-md border border-emerald-100 tracking-wide">
                  NOVO
                </span>
              )}
              {stage?.dueDays !== null && stage?.dueDays !== undefined && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border tracking-wide ${
                  timing.isOverdue
                    ? 'border-red-100 bg-red-50 text-red-700'
                    : timing.daysLeft === 0
                      ? 'border-amber-100 bg-amber-50 text-amber-700'
                      : 'border-slate-100 bg-white/75 text-slate-600'
                }`}>
                  {timing.isOverdue
                    ? `${timing.overdueDays}d atraso`
                    : timing.daysLeft === 0
                      ? 'vence hoje'
                      : `${timing.daysLeft}d restantes`}
                </span>
              )}
            </div>
            <h4 className="font-semibold transition-colors text-sm leading-snug">
              {candidate.name}
            </h4>
            <p className="text-[11px] opacity-70 truncate mt-1">{candidate.jobRoleName}</p>
          </div>
          <div
            {...listeners}
            onClick={e => e.stopPropagation()}
            className="cursor-grab active:cursor-grabbing p-1 text-current/35 hover:text-current/60 flex-shrink-0 mt-0.5"
          >
            <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
              <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
              <circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/>
              <circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/>
            </svg>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <RatingStars value={candidate.rating ?? 0} readonly />
          {candidate.resumeUrl && (
            <span className="flex items-center gap-1 text-[10px] text-current/55 bg-white/65 px-1.5 py-0.5 rounded-md">
              <Paperclip className="h-2.5 w-2.5" /> CV
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex -space-x-2">
            <CandidateInitials name={candidate.name} />
          </div>
          <span className="text-[10px] text-current/55 flex items-center gap-1 rounded-md bg-white/65 px-2 py-1">
            <Calendar className="h-2.5 w-2.5" />
            {new Date(candidate.appliedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
          </span>
        </div>
      </button>
    </div>
  );
}

function DroppableColumn({ status, stage, candidates, onCardOpen }: {
  status: CandidateStatus;
  stage?: RecruitmentStage;
  candidates: Candidate[];
  onCardOpen: (c: Candidate) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const cfg = STATUS_CONFIG[status];
  const accent = COLUMN_ACCENT[status];
  const overdueCount = stage
    ? candidates.filter(candidate => getCandidateStageTiming(candidate, stage).isOverdue).length
    : 0;

  return (
    <div className={`flex-shrink-0 w-[270px] rounded-2xl border bg-gradient-to-b ${accent} p-2 shadow-sm flex flex-col`}>
      <div className="px-2.5 py-2.5 flex items-center gap-2">
        <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-slate-900">{stage?.label ?? cfg.label}</h3>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {stage?.dueDays === null || stage?.dueDays === undefined ? 'Sem prazo' : `${stage.dueDays}d de prazo`}
            {overdueCount > 0 ? ` · ${overdueCount} atrasado${overdueCount !== 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-white/70 hover:text-slate-900">
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-white/70 hover:text-slate-900">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      <div
        ref={setNodeRef}
        className={`flex flex-col gap-3 p-1 min-h-[420px] rounded-xl transition-colors ${
          isOver
            ? 'bg-white/70 ring-2 ring-indigo-200'
            : 'bg-white/25'
        }`}
      >
        {candidates.map(c => (
          <DraggableCard key={c.id} candidate={c} stage={stage} onOpen={() => onCardOpen(c)} />
        ))}
        {candidates.length === 0 && (
          <div className={`flex-1 min-h-[120px] flex items-center justify-center rounded-xl border border-dashed ${
            isOver ? 'border-indigo-300 bg-indigo-50/70' : 'border-slate-200 bg-white/35'
          }`}>
            <UserPlus className="h-4 w-4 text-slate-400" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ListRowMenu ──────────────────────────────────────────────────────────────

function ListRowMenu({ candidate, onOpen, onDelete }: {
  candidate: Candidate; onOpen: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={e => { e.stopPropagation(); setOpen(p => !p); }}
        className="p-2 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-slate-900 border border-slate-800 rounded-xl shadow-xl z-10 overflow-hidden">
          <button onClick={() => { setOpen(false); onOpen(); }}
            className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white">
            Ver detalhes
          </button>
          <button onClick={() => { setOpen(false); onDelete(); }}
            className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10">
            Excluir
          </button>
        </div>
      )}
    </div>
  );
}

// ─── DeleteConfirmModal ───────────────────────────────────────────────────────

function DeleteConfirmModal({ candidate, getToken, onClose, onDeleted }: {
  candidate: Candidate; getToken: () => Promise<string>; onClose: () => void; onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, { method: 'DELETE' });
      onDeleted(candidate.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir.');
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-red-500/10 rounded-xl">
            <Trash2 className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h3 className="font-bold text-white text-sm">Excluir candidato</h3>
            <p className="text-xs text-slate-400 mt-0.5">{candidate.name}</p>
          </div>
        </div>
        <p className="text-sm text-slate-400">Esta ação é permanente e não pode ser desfeita.</p>
        {error && <ErrorLine msg={error} />}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 px-3 py-2 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-xl">
            Cancelar
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {deleting ? 'Excluindo…' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── OpeningModal ─────────────────────────────────────────────────────────────

function OpeningModal({ opening, roles, functions, units, shiftDefinitions, getToken, onClose, onSaved }: {
  opening?: JobOpening;
  roles: JobRole[];
  functions: JobFunction[];
  units: DPUnit[];
  shiftDefinitions: DPShiftDefinition[];
  getToken: () => Promise<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!opening;
  const formId = opening ? `opening-form-${opening.id}` : 'opening-form-new';
  const [form, setForm] = useState({
    title: opening?.title ?? '',
    jobRoleId: opening?.jobRoleId ?? '',
    functionId: opening?.functionId ?? '',
    unitId: opening?.unitId ?? '',
    shiftDefinitionId: opening?.shiftDefinitionId ?? '',
    description: opening?.description ?? '',
    location: opening?.location ?? '',
    workType: opening?.workType ?? '',
    slots: String(opening?.slots ?? 1),
    applicationStartAt: opening?.applicationStartAt ? opening.applicationStartAt.split('T')[0] : '',
    applicationEndAt: opening?.applicationEndAt ? opening.applicationEndAt.split('T')[0] : '',
    closesAt: opening?.closesAt ? opening.closesAt.split('T')[0] : '',
    status: opening?.status ?? 'open',
    requirements: (opening?.requirements ?? []).join('\n'),
  });
  const [questions, setQuestions] = useState<HrFormQuestion[]>(opening?.formQuestions ?? []);
  const [questionsTouched, setQuestionsTouched] = useState(isEdit);
  const [stages, setStages] = useState<RecruitmentStage[]>(normalizeRecruitmentStages(opening?.pipelineStages));
  const [questionDraft, setQuestionDraft] = useState(EMPTY_QUESTION_DRAFT);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));

  const selectedRole = roles.find(role => role.id === form.jobRoleId) ?? null;
  const compatibleFunctions = functions.filter(fn => {
    if (fn.isActive === false) return false;
    if (!form.jobRoleId) return true;
    return !fn.compatibleRoleIds?.length || fn.compatibleRoleIds.includes(form.jobRoleId);
  });
  const selectedFunction = compatibleFunctions.find(fn => fn.id === form.functionId) ?? null;
  const selectedUnit = units.find(unit => unit.id === form.unitId) ?? null;
  const availableShiftDefinitions = shiftDefinitions.filter(shift => {
    if (!form.unitId) return true;
    const unitIds = shift.unitIds ?? (shift.unitId ? [shift.unitId] : []);
    return unitIds.length === 0 || unitIds.includes(form.unitId);
  });
  const selectedShiftDefinition = availableShiftDefinitions.find(shift => shift.id === form.shiftDefinitionId) ?? null;

  const getModelQuestions = (role: JobRole | null, fn: JobFunction | null) =>
    mergeRecruitmentQuestionModels(role?.formQuestions, fn?.formQuestions);

  const reloadModelQuestions = () => {
    setQuestions(getModelQuestions(selectedRole, selectedFunction));
    setQuestionsTouched(false);
    setQuestionError(null);
  };

  const applyDefaults = (role: JobRole | null, fn: JobFunction | null) => {
    const nextTitle = fn?.publicTitle || fn?.name || role?.publicTitle || role?.name || '';
    const descriptions = [
      role?.publicDescription || role?.description,
      fn?.publicDescription || fn?.description,
    ].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    const requirements = [
      ...(role?.publicRequirements?.length ? role.publicRequirements : role?.requirements ?? []),
      ...(fn?.requirements ?? []),
    ];
    const inheritedQuestions = getModelQuestions(role, fn);
    const inheritedStages = mergeRecruitmentStageModels(role?.pipelineStages, fn?.pipelineStages);

    setForm(prev => ({
      ...prev,
      title: prev.title.trim() || !nextTitle ? prev.title : nextTitle,
      description: prev.description.trim() || descriptions.length === 0 ? prev.description : descriptions.join('\n\n'),
      requirements: prev.requirements.trim() || requirements.length === 0 ? prev.requirements : Array.from(new Set(requirements)).join('\n'),
    }));
    setQuestions(prev => questionsTouched ? prev : inheritedQuestions);
    setStages(inheritedStages);
  };

  const handleRoleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const jobRoleId = event.target.value;
    const role = roles.find(item => item.id === jobRoleId) ?? null;
    const currentFunction = functions.find(item => item.id === form.functionId) ?? null;
    const functionStillCompatible = currentFunction && (
      !currentFunction.compatibleRoleIds?.length || currentFunction.compatibleRoleIds.includes(jobRoleId)
    );
    setForm(prev => ({ ...prev, jobRoleId, functionId: functionStillCompatible ? prev.functionId : '' }));
    applyDefaults(role, functionStillCompatible ? currentFunction : null);
  };

  const handleFunctionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const functionId = event.target.value;
    const fn = functions.find(item => item.id === functionId) ?? null;
    setForm(prev => ({ ...prev, functionId }));
    applyDefaults(selectedRole, fn);
  };

  const handleUnitChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const unitId = event.target.value;
    const unit = units.find(item => item.id === unitId) ?? null;
    setForm(prev => ({
      ...prev,
      unitId,
      shiftDefinitionId: '',
      location: prev.location.trim() || !unit?.name ? prev.location : unit.name,
    }));
  };

  const updateQuestion = (questionId: string, patch: Partial<HrFormQuestion>) => {
    setQuestionsTouched(true);
    setQuestions(prev => prev.map(question => question.id === questionId ? { ...question, ...patch } : question));
  };

  const updateQuestionOptions = (questionId: string, optionsText: string) => {
    setQuestionsTouched(true);
    const options = optionsText
      .split('\n')
      .map(option => option.trim())
      .filter(Boolean);
    setQuestions(prev => prev.map(question => {
      if (question.id !== questionId) return question;
      return {
        ...question,
        config: {
          ...(question.config ?? {}),
          options,
        },
      };
    }));
  };

  const moveQuestion = (questionId: string, direction: -1 | 1) => {
    setQuestionsTouched(true);
    setQuestions(prev => {
      const index = prev.findIndex(question => question.id === questionId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const updateStage = (stageId: CandidateStatus, patch: Partial<RecruitmentStage>) => {
    setStages(prev => prev.map(stage => stage.id === stageId ? { ...stage, ...patch } : stage));
  };

  const moveStage = (stageId: CandidateStatus, direction: -1 | 1) => {
    setStages(prev => {
      const index = prev.findIndex(stage => stage.id === stageId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next.map((stage, stageIndex) => ({ ...stage, order: stageIndex }));
    });
  };

  const addQuestion = () => {
    const text = questionDraft.text.trim();
    if (!text) {
      setQuestionError('Informe o texto da pergunta.');
      return;
    }

    const options = questionDraft.optionsText
      .split('\n')
      .map(option => option.trim())
      .filter(Boolean);
    if ((questionDraft.type === 'select' || questionDraft.type === 'multi_select') && options.length === 0) {
      setQuestionError('Informe ao menos uma opção para esta pergunta.');
      return;
    }

    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `question-${Date.now()}`;
    setQuestions(prev => [
      ...prev,
      {
        id,
        text,
        type: questionDraft.type,
        required: questionDraft.required,
        scored: false,
        weight: 'medium',
        eliminatory: questionDraft.eliminatory,
        tags: [],
        config: options.length > 0 ? { options } : undefined,
      },
    ]);
    setQuestionsTouched(true);
    setQuestionDraft(EMPTY_QUESTION_DRAFT);
    setQuestionError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.jobRoleId) {
      setError('Título e cargo são obrigatórios.');
      return;
    }
    if (form.applicationStartAt && form.applicationEndAt && form.applicationEndAt < form.applicationStartAt) {
      setError('A data final de inscrição precisa ser posterior à data inicial.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: form.title.trim(),
        jobRoleId: form.jobRoleId,
        functionId: form.functionId || null,
        functionName: selectedFunction?.name ?? null,
        unitId: form.unitId || null,
        unitName: selectedUnit?.name ?? null,
        shiftDefinitionId: form.shiftDefinitionId || null,
        shiftDefinitionName: selectedShiftDefinition?.name ?? null,
        description: form.description.trim() || null,
        location: form.location.trim() || null,
        workType: form.workType || null,
        slots: Number(form.slots) || 1,
        applicationStartAt: dateInputToIso(form.applicationStartAt),
        applicationEndAt: dateInputToIso(form.applicationEndAt, true),
        closesAt: dateInputToIso(form.closesAt, true),
        status: form.status,
        requirements: form.requirements.split('\n').map(s => s.trim()).filter(Boolean),
        formQuestions: questions,
        pipelineStages: stages.map((stage, index) => ({ ...stage, order: index })),
      };
      if (isEdit) {
        await apiFetch(`/api/hr/openings/${opening!.id}`, getToken, {
          method: 'PATCH', body: JSON.stringify(body),
        });
      } else {
        await apiFetch('/api/hr/openings', getToken, {
          method: 'POST', body: JSON.stringify(body),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-800 flex-shrink-0">
          <h2 className="text-lg font-bold text-white">{isEdit ? 'Editar vaga' : 'Nova vaga'}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form id={formId} onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Título da vaga *</label>
              <input type="text" value={form.title} onChange={set('title')} required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                placeholder="Ex: Gerente de Produção – Unidade SP" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Cargo *</label>
              <select value={form.jobRoleId} onChange={handleRoleChange} required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Selecione</option>
                {roles.filter(r => r.isActive !== false).map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Função</label>
              <select value={form.functionId} onChange={handleFunctionChange}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Sem função específica</option>
                {compatibleFunctions.map(fn => (
                  <option key={fn.id} value={fn.id}>{fn.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Nº de vagas</label>
              <input type="number" min="1" value={form.slots} onChange={set('slots')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Unidade</label>
              <select value={form.unitId} onChange={handleUnitChange}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Não especificada</option>
                {units.map(unit => (
                  <option key={unit.id} value={unit.id}>{unit.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Turno</label>
              <select value={form.shiftDefinitionId} onChange={set('shiftDefinitionId')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Não especificado</option>
                {availableShiftDefinitions.map(shift => (
                  <option key={shift.id} value={shift.id}>
                    {shift.name}{shift.startTime && shift.endTime ? ` (${shift.startTime}-${shift.endTime})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Localidade</label>
              <input type="text" value={form.location} onChange={set('location')} placeholder="Ex: São Paulo, SP"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Modalidade</label>
              <select value={form.workType} onChange={set('workType')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Não especificado</option>
                {WORK_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Início das inscrições</label>
              <input type="date" value={form.applicationStartAt} onChange={set('applicationStartAt')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Fim das inscrições</label>
              <input type="date" value={form.applicationEndAt} onChange={set('applicationEndAt')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Encerra em</label>
              <input type="date" value={form.closesAt} onChange={set('closesAt')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm" />
            </div>
            {isEdit && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Status</label>
                <select value={form.status} onChange={set('status')}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                  {(Object.keys(OPENING_STATUS_CONFIG) as JobOpeningStatus[]).map(s => (
                    <option key={s} value={s}>{OPENING_STATUS_CONFIG[s].label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Descrição</label>
              <textarea value={form.description} onChange={set('description')} rows={3}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm resize-none"
                placeholder="Sobre a vaga, contexto, dia a dia…" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Requisitos <span className="text-slate-600 font-normal">(um por linha)</span>
              </label>
              <textarea value={form.requirements} onChange={set('requirements')} rows={4}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm resize-none font-mono"
                placeholder="Experiência com gestão de equipes&#10;Disponibilidade de horário&#10;Residir em SP" />
            </div>
            <div className="col-span-2 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Etapas do processo</h3>
                <p className="mt-1 text-xs text-slate-500">Ordem e rótulos usados no Kanban desta vaga.</p>
              </div>
              <div className="space-y-2">
                {stages.map((stage, index) => (
                  <div key={stage.id} className="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 md:grid-cols-[2rem_1fr_8rem_8rem] md:items-center">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-slate-400">
                      {index + 1}
                    </div>
                    <div>
                      <label className="sr-only">Nome da etapa</label>
                      <input
                        type="text"
                        value={stage.label}
                        onChange={event => updateStage(stage.id, { label: event.target.value })}
                        className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                      />
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{STATUS_CONFIG[stage.id].label}</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-600">Prazo</label>
                      <input
                        type="number"
                        min="0"
                        value={stage.dueDays ?? ''}
                        onChange={event => updateStage(stage.id, {
                          dueDays: event.target.value === '' ? null : Number(event.target.value),
                        })}
                        placeholder="dias"
                        className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveStage(stage.id, -1)}
                        className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-30"
                      >
                        Subir
                      </button>
                      <button
                        type="button"
                        disabled={index === stages.length - 1}
                        onClick={() => moveStage(stage.id, 1)}
                        className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-30"
                      >
                        Descer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="col-span-2 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Formulário de triagem</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Perguntas exibidas na candidatura pública desta vaga. O modelo combina cargo e função.
                  </p>
                  {questionsTouched && (
                    <p className="mt-1 text-[11px] font-medium text-amber-300">
                      Este formulário foi editado manualmente e não será sobrescrito ao trocar cargo/função.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={reloadModelQuestions}
                  disabled={!selectedRole}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Recarregar cargo + função
                </button>
              </div>

              {questions.length > 0 && (
                <div className="space-y-2">
                  {questions.map((question, index) => (
                    <div key={question.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="grid gap-3 md:grid-cols-[1fr_160px_auto] md:items-start">
                        <div>
                          <input
                            type="text"
                            value={question.text}
                            onChange={event => updateQuestion(question.id, { text: event.target.value })}
                            className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                          />
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={question.required}
                                onChange={event => updateQuestion(question.id, { required: event.target.checked })}
                                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-500"
                              />
                              Obrigatória
                            </label>
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={question.eliminatory}
                                onChange={event => updateQuestion(question.id, { eliminatory: event.target.checked })}
                                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-500"
                              />
                              Eliminatória
                            </label>
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={question.config?.multiline === true}
                                onChange={event => updateQuestion(question.id, {
                                  config: { ...(question.config ?? {}), multiline: event.target.checked },
                                })}
                                disabled={question.type !== 'text'}
                                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-500 disabled:opacity-40"
                              />
                              Texto longo
                            </label>
                          </div>
                          {(question.type === 'select' || question.type === 'multi_select') && (
                            <textarea
                              value={Array.isArray(question.config?.options) ? question.config.options.join('\n') : ''}
                              onChange={event => updateQuestionOptions(question.id, event.target.value)}
                              rows={3}
                              placeholder={'Opções, uma por linha\nManhã\nTarde/noite\nFlexível'}
                              className="mt-3 w-full resize-none rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            />
                          )}
                        </div>
                        <select
                          value={question.type}
                          onChange={event => updateQuestion(question.id, { type: event.target.value as HrFormQuestion['type'] })}
                          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        >
                          {QUESTION_TYPES.map(type => (
                            <option key={type.value} value={type.value}>{type.label}</option>
                          ))}
                        </select>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveQuestion(question.id, -1)}
                            className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-30"
                          >
                            Subir
                          </button>
                          <button
                            type="button"
                            disabled={index === questions.length - 1}
                            onClick={() => moveQuestion(question.id, 1)}
                            className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-30"
                          >
                            Descer
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setQuestionsTouched(true);
                              setQuestions(prev => prev.filter(item => item.id !== question.id));
                            }}
                            className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-white"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-950/50 p-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Pergunta</label>
                  <input
                    type="text"
                    value={questionDraft.text}
                    onChange={event => setQuestionDraft(prev => ({ ...prev, text: event.target.value }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                    placeholder="Ex: Você tem disponibilidade aos domingos?"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Tipo</label>
                  <select
                    value={questionDraft.type}
                    onChange={event => setQuestionDraft(prev => ({ ...prev, type: event.target.value as HrFormQuestion['type'] }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                  >
                    {QUESTION_TYPES.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={questionDraft.required}
                      onChange={event => setQuestionDraft(prev => ({ ...prev, required: event.target.checked }))}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-500"
                    />
                    Obrigatória
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={questionDraft.eliminatory}
                      onChange={event => setQuestionDraft(prev => ({ ...prev, eliminatory: event.target.checked }))}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-500"
                    />
                    Eliminatória
                  </label>
                </div>
                {(questionDraft.type === 'select' || questionDraft.type === 'multi_select') && (
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Opções, uma por linha</label>
                    <textarea
                      value={questionDraft.optionsText}
                      onChange={event => setQuestionDraft(prev => ({ ...prev, optionsText: event.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm resize-none"
                      placeholder={'Manhã\nTarde/noite\nFlexível'}
                    />
                  </div>
                )}
                {questionError && <p className="col-span-2 text-xs text-red-400">{questionError}</p>}
                <div className="col-span-2">
                  <button
                    type="button"
                    onClick={addQuestion}
                    className="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4" /> Adicionar pergunta
                  </button>
                </div>
              </div>
            </div>
          </div>
          {error && <ErrorLine msg={error} />}
        </form>
        <div className="flex justify-end gap-3 p-6 border-t border-slate-800 flex-shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-xl hover:bg-slate-800">
            Cancelar
          </button>
          <button
            type="submit"
            form={formId}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-medium text-sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar vaga'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── OpeningsView ─────────────────────────────────────────────────────────────

function OpeningsView({ openings, roles, functions, units, shiftDefinitions, candidates, getToken, canManage, onRefresh, onCandidatesFilter }: {
  openings: JobOpening[];
  roles: JobRole[];
  functions: JobFunction[];
  units: DPUnit[];
  shiftDefinitions: DPShiftDefinition[];
  candidates: Candidate[];
  getToken: () => Promise<string>;
  canManage: boolean;
  onRefresh: () => void;
  onCandidatesFilter: (openingId: string) => void;
}) {
  const [modal, setModal] = useState<'new' | JobOpening | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobOpening | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (o: JobOpening) => {
    setDeleting(true);
    try {
      await apiFetch(`/api/hr/openings/${o.id}`, getToken, { method: 'DELETE' });
      onRefresh();
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const grouped: Record<JobOpeningStatus, JobOpening[]> = { open: [], paused: [], closed: [] };
  openings.forEach(o => grouped[o.status].push(o));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-slate-500 text-sm">{openings.filter(o => o.status === 'open').length} vagas abertas</p>
        {canManage && (
          <button onClick={() => setModal('new')}
            className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800">
            <Plus className="h-4 w-4" /> Nova vaga
          </button>
        )}
      </div>

      {openings.length === 0 && (
        <div className="py-16 text-center">
          <Briefcase className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Nenhuma vaga cadastrada.</p>
        </div>
      )}

      {(Object.keys(grouped) as JobOpeningStatus[]).map(status => {
        const group = grouped[status];
        if (group.length === 0) return null;
        const cfg = OPENING_STATUS_CONFIG[status];
        const Icon = cfg.icon;
        return (
          <div key={status}>
            <div className="flex items-center gap-2 mb-3">
              <Icon className="h-4 w-4 text-slate-500" />
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">{cfg.label}</h3>
              <span className="text-xs text-slate-600">({group.length})</span>
            </div>
            <div className="space-y-3">
              {group.map(opening => {
                const role = roles.find(r => r.id === opening.jobRoleId);
                const openingCandidates = candidates.filter(c => c.jobOpeningId === opening.id);
                const pipelineCount = openingCandidates.filter(c => PIPELINE_STATUSES.includes(c.status)).length;
                const hiredCount = openingCandidates.filter(c => c.status === 'hired').length;
                return (
                  <div key={opening.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-slate-300">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-bold text-slate-950 text-sm">{opening.title}</h4>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.color}`}>
                            {cfg.label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mb-2">
                          {role?.name ?? opening.jobRoleName}
                          {opening.functionName ? ` · ${opening.functionName}` : ''}
                        </p>
                        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                          {(opening.unitName || opening.location) && <span>{opening.unitName || opening.location}</span>}
                          {opening.shiftDefinitionName && <span>{opening.shiftDefinitionName}</span>}
                          {opening.workType && <span>{{ presencial: 'Presencial', remoto: 'Remoto', hibrido: 'Híbrido' }[opening.workType]}</span>}
                          <span>{opening.slots} vaga{opening.slots !== 1 ? 's' : ''}</span>
                          <span>{openingCandidates.length} inscrito{openingCandidates.length !== 1 ? 's' : ''}</span>
                          {hiredCount > 0 && <span className="text-emerald-600">{hiredCount} contratado{hiredCount !== 1 ? 's' : ''}</span>}
                          {opening.applicationStartAt && (
                            <span>
                              inscrições desde {new Date(opening.applicationStartAt).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                          {opening.applicationEndAt && (
                            <span className="text-amber-600">
                              inscrições até {new Date(opening.applicationEndAt).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                          {opening.closesAt && (
                            <span className="text-amber-600">
                              até {new Date(opening.closesAt).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {opening.status === 'open' && (
                          <a
                            href={`${PUBLIC_RECRUITMENT_URL}/${opening.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 border border-slate-200 hover:border-slate-300 rounded-lg transition-colors"
                          >
                            Ver vaga
                          </a>
                        )}
                        <button
                          onClick={() => onCandidatesFilter(opening.id)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 border border-slate-200 hover:border-slate-300 rounded-lg transition-colors">
                          Candidatos ({pipelineCount})
                        </button>
                        {canManage && (
                          <>
                            <button onClick={() => setModal(opening)}
                              className="p-1.5 text-slate-500 hover:text-slate-950 rounded-lg hover:bg-slate-100">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setDeleteTarget(opening)}
                              className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg hover:bg-red-500/10">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {opening.description && (
                      <p className="mt-3 text-xs text-slate-500 line-clamp-2">{opening.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {modal && (
        <OpeningModal
          opening={modal === 'new' ? undefined : modal}
          roles={roles}
          functions={functions}
          units={units}
          shiftDefinitions={shiftDefinitions}
          getToken={getToken}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); onRefresh(); }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative z-10 w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-slate-950">Excluir vaga?</h3>
            <p className="text-sm text-slate-500">"{deleteTarget.title}" será removida permanentemente.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 px-3 py-2 text-sm border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={() => handleDelete(deleteTarget)} disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-xl">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TalentsView ─────────────────────────────────────────────────────────────

function TalentsView({ candidates, roles, openings, getToken, canManage, onOpen, onReactivated }: {
  candidates: Candidate[];
  roles: JobRole[];
  openings: JobOpening[];
  getToken: () => Promise<string>;
  canManage: boolean;
  onOpen: (c: Candidate) => void;
  onReactivated: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterRating, setFilterRating] = useState('');
  const [reactivating, setReactivating] = useState<string | null>(null);
  const [reactivationTarget, setReactivationTarget] = useState<Candidate | null>(null);
  const [reactivationOpeningId, setReactivationOpeningId] = useState('');
  const [reactivationStage, setReactivationStage] = useState<CandidateStatus>('applied');
  const [reactivationReuseData, setReactivationReuseData] = useState(true);
  const [reactivationNote, setReactivationNote] = useState('');
  const [reactivationError, setReactivationError] = useState<string | null>(null);

  const talentPoolCandidates = candidates.filter(c => c.status === TALENT_POOL_STATUS || c.source === 'talent_pool');
  const activeOpenings = openings.filter(opening => opening.status === 'open');
  const selectedReactivationOpening = activeOpenings.find(opening => opening.id === reactivationOpeningId) ?? null;
  const reactivationStages = normalizeRecruitmentStages(selectedReactivationOpening?.pipelineStages);

  const filtered = talentPoolCandidates.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) &&
        !c.email.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterRole && c.jobRoleId !== filterRole) return false;
    if (filterRating && (c.rating ?? 0) < Number(filterRating)) return false;
    return true;
  });

  const highRating = talentPoolCandidates.filter(c => (c.rating ?? 0) >= 4).length;

  async function handleReactivate(candidate: Candidate, openingId: string) {
    if (!openingId) {
      setReactivationError('Selecione uma vaga para reativar o candidato.');
      return;
    }
    setReactivating(candidate.id);
    setReactivationError(null);
    try {
      await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify({
          reactivateToOpeningId: openingId,
          reactivateToStage: reactivationStage,
          reuseCandidateData: reactivationReuseData,
          decisionNote: reactivationNote.trim() || undefined,
        }),
      });
      setReactivationTarget(null);
      setReactivationOpeningId('');
      setReactivationStage('applied');
      setReactivationReuseData(true);
      setReactivationNote('');
      onReactivated();
    } catch (err) {
      setReactivationError(err instanceof Error ? err.message : 'Falha ao reativar candidato.');
    } finally {
      setReactivating(null);
    }
  }

  const roleOptions = useMemo(() => {
    const ids = new Set(talentPoolCandidates.map(c => c.jobRoleId).filter(Boolean));
    return roles.filter(r => ids.has(r.id));
  }, [talentPoolCandidates, roles]);

  return (
    <div className="flex flex-col gap-4 flex-1">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Total no banco</p>
          <p className="text-3xl font-bold text-white">{talentPoolCandidates.length}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Alta avaliação (4+)</p>
          <p className="text-3xl font-bold text-amber-400">{highRating}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Cargos distintos</p>
          <p className="text-3xl font-bold text-white">{roleOptions.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou e-mail…"
            className="pl-9 pr-4 py-2 bg-slate-900/50 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-52 text-sm" />
        </div>
        {roleOptions.length > 0 && (
          <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
            className="px-3 py-2 bg-slate-900/50 border border-slate-800 rounded-xl text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
            <option value="">Todos os cargos</option>
            {roleOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <select value={filterRating} onChange={e => setFilterRating(e.target.value)}
          className="px-3 py-2 bg-slate-900/50 border border-slate-800 rounded-xl text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
          <option value="">Avaliação</option>
          <option value="1">1+ estrela</option>
          <option value="2">2+ estrelas</option>
          <option value="3">3+ estrelas</option>
          <option value="4">4+ estrelas</option>
          <option value="5">5 estrelas</option>
        </select>
      </div>

      {/* Empty state */}
      {talentPoolCandidates.length === 0 && (
        <div className="py-16 text-center">
          <Star className="h-10 w-10 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Nenhum candidato no banco de talentos ainda.</p>
          <p className="text-slate-600 text-xs mt-1">Candidatos espontâneos ou movidos para o banco aparecem aqui.</p>
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(candidate => {
            const statusCfg = STATUS_CONFIG[candidate.status];
            return (
              <div key={candidate.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors flex flex-col gap-3">
                {/* Top */}
                <div className="flex items-start gap-3">
                  <CandidateInitials name={candidate.name} />
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => onOpen(candidate)}
                      className="text-sm font-semibold text-white hover:text-indigo-300 transition-colors truncate block text-left w-full">
                      {candidate.name}
                    </button>
                    <p className="text-[11px] text-slate-500 truncate">{candidate.jobRoleName ?? '—'}</p>
                    {candidate.talentPool?.unitPreference && (
                      <p className="mt-0.5 text-[10px] text-slate-600 truncate">{candidate.talentPool.unitPreference}</p>
                    )}
                  </div>
                </div>

                {/* Rating */}
                <RatingStars value={candidate.rating ?? 0} readonly />

                {/* Status + date */}
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusCfg.color}/20 text-slate-400`}>
                    {statusCfg.label}
                  </span>
                  <span className="text-[10px] text-slate-600">
                    {new Date(candidate.appliedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </span>
                </div>

                {/* Reactivate */}
                {canManage && (
                  <button
                    onClick={() => {
                      setReactivationTarget(candidate);
                      setReactivationOpeningId('');
                      setReactivationStage('applied');
                      setReactivationReuseData(true);
                      setReactivationNote('');
                      setReactivationError(null);
                    }}
                    disabled={reactivating === candidate.id}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-indigo-400 border border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/15 rounded-xl transition-colors disabled:opacity-40">
                    {reactivating === candidate.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <ArrowRight className="h-3 w-3" />}
                    Reativar em vaga
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* No results */}
      {talentPoolCandidates.length > 0 && filtered.length === 0 && (
        <div className="py-10 text-center text-slate-600 text-sm">Nenhum candidato encontrado com os filtros aplicados.</div>
      )}

      {reactivationTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setReactivationTarget(null)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Banco de talentos</p>
                <h3 className="mt-1 text-lg font-bold text-white">Reativar candidato</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Vincule <span className="font-semibold text-slate-200">{reactivationTarget.name}</span> a uma vaga aberta.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReactivationTarget(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Vaga aberta</label>
                <select
                  value={reactivationOpeningId}
                  onChange={event => {
                    const openingId = event.target.value;
                    const opening = activeOpenings.find(item => item.id === openingId) ?? null;
                    const stages = normalizeRecruitmentStages(opening?.pipelineStages);
                    setReactivationOpeningId(openingId);
                    setReactivationStage(stages[0]?.id ?? 'applied');
                  }}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500/30"
                >
                  <option value="">Selecione uma vaga</option>
                  {activeOpenings.map(opening => (
                    <option key={opening.id} value={opening.id}>
                      {opening.title}{opening.unitName || opening.location ? ` · ${opening.unitName || opening.location}` : ''}
                    </option>
                  ))}
                </select>
                {activeOpenings.length === 0 && (
                  <p className="mt-2 text-xs text-amber-300">Não há vagas abertas para receber este candidato.</p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Etapa inicial</label>
                <select
                  value={reactivationStage}
                  onChange={event => setReactivationStage(event.target.value as CandidateStatus)}
                  disabled={!reactivationOpeningId}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
                >
                  {reactivationStages.map(stage => (
                    <option key={stage.id} value={stage.id}>{stage.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-600">
                  O candidato pode voltar direto para triagem, entrevista ou outra etapa definida na vaga.
                </p>
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                <input
                  type="checkbox"
                  checked={reactivationReuseData}
                  onChange={event => setReactivationReuseData(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-950"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-200">Reaproveitar dados anteriores</span>
                  <span className="mt-0.5 block text-xs text-slate-500">Mantém currículo, respostas do formulário e histórico como base desta nova candidatura.</span>
                </span>
              </label>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Nota do reaproveitamento</label>
                <textarea
                  value={reactivationNote}
                  onChange={event => setReactivationNote(event.target.value)}
                  rows={3}
                  placeholder="Ex: Retomar pela entrevista com liderança."
                  className="w-full resize-none rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              {reactivationError && <ErrorLine msg={reactivationError} />}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReactivationTarget(null)}
                  className="rounded-xl px-4 py-2 text-sm text-slate-400 hover:bg-slate-900 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleReactivate(reactivationTarget, reactivationOpeningId)}
                  disabled={!reactivationOpeningId || !!reactivating}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {reactivating === reactivationTarget.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Reativar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RecruitmentFormsView ────────────────────────────────────────────────────

function RecruitmentFormsView({ getToken, canManage }: {
  getToken: () => Promise<string>;
  canManage: boolean;
}) {
  const [form, setForm] = useState<RecruitmentFormConfig>(DEFAULT_TALENT_POOL_FORM);
  const [questionDraft, setQuestionDraft] = useState(EMPTY_QUESTION_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const activeQuestionCount = form.questions.filter(question => question.active !== false).length;

  const loadForm = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/hr/recruitment/forms/talent-pool', getToken);
      setForm(data as RecruitmentFormConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar formulário.');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { loadForm(); }, [loadForm]);

  const updateQuestion = (questionId: string, patch: Partial<HrFormQuestion>) => {
    setForm(prev => ({
      ...prev,
      questions: prev.questions.map(question => question.id === questionId ? { ...question, ...patch } : question),
    }));
  };

  const updateQuestionOptions = (questionId: string, optionsText: string) => {
    const options = optionsText
      .split('\n')
      .map(option => option.trim())
      .filter(Boolean);
    setForm(prev => ({
      ...prev,
      questions: prev.questions.map(question => {
        if (question.id !== questionId) return question;
        return {
          ...question,
          config: {
            ...(question.config ?? {}),
            options,
          },
        };
      }),
    }));
  };

  const removeQuestion = (questionId: string) => {
    setForm(prev => ({ ...prev, questions: prev.questions.filter(question => question.id !== questionId) }));
  };

  const moveQuestion = (questionId: string, direction: -1 | 1) => {
    setForm(prev => {
      const index = prev.questions.findIndex(question => question.id === questionId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.questions.length) return prev;
      const next = [...prev.questions];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return { ...prev, questions: next };
    });
  };

  const addQuestion = () => {
    const text = questionDraft.text.trim();
    if (!text) return;
    const options = questionDraft.optionsText
      .split('\n')
      .map(option => option.trim())
      .filter(Boolean);
    if ((questionDraft.type === 'select' || questionDraft.type === 'multi_select') && options.length === 0) {
      setError('Informe ao menos uma opção para campos de seleção.');
      return;
    }

    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `question-${Date.now()}`;
    setForm(prev => ({
      ...prev,
      questions: [
        ...prev.questions,
        {
          id,
          text,
          type: questionDraft.type,
          required: questionDraft.required,
          active: true,
          scored: false,
          weight: 'medium',
          eliminatory: questionDraft.eliminatory,
          tags: ['talent_pool'],
          config: options.length > 0 ? { options } : undefined,
        },
      ],
    }));
    setQuestionDraft(EMPTY_QUESTION_DRAFT);
    setError(null);
  };

  const saveForm = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await apiFetch('/api/hr/recruitment/forms/talent-pool', getToken, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      setForm(saved as RecruitmentFormConfig);
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar formulário.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Formulário público</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">Banco de talentos</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Os campos abaixo aparecem em <span className="font-semibold text-slate-700">vagas.coalashakes.com/banco-de-talentos</span>, dentro do design público do site.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`${PUBLIC_RECRUITMENT_URL}/banco-de-talentos`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <ExternalLink className="h-4 w-4" /> Ver no site
            </a>
            {canManage && (
              <button
                type="button"
                onClick={saveForm}
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Salvar alterações
              </button>
            )}
          </div>
        </div>

        {error ? <div className="mt-4"><ErrorLine msg={error} /></div> : null}
        {savedAt ? (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            Formulário atualizado em {new Date(savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
          </p>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-950">Textos do formulário</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Título</label>
                <input
                  value={form.title}
                  onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))}
                  disabled={!canManage}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Descrição</label>
                <textarea
                  value={form.description ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, description: event.target.value }))}
                  disabled={!canManage}
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Texto LGPD</label>
                <textarea
                  value={form.consentText ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, consentText: event.target.value }))}
                  disabled={!canManage}
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Texto do botão</label>
                <input
                  value={form.submitLabel ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, submitLabel: event.target.value }))}
                  disabled={!canManage}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={form.status === 'published'}
                  onChange={event => setForm(prev => ({ ...prev, status: event.target.checked ? 'published' : 'draft' }))}
                  disabled={!canManage}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Usar esta versão no site
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-950">Campos fixos</h3>
            <p className="mt-1 text-xs text-slate-500">Esses campos sempre aparecem para proteger o fluxo público.</p>
            <div className="mt-4 space-y-2">
              {['Nome completo', 'E-mail', 'Telefone / WhatsApp', 'Currículo', 'Consentimento LGPD'].map(item => (
                <div key={item} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950">Campos complementares</h3>
                <p className="mt-1 text-xs text-slate-500">Esses campos aparecem abaixo dos dados básicos no site público.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">
                {activeQuestionCount}/{form.questions.length} visíveis
              </span>
            </div>

            <div className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-100">
              {form.questions.map((question, index) => (
                <div key={question.id} className={`grid gap-3 p-4 md:grid-cols-[1fr_160px_auto] md:items-start ${question.active === false ? 'bg-slate-50/70 opacity-75' : ''}`}>
                  <div>
                    {question.active === false && (
                      <span className="mb-2 inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Oculto no site
                      </span>
                    )}
                    <input
                      value={question.text}
                      onChange={event => updateQuestion(question.id, { text: event.target.value })}
                      disabled={!canManage}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-950 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                    />
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={question.required}
                          onChange={event => updateQuestion(question.id, { required: event.target.checked })}
                          disabled={!canManage}
                        />
                        Obrigatório
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={question.active !== false}
                          onChange={event => updateQuestion(question.id, { active: event.target.checked })}
                          disabled={!canManage}
                        />
                        Exibir no site
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={question.eliminatory}
                          onChange={event => updateQuestion(question.id, { eliminatory: event.target.checked })}
                          disabled={!canManage}
                        />
                        Eliminatório
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={question.config?.multiline === true}
                          onChange={event => updateQuestion(question.id, {
                            config: { ...(question.config ?? {}), multiline: event.target.checked },
                          })}
                          disabled={!canManage || question.type !== 'text'}
                        />
                        Texto longo
                      </label>
                    </div>
                    {(question.type === 'select' || question.type === 'multi_select') && (
                      question.config?.source === 'public_units' ? (
                        <p className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
                          Opções atualizadas automaticamente pelas unidades ativas do site público.
                        </p>
                      ) : (
                        <textarea
                          value={Array.isArray(question.config?.options) ? question.config.options.join('\n') : ''}
                          onChange={event => updateQuestionOptions(question.id, event.target.value)}
                          disabled={!canManage}
                          rows={3}
                          placeholder={'Opções, uma por linha\nSim\nNão\nTalvez'}
                          className="mt-3 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                        />
                      )
                    )}
                  </div>
                  <select
                    value={question.type}
                    onChange={event => updateQuestion(question.id, { type: event.target.value as HrFormQuestion['type'] })}
                    disabled={!canManage}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                  >
                    {QUESTION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" disabled={!canManage || index === 0} onClick={() => moveQuestion(question.id, -1)}
                      className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30">Subir</button>
                    <button type="button" disabled={!canManage || index === form.questions.length - 1} onClick={() => moveQuestion(question.id, 1)}
                      className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30">Descer</button>
                    <button type="button" disabled={!canManage} onClick={() => removeQuestion(question.id)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {canManage && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-950">Adicionar campo</h3>
              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_160px]">
                <input
                  value={questionDraft.text}
                  onChange={event => setQuestionDraft(prev => ({ ...prev, text: event.target.value }))}
                  placeholder="Ex: Tem disponibilidade aos domingos?"
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10"
                />
                <select
                  value={questionDraft.type}
                  onChange={event => setQuestionDraft(prev => ({ ...prev, type: event.target.value as HrFormQuestion['type'] }))}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10"
                >
                  {QUESTION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
                {(questionDraft.type === 'select' || questionDraft.type === 'multi_select') && (
                  <textarea
                    value={questionDraft.optionsText}
                    onChange={event => setQuestionDraft(prev => ({ ...prev, optionsText: event.target.value }))}
                    rows={3}
                    placeholder={'Opções, uma por linha\nSim\nNão\nTalvez'}
                    className="resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 md:col-span-2"
                  />
                )}
                <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={questionDraft.required}
                      onChange={event => setQuestionDraft(prev => ({ ...prev, required: event.target.checked }))}
                    />
                    Obrigatório
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={questionDraft.eliminatory}
                      onChange={event => setQuestionDraft(prev => ({ ...prev, eliminatory: event.target.checked }))}
                    />
                    Eliminatório
                  </label>
                  <button
                    type="button"
                    onClick={addQuestion}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-4 w-4" /> Adicionar campo
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── OnboardingView ──────────────────────────────────────────────────────────

const ONBOARDING_STATUS_LABELS: Record<OnboardingProcess['status'], string> = {
  pending_setup: 'Pendente',
  collecting_documents: 'Coletando documentos',
  reviewing_documents: 'Conferindo documentos',
  contract_pending: 'Contrato pendente',
  ready_to_create_user: 'Criar colaborador',
  active: 'Em andamento',
  completed: 'Finalizado',
  cancelled: 'Cancelado',
};

const ONBOARDING_DOCUMENT_STATUS_LABELS: Record<OnboardingDocument['status'], string> = {
  pending: 'Pendente',
  received: 'Recebido',
  approved: 'Aprovado',
  rejected: 'Recusado',
};

function OnboardingView({ processes, getToken, canManage, onRefresh }: {
  processes: OnboardingProcess[];
  getToken: () => Promise<string>;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeProcesses = processes.filter(process => process.status !== 'cancelled');
  const filtered = activeProcesses.filter(process => {
    const text = [
      process.candidateName,
      process.candidateEmail,
      process.jobRoleName,
      process.functionName,
      process.unitName,
    ].filter(Boolean).join(' ').toLowerCase();
    return !search || text.includes(search.toLowerCase());
  });
  const completed = processes.filter(process => process.status === 'completed').length;
  const pendingCodes = activeProcesses.filter(process =>
    (process.integrationAlerts ?? []).some(alert => alert.status === 'pending')
  ).length;
  const docsPending = activeProcesses.reduce((sum, process) =>
    sum + (process.documents ?? []).filter(document => document.required !== false && document.status !== 'approved').length,
    0
  );

  async function patchProcess(processId: string, body: Record<string, unknown>) {
    setUpdating(`${processId}:${body.action ?? 'update'}`);
    setError(null);
    try {
      await apiFetch(`/api/hr/onboarding/${processId}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar onboarding.');
    } finally {
      setUpdating(null);
    }
  }

  function processDocProgress(process: OnboardingProcess) {
    const documents = process.documents ?? [];
    if (documents.length === 0) return { approved: 0, total: 0, percent: 0 };
    const required = documents.filter(document => document.required !== false);
    const base = required.length > 0 ? required : documents;
    const approved = base.filter(document => document.status === 'approved').length;
    return {
      approved,
      total: base.length,
      percent: base.length > 0 ? Math.round((approved / base.length) * 100) : 0,
    };
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Em onboarding</p>
          <p className="text-3xl font-bold text-slate-950">{activeProcesses.filter(process => process.status !== 'completed').length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Documentos pendentes</p>
          <p className="text-3xl font-bold text-slate-950">{docsPending}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Alertas de integração</p>
          <p className="text-3xl font-bold text-slate-950">{pendingCodes}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Finalizados</p>
          <p className="text-3xl font-bold text-slate-950">{completed}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-3 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar candidato, cargo ou unidade..."
            className="w-80 rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Atualizar
        </button>
      </div>

      {error && <ErrorLine msg={error} />}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">Nenhum onboarding em andamento.</p>
          <p className="mt-1 text-xs text-slate-400">Candidatos aprovados para contratação aparecem aqui.</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map(process => {
            const progress = processDocProgress(process);
            const currentStage = (process.stages ?? []).find(stage => stage.id === process.currentStage);
            const pendingAlerts = (process.integrationAlerts ?? []).filter(alert => alert.status === 'pending');
            const canCreateCollaborator = canManage && !process.collaboratorUserId && process.status !== 'cancelled' && process.status !== 'completed';
            const canComplete = canManage && !!process.collaboratorUserId && process.status !== 'completed' && process.status !== 'cancelled';

            return (
              <div key={process.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          {ONBOARDING_STATUS_LABELS[process.status] ?? process.status}
                        </span>
                        {currentStage && (
                          <span className="rounded-full bg-pink-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-pink-600">
                            {currentStage.label}
                          </span>
                        )}
                      </div>
                      <h2 className="mt-3 truncate text-lg font-bold text-slate-950">{process.candidateName ?? 'Candidato sem nome'}</h2>
                      <p className="mt-1 truncate text-sm text-slate-500">{process.candidateEmail ?? 'E-mail não informado'}</p>
                      <p className="mt-2 text-sm font-medium text-slate-700">
                        {process.jobRoleName ?? 'Cargo não informado'}
                        {process.functionName ? ` | ${process.functionName}` : ''}
                        {process.unitName ? ` · ${process.unitName}` : ''}
                      </p>
                    </div>
                    <div className="text-left md:text-right">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Documentos</p>
                      <p className="mt-1 text-2xl font-bold text-slate-950">{progress.approved}/{progress.total}</p>
                      <div className="mt-2 h-2 w-36 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress.percent}%` }} />
                      </div>
                    </div>
                  </div>

                  {(process.stages ?? []).length > 0 && (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {(process.stages ?? []).map(stage => (
                        <button
                          key={stage.id}
                          type="button"
                          disabled={!canManage || updating === `${process.id}:advance_stage`}
                          onClick={() => patchProcess(process.id, { action: 'advance_stage', currentStage: stage.id })}
                          className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                            process.currentStage === stage.id
                              ? 'border-slate-950 bg-slate-950 text-white'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-950'
                          } disabled:opacity-50`}
                        >
                          {stage.label}
                          {stage.dueDays ? <span className="ml-1 text-[10px] opacity-70">{stage.dueDays}d</span> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid gap-4 p-5 lg:grid-cols-[1.2fr_0.8fr]">
                  <div>
                    <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Documentação</p>
                    <div className="space-y-2">
                      {(process.documents ?? []).map(document => {
                        const actionKey = `${process.id}:document_status`;
                        return (
                          <div key={document.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">
                                  {document.label}
                                  {document.required !== false && <span className="ml-1 text-pink-500">*</span>}
                                </p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {ONBOARDING_DOCUMENT_STATUS_LABELS[document.status] ?? document.status}
                                </p>
                                {document.fileUrl ? (
                                  <a
                                    href={document.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500"
                                  >
                                    <ExternalLink className="h-3 w-3" /> Ver arquivo enviado
                                  </a>
                                ) : null}
                              </div>
                              {canManage && (
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    disabled={updating === actionKey}
                                    onClick={() => patchProcess(process.id, { action: 'document_status', documentId: document.id, status: 'received' })}
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-950 disabled:opacity-50"
                                  >
                                    Recebido
                                  </button>
                                  <button
                                    type="button"
                                    disabled={updating === actionKey}
                                    onClick={() => patchProcess(process.id, { action: 'document_status', documentId: document.id, status: 'approved' })}
                                    className="rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                                  >
                                    Aprovar
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {(process.documents ?? []).length === 0 && (
                        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                          Nenhum documento configurado para este onboarding.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Integrações</p>
                      <div className="space-y-2">
                        {pendingAlerts.length > 0 ? pendingAlerts.map(alert => (
                          <div key={alert.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                            <p className="text-sm font-bold text-amber-800">{alert.label}</p>
                            <p className="mt-1 text-xs text-amber-700">{alert.message ?? 'Pendente de preenchimento.'}</p>
                          </div>
                        )) : (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                            <p className="text-sm font-bold text-emerald-800">Sem alertas pendentes</p>
                            <p className="mt-1 text-xs text-emerald-700">Bizneo e PDV Legal podem ser conferidos no perfil do colaborador.</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Rastreio</p>
                      <p className="mt-2 text-xs text-slate-500">ID do onboarding</p>
                      <p className="truncate text-sm font-mono text-slate-700">{process.id}</p>
                      {process.jobOpeningId && (
                        <>
                          <p className="mt-2 text-xs text-slate-500">Vaga de origem</p>
                          <p className="truncate text-sm font-mono text-slate-700">{process.jobOpeningId}</p>
                        </>
                      )}
                      {process.publicToken ? (
                        <>
                          <p className="mt-3 text-xs text-slate-500">Formulário público</p>
                          <a
                            href={`${PUBLIC_RECRUITMENT_URL}/onboarding/${process.publicToken}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Abrir formulário do candidato
                          </a>
                          {process.publicFormSubmittedAt ? (
                            <p className="mt-2 text-xs text-emerald-700">
                              Enviado em {new Date(process.publicFormSubmittedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </p>
                          ) : null}
                        </>
                      ) : null}
                    </div>

                    {canManage && (
                      <div className="flex flex-col gap-2">
                        {canCreateCollaborator && (
                          <button
                            type="button"
                            disabled={updating === `${process.id}:create_collaborator`}
                            onClick={() => patchProcess(process.id, { action: 'create_collaborator' })}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            {updating === `${process.id}:create_collaborator` ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                            Criar colaborador
                          </button>
                        )}
                        {canComplete && (
                          <button
                            type="button"
                            disabled={updating === `${process.id}:complete`}
                            onClick={() => patchProcess(process.id, { action: 'complete' })}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            {updating === `${process.id}:complete` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Finalizar onboarding
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── RecruitmentPage ──────────────────────────────────────────────────────────

export default function RecruitmentPage() {
  const { firebaseUser, permissions, loading: authLoading } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [functions, setFunctions] = useState<JobFunction[]>([]);
  const [units, setUnits] = useState<DPUnit[]>([]);
  const [shiftDefinitions, setShiftDefinitions] = useState<DPShiftDefinition[]>([]);
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [onboardingProcesses, setOnboardingProcesses] = useState<OnboardingProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View mode: kanban | list (triagem) | openings (por vaga) | talents | forms | onboarding
  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'openings' | 'talents' | 'forms' | 'onboarding'>('kanban');

  // Pipeline filters
  const [search, setSearch] = useState('');
  const [filterOpening, setFilterOpening] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterRating, setFilterRating] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<CandidateStatus>>(new Set());

  // Modals
  const [showNewModal, setShowNewModal] = useState(false);
  const [detailCandidate, setDetailCandidate] = useState<Candidate | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Candidate | null>(null);

  // DnD
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const canView =
    !!(permissions.recruitment?.view || permissions.recruitment?.pipeline?.view ||
      permissions.dp?.view || permissions.dp?.collaborators?.view ||
      permissions.dp?.collaborators?.edit || permissions.settings?.manageUsers);
  const canManage =
    !!(permissions.recruitment?.manage || permissions.recruitment?.pipeline?.manage ||
      permissions.dp?.collaborators?.edit || permissions.settings?.manageUsers);

  const getToken = useCallback(async () => (await firebaseUser?.getIdToken()) ?? '', [firebaseUser]);

  const loadData = useCallback(async () => {
    if (authLoading || !firebaseUser || !canView) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const [candidatesRes, rolesRes, openingsRes, onboardingRes] = await Promise.all([
        fetch('/api/hr/candidates', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetchHrBootstrap(firebaseUser),
        fetch('/api/hr/openings', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch('/api/hr/onboarding', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      ]);
      setCandidates(candidatesRes as Candidate[]);
      setRoles(rolesRes.roles);
      setFunctions(rolesRes.functions ?? []);
      setUnits(rolesRes.units ?? []);
      setShiftDefinitions(rolesRes.shiftDefinitions ?? []);
      setOpenings(openingsRes as JobOpening[]);
      setOnboardingProcesses(Array.isArray(onboardingRes?.processes) ? onboardingRes.processes as OnboardingProcess[] : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar.');
    } finally {
      setLoading(false);
    }
  }, [authLoading, firebaseUser, canView, getToken]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Filters ────────────────────────────────────────────────────────────────

  const locationOptions = useMemo(() => {
    const locs = new Set<string>();
    candidates.forEach(c => {
      const o = openings.find(op => op.id === c.jobOpeningId);
      if (o?.location) locs.add(o.location);
    });
    return Array.from(locs).sort();
  }, [candidates, openings]);

  const sourceOptions = useMemo(() => {
    const srcs = new Set<string>();
    candidates.forEach(c => { if (c.source) srcs.add(c.source); });
    return Array.from(srcs).sort();
  }, [candidates]);

  const filtered = useMemo(() => {
    return candidates.filter(c => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase()) &&
          !c.email.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterOpening && c.jobOpeningId !== filterOpening) return false;
      if (filterLocation) {
        const op = openings.find(o => o.id === c.jobOpeningId);
        if (!op || op.location !== filterLocation) return false;
      }
      if (filterSource && c.source !== filterSource) return false;
      if (filterRating) {
        if ((c.rating ?? 0) < Number(filterRating)) return false;
      }
      return true;
    });
  }, [candidates, openings, search, filterOpening, filterLocation, filterSource, filterRating]);

  const pipelineCandidates = useMemo(() =>
    filtered.filter(c => PIPELINE_STATUSES.includes(c.status)), [filtered]);

  const archivedCandidates = useMemo(() =>
    filtered.filter(c => ARCHIVED_STATUSES.includes(c.status)), [filtered]);

  const selectedOpening = useMemo(() =>
    filterOpening ? openings.find(o => o.id === filterOpening) ?? null : null,
    [filterOpening, openings]
  );

  const selectedOpeningRole = useMemo(() => {
    if (!selectedOpening) return null;
    return roles.find(role => role.id === selectedOpening.jobRoleId) ?? null;
  }, [roles, selectedOpening]);

  const selectedOpeningPipelineStages = useMemo(
    () => normalizeRecruitmentStages(selectedOpening?.pipelineStages),
    [selectedOpening]
  );
  const visiblePipelineStages = selectedOpening ? selectedOpeningPipelineStages : normalizeRecruitmentStages(null);

  const selectedOpeningCandidates = useMemo(() =>
    selectedOpening ? candidates.filter(c => c.jobOpeningId === selectedOpening.id) : [],
    [candidates, selectedOpening]
  );

  const selectedOpeningStatusCounts = useMemo(() => {
    const counts = Object.fromEntries(ALL_STATUSES.map(status => [status, 0])) as Record<CandidateStatus, number>;
    selectedOpeningCandidates.forEach(candidate => {
      counts[candidate.status] += 1;
    });
    return counts;
  }, [selectedOpeningCandidates]);

  const stats = useMemo(() => {
    const now = Date.now();
    const openOpenings = openings.filter(opening => opening.status === 'open').length;
    const totalOpenings = openings.length;
    const applied = candidates.filter(c => c.status === 'applied').length;
    const screening = candidates.filter(c => c.status === 'screening').length;
    const hired = candidates.filter(c => c.status === 'hired').length;
    const rejected = candidates.filter(c => c.status === 'rejected').length;
    const talentPool = candidates.filter(c => c.status === TALENT_POOL_STATUS || c.source === 'talent_pool').length;
    const pipeline = candidates.filter(c => PIPELINE_STATUSES.includes(c.status));
    const avgDays = pipeline.length > 0
      ? Math.round(pipeline.reduce((sum, c) =>
          sum + (now - new Date(c.appliedAt).getTime()), 0) / pipeline.length / MS_DAY)
      : 0;
    const hiredWithDates = candidates.filter(c => c.status === 'hired');
    const avgHiringDays = hiredWithDates.length > 0
      ? Math.round(hiredWithDates.reduce((sum, candidate) => {
          const start = safeDateTime(candidate.appliedAt) ?? now;
          const end = safeDateTime(candidate.hiredAt) ?? safeDateTime(candidate.updatedAt) ?? now;
          return sum + Math.max(0, end - start);
        }, 0) / hiredWithDates.length / MS_DAY)
      : 0;
    const conversionBase = hired + rejected;
    const conversionRate = conversionBase > 0 ? Math.round((hired / conversionBase) * 100) : 0;
    const overdueCandidates = pipeline.filter(candidate => {
      const opening = openings.find(item => item.id === candidate.jobOpeningId);
      const stage = normalizeRecruitmentStages(opening?.pipelineStages).find(item => item.id === candidate.status);
      return getCandidateStageTiming(candidate, stage, now).isOverdue;
    }).length;
    const delayedOpenings = openings.filter(opening => {
      if (opening.status !== 'open' || !opening.applicationEndAt) return false;
      const end = safeDateTime(opening.applicationEndAt);
      return end !== null && end < now;
    }).length;
    // Sparkline: candidates applied per day for last 7 days
    const sparkData = Array.from({ length: 7 }, (_, i) => {
      const dayStart = now - (6 - i) * MS_DAY;
      const dayEnd = dayStart + MS_DAY;
      return candidates.filter(c => {
        const t = new Date(c.appliedAt).getTime();
        return t >= dayStart && t < dayEnd;
      }).length;
    });
    // Trend: this week vs last week
    const thisWeekApplied = candidates.filter(c =>
      (now - new Date(c.appliedAt).getTime()) < 7 * MS_DAY
    ).length;
    const lastWeekApplied = candidates.filter(c => {
      const age = now - new Date(c.appliedAt).getTime();
      return age >= 7 * MS_DAY && age < 14 * MS_DAY;
    }).length;
    const appliedTrend = lastWeekApplied > 0
      ? Math.round(((thisWeekApplied - lastWeekApplied) / lastWeekApplied) * 100)
      : thisWeekApplied > 0 ? 100 : 0;
    const hiredThisMonth = candidates.filter(c =>
      c.status === 'hired' && (now - new Date(c.updatedAt).getTime()) < 30 * MS_DAY
    ).length;
    return {
      applied,
      screening,
      hired,
      rejected,
      avgDays,
      avgHiringDays,
      sparkData,
      appliedTrend,
      hiredThisMonth,
      openOpenings,
      totalOpenings,
      talentPool,
      pipeline: pipeline.length,
      overdueCandidates,
      delayedOpenings,
      conversionRate,
    };
  }, [candidates, openings]);

  // ── DnD handlers ──────────────────────────────────────────────────────────

  const activeDragCandidate = activeDragId
    ? candidates.find(c => c.id === activeDragId)
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const newStatus = over.id as CandidateStatus;
    if (!ALL_STATUSES.includes(newStatus)) return;

    const candidate = candidates.find(c => c.id === active.id);
    if (!candidate || candidate.status === newStatus) return;
    const now = new Date().toISOString();
    const historyEntry = createCandidateStageHistoryEntry({
      fromStatus: candidate.status,
      toStatus: newStatus,
      action: newStatus === 'hired' ? 'hired' : 'status_changed',
      actorId: null,
      actorEmail: null,
      createdAt: now,
    });

    // Optimistic update
    setCandidates(prev => prev.map(c =>
      c.id === candidate.id
        ? {
            ...c,
            status: newStatus,
            updatedAt: now,
            hiredAt: newStatus === 'hired' ? c.hiredAt ?? now : c.hiredAt,
            recruitmentHistory: [...(c.recruitmentHistory ?? []), historyEntry],
            latestApplication: c.latestApplication
              ? {
                  ...c.latestApplication,
                  stage: newStatus,
                  stageHistory: [...(c.latestApplication.stageHistory ?? []), historyEntry],
                }
              : c.latestApplication,
          }
        : c
    ));

    try {
      const result = await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify({
          status: newStatus,
          decisionAction: newStatus === 'hired' ? 'hired' : 'status_changed',
        }),
      });
      const onboardingId = typeof result?.onboardingId === 'string' ? result.onboardingId : undefined;
      if (onboardingId) {
        setCandidates(prev => prev.map(c =>
          c.id === candidate.id
            ? {
                ...c,
                onboardingId,
                latestApplication: c.latestApplication
                  ? { ...c.latestApplication, onboardingId }
                  : c.latestApplication,
              }
            : c
        ));
        void loadData();
      }
    } catch {
      // Rollback
      setCandidates(prev => prev.map(c =>
        c.id === candidate.id ? { ...c, status: candidate.status } : c
      ));
    }
  };

  // ── Event handlers ─────────────────────────────────────────────────────────

  const handleUpdated = (updated: Candidate) => {
    setCandidates(prev => prev.map(c => c.id === updated.id ? updated : c));
    setDetailCandidate(updated);
    if (updated.status === 'hired') void loadData();
  };

  const handleDeleted = (id: string) => {
    setCandidates(prev => prev.filter(c => c.id !== id));
    setDetailCandidate(null);
    setDeleteCandidate(null);
  };

  const handleOpeningsFilterFromTab = (openingId: string) => {
    setViewMode('kanban');
    setFilterOpening(openingId);
  };

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (authLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!canView) {
    return <p className="text-slate-400 p-6">Sem permissão para acessar Recrutamento.</p>;
  }

  if (error) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-slate-400">{error}</p>
        <button onClick={loadData} className="text-sm text-indigo-400 hover:text-indigo-300">Tentar novamente</button>
      </div>
    );
  }

  const activeFilters = [filterOpening, filterLocation, filterSource, filterRating].filter(Boolean).length;

  const FUNNEL_COLORS: Record<string, string> = {
    applied: 'bg-blue-500',
    screening: 'bg-indigo-500',
    interview: 'bg-purple-500',
    technical_test: 'bg-pink-500',
    offer: 'bg-amber-500',
    hired: 'bg-green-500',
  };

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col space-y-5 rounded-[28px] border border-white/70 bg-white/85 p-4 text-slate-900 shadow-sm backdrop-blur md:p-5">

      {/* ─── Header ─── */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-400">Pipeline</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">Recrutamento</h1>
          <p className="text-slate-500 mt-1 text-sm">
            {candidates.length} candidato{candidates.length !== 1 ? 's' : ''} ·{' '}
            {openings.filter(o => o.status === 'open').length} vaga{openings.filter(o => o.status === 'open').length !== 1 ? 's' : ''} aberta{openings.filter(o => o.status === 'open').length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-50 p-1">
            {(['kanban', 'list', 'openings', 'talents', 'forms', 'onboarding'] as const).map((mode) => {
              const labels: Record<string, string> = {
                kanban: 'Kanban',
                list: 'Triagem',
                openings: 'Por vaga',
                talents: 'Talentos',
                forms: 'Formulários',
                onboarding: 'Onboarding',
              };
              return (
                <button key={mode} onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    viewMode === mode ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}>
                  {labels[mode]}
                </button>
              );
            })}
            <a href={PUBLIC_RECRUITMENT_URL} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-900 transition-all">
              <Globe className="h-3.5 w-3.5" />
              Página pública
            </a>
          </div>

          {/* CTA */}
          {canManage && viewMode !== 'openings' && viewMode !== 'talents' && viewMode !== 'forms' && viewMode !== 'onboarding' && (
            <button onClick={() => setShowNewModal(true)}
              className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800">
              <UserPlus className="h-4 w-4" />
              Novo candidato
            </button>
          )}
        </div>
      </div>

      {/* ─── Stats row ─── */}
      {(viewMode === 'list' || viewMode === 'kanban') && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Vagas abertas</p>
            <p className="text-3xl font-bold leading-none text-slate-950">{stats.openOpenings}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">{stats.totalOpenings} no total</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Inscritos</p>
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-3xl font-bold leading-none text-slate-950">{stats.applied}</p>
                {stats.appliedTrend !== 0 && (
                  <span className={`mt-1 flex items-center gap-0.5 text-xs font-bold ${stats.appliedTrend > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                      {stats.appliedTrend > 0
                        ? <path d="M4 1L7 6H1L4 1Z" />
                        : <path d="M4 7L7 2H1L4 7Z" />}
                    </svg>
                    {Math.abs(stats.appliedTrend)}%
                  </span>
                )}
              </div>
              <svg width="48" height="28" className="flex-shrink-0 text-indigo-400">
                {stats.sparkData.map((v, i) => {
                  const max = Math.max(...stats.sparkData, 1);
                  const bh = Math.max((v / max) * 24, 2);
                  return (
                    <rect key={i} x={i * 7} y={28 - bh} width={5} height={bh}
                      rx="1" fill="currentColor" opacity={0.3 + 0.7 * (v / max)} />
                  );
                })}
              </svg>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">No funil</p>
            <p className="text-3xl font-bold leading-none text-slate-950">{stats.pipeline}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">{stats.screening} em triagem</p>
          </div>

          <div className={`rounded-2xl border p-4 ${stats.overdueCandidates > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
            <p className={`mb-3 text-[11px] font-bold uppercase tracking-wider ${stats.overdueCandidates > 0 ? 'text-red-500' : 'text-slate-500'}`}>Em atraso</p>
            <p className={`text-3xl font-bold leading-none ${stats.overdueCandidates > 0 ? 'text-red-700' : 'text-slate-950'}`}>{stats.overdueCandidates}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">{stats.delayedOpenings} vaga{stats.delayedOpenings !== 1 ? 's' : ''} com inscrição vencida</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Contratados</p>
            <p className="text-3xl font-bold leading-none text-slate-950">{stats.hired}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">{stats.conversionRate}% de conversão</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Banco talentos</p>
            <p className="text-3xl font-bold leading-none text-slate-950">{stats.talentPool}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">Fechamento médio: {stats.avgHiringDays}d</p>
          </div>
        </div>
      )}

      {/* ─── Funnel ─── */}
      {viewMode === 'list' && candidates.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-4">Funil de conversão</h3>
          {/* Stage labels + counts */}
          <div className="flex mb-3">
            {PIPELINE_STATUSES.map(status => {
              const count = candidates.filter(c => c.status === status).length;
              const cfg = STATUS_CONFIG[status];
              return (
                <div key={status} style={{ flex: 1 }} className="text-center min-w-0 px-1">
                  <p className="text-base font-bold text-slate-950 leading-none mb-1">{count}</p>
                  <p className="text-[10px] text-slate-500 truncate">{cfg.label}</p>
                </div>
              );
            })}
          </div>
          {/* Bar */}
          <div className="flex h-5 gap-0.5 rounded-lg overflow-hidden">
            {PIPELINE_STATUSES.map(status => {
              const count = candidates.filter(c => c.status === status).length;
              const total = candidates.filter(c => PIPELINE_STATUSES.includes(c.status)).length;
              const flex = total > 0 ? Math.max(count, 0.15) : 1;
              return (
                <div
                  key={status}
                  style={{ flex }}
                  className={`${FUNNEL_COLORS[status] ?? 'bg-slate-700'} rounded-sm`}
                  title={`${STATUS_CONFIG[status].label}: ${count}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Pipeline filters ─── */}
      {viewMode !== 'openings' && viewMode !== 'talents' && viewMode !== 'forms' && viewMode !== 'onboarding' && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-3 shadow-sm">
          <div className="mr-2 hidden items-center gap-2 border-r border-slate-100 pr-3 text-sm font-semibold text-slate-950 md:flex">
            <Kanban className="h-4 w-4 text-slate-500" />
            Board
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar candidato e e-mail…"
              className="w-64 rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
          </div>

          {openings.length > 0 && (
            <select value={filterOpening} onChange={e => setFilterOpening(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">Todas as vagas</option>
              {openings.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
          )}

          {locationOptions.length > 0 && (
            <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">Todas unidades</option>
              {locationOptions.map(loc => <option key={loc} value={loc}>{loc}</option>)}
            </select>
          )}

          {sourceOptions.length > 0 && (
            <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">Todas origens</option>
              {sourceOptions.map(src => <option key={src} value={src}>{src}</option>)}
            </select>
          )}

          <select value={filterRating} onChange={e => setFilterRating(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
            <option value="">Avaliação</option>
            <option value="1">1+ estrela</option>
            <option value="2">2+ estrelas</option>
            <option value="3">3+ estrelas</option>
            <option value="4">4+ estrelas</option>
            <option value="5">5 estrelas</option>
          </select>

          {activeFilters > 0 && (
            <button
              onClick={() => { setFilterOpening(''); setFilterLocation(''); setFilterSource(''); setFilterRating(''); setSearch(''); }}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:border-slate-300 hover:text-slate-950">
              <X className="h-3 w-3" /> Limpar filtros
            </button>
          )}
          <button
            type="button"
            className="ml-auto flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
          </button>
        </div>
      )}

      {viewMode !== 'openings' && viewMode !== 'talents' && viewMode !== 'forms' && viewMode !== 'onboarding' && selectedOpening && (
        <div className="rounded-2xl border border-pink-100 bg-pink-50/60 p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-pink-600 ring-1 ring-pink-100">
                  Processo seletivo
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {selectedOpening.location || 'Unidade não informada'}
                </span>
              </div>
              <h2 className="mt-2 text-lg font-bold text-slate-950">{selectedOpening.title}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {selectedOpeningRole?.name ?? selectedOpening.jobRoleName ?? 'Cargo não informado'} ·{' '}
                {selectedOpening.slots} vaga{selectedOpening.slots !== 1 ? 's' : ''} ·{' '}
                {selectedOpeningCandidates.length} candidato{selectedOpeningCandidates.length !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedOpeningPipelineStages.map(stage => {
                const cfg = STATUS_CONFIG[stage.id];
                return (
                  <span key={stage.id} className="rounded-xl border border-white bg-white/80 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm">
                    <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${cfg.color}`} />
                    {stage.label}: {selectedOpeningStatusCounts[stage.id]}
                  </span>
                );
              })}
              {selectedOpening.status === 'open' && (
                <a
                  href={`${PUBLIC_RECRUITMENT_URL}/${selectedOpening.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:text-slate-950"
                >
                  Ver vaga pública
                </a>
              )}
              <button
                type="button"
                onClick={() => setFilterOpening('')}
                className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                Ver todas as vagas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Kanban ─── */}
      {viewMode === 'kanban' && (
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-h-0">
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex gap-4 overflow-x-auto rounded-2xl bg-slate-50/80 p-3 pb-4 custom-scrollbar">
              {visiblePipelineStages.map(stage => (
                <DroppableColumn
                  key={stage.id}
                  status={stage.id}
                  stage={stage}
                  candidates={pipelineCandidates.filter(c => c.status === stage.id)}
                  onCardOpen={setDetailCandidate}
                />
              ))}
            </div>
            <DragOverlay>
              {activeDragCandidate && (
                <div className="p-4 bg-slate-900 border border-indigo-500/50 rounded-xl shadow-2xl w-72 opacity-95">
                  <h4 className="font-bold text-white text-sm">{activeDragCandidate.name}</h4>
                  <p className="text-xs text-slate-400 mt-0.5">{activeDragCandidate.jobRoleName}</p>
                </div>
              )}
            </DragOverlay>
          </DndContext>

          {/* Archived */}
          {archivedCandidates.length > 0 && (
            <div>
              <button
                onClick={() => setShowArchived(p => !p)}
                className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-3">
                {showArchived ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <Archive className="h-3.5 w-3.5" />
                Arquivados ({archivedCandidates.length})
              </button>
              {showArchived && (
                <div className="flex gap-4 overflow-x-auto pb-2 custom-scrollbar">
                  {ARCHIVED_STATUSES.map(status => (
                    <DroppableColumn
                      key={status}
                      status={status}
                      candidates={archivedCandidates.filter(c => c.status === status)}
                      onCardOpen={setDetailCandidate}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── List / Triagem ─── */}
      {viewMode === 'list' && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {filtered.length === 0 && (
            <div className="py-16 text-center text-slate-600 text-sm">Nenhum candidato encontrado.</div>
          )}

          {filtered.length > 0 && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="grid grid-cols-[2rem_1fr_minmax(0,140px)_88px_80px_80px_2rem] items-center px-4 py-2.5 border-b border-slate-800 bg-slate-900/80">
                <span />
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Nome</span>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider hidden md:block">Cargo</span>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider hidden lg:block">Avaliação</span>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider hidden lg:block">Inscrição</span>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider hidden sm:block">Origem</span>
                <span />
              </div>

              {ALL_STATUSES.map(status => {
                const group = filtered.filter(c => c.status === status);
                if (group.length === 0) return null;
                const cfg = STATUS_CONFIG[status];
                const isCollapsed = collapsedGroups.has(status);
                const toggle = () => setCollapsedGroups(prev => {
                  const next = new Set(prev);
                  if (next.has(status)) next.delete(status); else next.add(status);
                  return next;
                });

                return (
                  <div key={status} className="border-b border-slate-800/60 last:border-b-0">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-900/60 hover:bg-slate-800/40 transition-colors">
                      <button onClick={toggle} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                        {isCollapsed
                          ? <ChevronRight className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                          : <ChevronDown className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />}
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.color}`} />
                        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">{cfg.label}</span>
                        <span className="text-xs text-slate-600 ml-1">{group.length}</span>
                      </button>
                      {canManage && (
                        <button
                          onClick={() => setShowNewModal(true)}
                          className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-indigo-400 transition-colors px-2 py-1 rounded-lg hover:bg-indigo-500/10">
                          <Plus className="h-3 w-3" /> Adicionar
                        </button>
                      )}
                    </div>

                    {!isCollapsed && group.map((candidate, rowIdx) => {
                      const sourceColor = candidate.source
                        ? (SOURCE_TAG_COLORS[candidate.source] ?? SOURCE_TAG_COLORS['Outro'])
                        : null;
                      return (
                        <div
                          key={candidate.id}
                          onClick={() => setDetailCandidate(candidate)}
                          className="grid grid-cols-[2rem_1fr_minmax(0,140px)_88px_80px_80px_2rem] items-center px-4 py-3 border-t border-slate-800/40 hover:bg-slate-800/30 transition-colors cursor-pointer group"
                        >
                          <span className="text-[11px] text-slate-700 font-mono select-none">{rowIdx + 1}</span>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white group-hover:text-indigo-300 transition-colors truncate leading-snug">
                                {candidate.name}
                              </p>
                              <p className="text-[11px] text-slate-500 truncate">{candidate.email}</p>
                            </div>
                            {candidate.resumeUrl && <Paperclip className="h-3 w-3 text-slate-600 flex-shrink-0" />}
                          </div>
                          <span className="text-xs text-slate-400 truncate hidden md:block">{candidate.jobRoleName ?? '—'}</span>
                          <div className="hidden lg:block"><RatingStars value={candidate.rating ?? 0} readonly /></div>
                          <span className="text-[11px] text-slate-500 hidden lg:block">
                            {new Date(candidate.appliedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                          </span>
                          <div className="hidden sm:block">
                            {sourceColor && candidate.source ? (
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border truncate max-w-[72px] block text-center ${sourceColor}`}>
                                {candidate.source}
                              </span>
                            ) : <span className="text-[11px] text-slate-700">—</span>}
                          </div>
                          <div onClick={e => e.stopPropagation()}>
                            {canManage ? (
                              <ListRowMenu
                                candidate={candidate}
                                onOpen={() => setDetailCandidate(candidate)}
                                onDelete={() => setDeleteCandidate(candidate)}
                              />
                            ) : (
                              <button onClick={() => setDetailCandidate(candidate)}
                                className="p-1.5 text-slate-600 hover:text-white">
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Por vaga ─── */}
      {viewMode === 'openings' && (
        <OpeningsView
          openings={openings}
          roles={roles}
          functions={functions}
          units={units}
          shiftDefinitions={shiftDefinitions}
          candidates={candidates}
          getToken={getToken}
          canManage={canManage}
          onRefresh={loadData}
          onCandidatesFilter={handleOpeningsFilterFromTab}
        />
      )}

      {/* ─── Banco de talentos ─── */}
      {viewMode === 'talents' && (
        <TalentsView
          candidates={candidates}
          roles={roles}
          openings={openings}
          getToken={getToken}
          canManage={canManage}
          onOpen={setDetailCandidate}
          onReactivated={loadData}
        />
      )}

      {/* ─── Formulários ─── */}
      {viewMode === 'forms' && (
        <RecruitmentFormsView
          getToken={getToken}
          canManage={canManage}
        />
      )}

      {/* ─── Onboarding ─── */}
      {viewMode === 'onboarding' && (
        <OnboardingView
          processes={onboardingProcesses}
          getToken={getToken}
          canManage={canManage}
          onRefresh={loadData}
        />
      )}

      {/* Modals */}
      {showNewModal && (
        <NewCandidateModal
          roles={roles}
          openings={openings}
          getToken={getToken}
          onClose={() => setShowNewModal(false)}
          onCreated={() => { loadData(); setShowNewModal(false); }}
        />
      )}

      {detailCandidate && (
        <CandidateDetailPanel
          candidate={detailCandidate}
          roles={roles}
          openings={openings}
          getToken={getToken}
          canManage={canManage}
          onClose={() => setDetailCandidate(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}

      {deleteCandidate && (
        <DeleteConfirmModal
          candidate={deleteCandidate}
          getToken={getToken}
          onClose={() => setDeleteCandidate(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
