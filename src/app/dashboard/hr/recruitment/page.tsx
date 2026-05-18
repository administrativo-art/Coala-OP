"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '@/hooks/use-auth';
import { fetchHrBootstrap } from '@/features/hr/lib/client';
import type { Candidate, CandidateStatus, HrFormQuestion, JobRole, JobOpening, JobOpeningStatus } from '@/types';
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
};

const PIPELINE_STATUSES: CandidateStatus[] = ['applied', 'screening', 'interview', 'technical_test', 'offer', 'hired'];
const ARCHIVED_STATUSES: CandidateStatus[] = ['rejected', 'withdrawn'];
const ALL_STATUSES = Object.keys(STATUS_CONFIG) as CandidateStatus[];

const OPENING_STATUS_CONFIG: Record<JobOpeningStatus, { label: string; color: string; icon: React.ElementType }> = {
  open:   { label: 'Aberta',   color: 'text-green-400 bg-green-500/10 border-green-500/20',  icon: Globe },
  paused: { label: 'Pausada',  color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20', icon: PauseCircle },
  closed: { label: 'Encerrada',color: 'text-slate-400 bg-slate-500/10 border-slate-500/20',  icon: Archive },
};

const SOURCE_OPTIONS = ['LinkedIn', 'Indicação', 'Site', 'Indeed', 'Catho', 'Espontâneo', 'Outro'];
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
];

const EMPTY_QUESTION_DRAFT = {
  text: '',
  type: 'text' as HrFormQuestion['type'],
  optionsText: '',
  required: false,
  eliminatory: false,
};

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const role = roles.find(r => r.id === candidate.jobRoleId);
  const opening = openings.find(o => o.id === candidate.jobOpeningId);
  const formAnswers = candidate.latestApplication?.formAnswers ?? candidate.formAnswers ?? {};
  const questionSnapshot = candidate.latestApplication?.formQuestionSnapshot ?? opening?.formQuestions ?? role?.formQuestions ?? [];
  const questionsById = new Map((questionSnapshot as HrFormQuestion[]).map(question => [question.id, question]));
  const answerEntries = Object.entries(formAnswers);
  const hasChanges =
    form.name !== candidate.name || form.email !== candidate.email ||
    form.phone !== (candidate.phone ?? '') || form.notes !== (candidate.notes ?? '') ||
    form.status !== candidate.status || form.rating !== (candidate.rating ?? 0) ||
    form.source !== (candidate.source ?? '') || !!resumeFile;

  const currentResume = resumeFile ? null : candidate.resumeUrl;

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

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Observações</label>
            <textarea value={form.notes} onChange={set('notes')} disabled={!canManage} rows={4}
              placeholder={canManage ? 'Anotações sobre o candidato…' : '—'}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm resize-none disabled:opacity-60" />
          </div>

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

function DraggableCard({ candidate, onOpen }: { candidate: Candidate; onOpen: () => void }) {
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

function DroppableColumn({ status, candidates, onCardOpen }: {
  status: CandidateStatus;
  candidates: Candidate[];
  onCardOpen: (c: Candidate) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const cfg = STATUS_CONFIG[status];
  const accent = COLUMN_ACCENT[status];

  return (
    <div className={`flex-shrink-0 w-[270px] rounded-2xl border bg-gradient-to-b ${accent} p-2 shadow-sm flex flex-col`}>
      <div className="px-2.5 py-2.5 flex items-center gap-2">
        <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
        <h3 className="font-bold text-slate-900 text-sm flex-1">{cfg.label}</h3>
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
          <DraggableCard key={c.id} candidate={c} onOpen={() => onCardOpen(c)} />
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

function OpeningModal({ opening, roles, getToken, onClose, onSaved }: {
  opening?: JobOpening;
  roles: JobRole[];
  getToken: () => Promise<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!opening;
  const formId = opening ? `opening-form-${opening.id}` : 'opening-form-new';
  const [form, setForm] = useState({
    title: opening?.title ?? '',
    jobRoleId: opening?.jobRoleId ?? '',
    description: opening?.description ?? '',
    location: opening?.location ?? '',
    workType: opening?.workType ?? '',
    slots: String(opening?.slots ?? 1),
    closesAt: opening?.closesAt ? opening.closesAt.split('T')[0] : '',
    status: opening?.status ?? 'open',
    requirements: (opening?.requirements ?? []).join('\n'),
  });
  const [questions, setQuestions] = useState<HrFormQuestion[]>(opening?.formQuestions ?? []);
  const [questionDraft, setQuestionDraft] = useState(EMPTY_QUESTION_DRAFT);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));

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
    setQuestionDraft(EMPTY_QUESTION_DRAFT);
    setQuestionError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.jobRoleId) {
      setError('Título e cargo são obrigatórios.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: form.title.trim(),
        jobRoleId: form.jobRoleId,
        description: form.description.trim() || null,
        location: form.location.trim() || null,
        workType: form.workType || null,
        slots: Number(form.slots) || 1,
        closesAt: form.closesAt ? new Date(form.closesAt).toISOString() : null,
        status: form.status,
        requirements: form.requirements.split('\n').map(s => s.trim()).filter(Boolean),
        formQuestions: questions,
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
              <select value={form.jobRoleId} onChange={set('jobRoleId')} required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Selecione</option>
                {roles.filter(r => r.isActive !== false).map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Nº de vagas</label>
              <input type="number" min="1" value={form.slots} onChange={set('slots')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm" />
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
                <h3 className="text-sm font-semibold text-white">Formulário de triagem</h3>
                <p className="mt-1 text-xs text-slate-500">Perguntas exibidas na candidatura pública desta vaga.</p>
              </div>

              {questions.length > 0 && (
                <div className="space-y-2">
                  {questions.map((question) => (
                    <div key={question.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="min-w-0 space-y-2">
                        <p className="text-sm font-medium text-slate-100">{question.text}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">
                            {QUESTION_TYPES.find(item => item.value === question.type)?.label ?? question.type}
                          </span>
                          {question.required && (
                            <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] text-indigo-300">Obrigatória</span>
                          )}
                          {question.eliminatory && (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">Eliminatória</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setQuestions(prev => prev.filter(item => item.id !== question.id))}
                        className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-white"
                      >
                        Remover
                      </button>
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

function OpeningsView({ openings, roles, getToken, canManage, onRefresh, onCandidatesFilter }: {
  openings: JobOpening[];
  roles: JobRole[];
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
                        <p className="text-xs text-slate-500 mb-2">{role?.name ?? opening.jobRoleName}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                          {opening.location && <span>{opening.location}</span>}
                          {opening.workType && <span>{{ presencial: 'Presencial', remoto: 'Remoto', hibrido: 'Híbrido' }[opening.workType]}</span>}
                          <span>{opening.slots} vaga{opening.slots !== 1 ? 's' : ''}</span>
                          {opening.closesAt && (
                            <span className="text-amber-600">
                              até {new Date(opening.closesAt).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => onCandidatesFilter(opening.id)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 border border-slate-200 hover:border-slate-300 rounded-lg transition-colors">
                          Candidatos
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

function TalentsView({ candidates, roles, getToken, canManage, onOpen, onReactivated }: {
  candidates: Candidate[];
  roles: JobRole[];
  getToken: () => Promise<string>;
  canManage: boolean;
  onOpen: (c: Candidate) => void;
  onReactivated: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterRating, setFilterRating] = useState('');
  const [reactivating, setReactivating] = useState<string | null>(null);

  const archived = candidates.filter(c => ARCHIVED_STATUSES.includes(c.status));

  const filtered = archived.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) &&
        !c.email.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterRole && c.jobRoleId !== filterRole) return false;
    if (filterRating && (c.rating ?? 0) < Number(filterRating)) return false;
    return true;
  });

  const highRating = archived.filter(c => (c.rating ?? 0) >= 4).length;

  async function handleReactivate(candidate: Candidate) {
    setReactivating(candidate.id);
    try {
      await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'applied' }),
      });
      onReactivated();
    } catch {
      // silent
    } finally {
      setReactivating(null);
    }
  }

  const roleOptions = useMemo(() => {
    const ids = new Set(archived.map(c => c.jobRoleId).filter(Boolean));
    return roles.filter(r => ids.has(r.id));
  }, [archived, roles]);

  return (
    <div className="flex flex-col gap-4 flex-1">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Total no banco</p>
          <p className="text-3xl font-bold text-white">{archived.length}</p>
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
      {archived.length === 0 && (
        <div className="py-16 text-center">
          <Star className="h-10 w-10 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Nenhum candidato no banco de talentos ainda.</p>
          <p className="text-slate-600 text-xs mt-1">Candidatos reprovados ou desistentes aparecem aqui.</p>
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
                    onClick={() => handleReactivate(candidate)}
                    disabled={reactivating === candidate.id}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-indigo-400 border border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/15 rounded-xl transition-colors disabled:opacity-40">
                    {reactivating === candidate.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <ArrowRight className="h-3 w-3" />}
                    Reativar para triagem
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* No results (but has archived) */}
      {archived.length > 0 && filtered.length === 0 && (
        <div className="py-10 text-center text-slate-600 text-sm">Nenhum candidato encontrado com os filtros aplicados.</div>
      )}
    </div>
  );
}

// ─── RecruitmentPage ──────────────────────────────────────────────────────────

export default function RecruitmentPage() {
  const { firebaseUser, permissions, loading: authLoading } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View mode: kanban | list (triagem) | openings (por vaga)
  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'openings' | 'talents'>('kanban');

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
      const [candidatesRes, rolesRes, openingsRes] = await Promise.all([
        fetch('/api/hr/candidates', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetchHrBootstrap(firebaseUser),
        fetch('/api/hr/openings', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      ]);
      setCandidates(candidatesRes as Candidate[]);
      setRoles(rolesRes.roles);
      setOpenings(openingsRes as JobOpening[]);
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

  const stats = useMemo(() => {
    const now = Date.now();
    const MS_DAY = 86_400_000;
    const applied = candidates.filter(c => c.status === 'applied').length;
    const screening = candidates.filter(c => c.status === 'screening').length;
    const hired = candidates.filter(c => c.status === 'hired').length;
    const pipeline = candidates.filter(c => PIPELINE_STATUSES.includes(c.status));
    const avgDays = pipeline.length > 0
      ? Math.round(pipeline.reduce((sum, c) =>
          sum + (now - new Date(c.appliedAt).getTime()), 0) / pipeline.length / MS_DAY)
      : 0;
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
    return { applied, screening, hired, avgDays, sparkData, appliedTrend, hiredThisMonth };
  }, [candidates]);

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

    // Optimistic update
    setCandidates(prev => prev.map(c =>
      c.id === candidate.id ? { ...c, status: newStatus } : c
    ));

    try {
      await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
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
            {(['kanban', 'list', 'openings', 'talents'] as const).map((mode) => {
              const labels: Record<string, string> = { kanban: 'Kanban', list: 'Triagem', openings: 'Por vaga', talents: 'Talentos' };
              return (
                <button key={mode} onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    viewMode === mode ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}>
                  {labels[mode]}
                </button>
              );
            })}
            <a href="/vagas" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-900 transition-all">
              <Globe className="h-3.5 w-3.5" />
              Página pública
            </a>
          </div>

          {/* CTA */}
          {canManage && viewMode !== 'openings' && viewMode !== 'talents' && (
            <button onClick={() => setShowNewModal(true)}
              className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800">
              <UserPlus className="h-4 w-4" />
              Novo candidato
            </button>
          )}
        </div>
      </div>

      {/* ─── Stats row ─── */}
      {viewMode === 'list' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Inscritos — with sparkline */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Inscritos</p>
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-3xl font-bold text-slate-950 leading-none">{stats.applied}</p>
                {stats.appliedTrend !== 0 && (
                  <span className={`flex items-center gap-0.5 text-xs font-bold mt-1 ${stats.appliedTrend > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                      {stats.appliedTrend > 0
                        ? <path d="M4 1L7 6H1L4 1Z" />
                        : <path d="M4 7L7 2H1L4 7Z" />}
                    </svg>
                    {Math.abs(stats.appliedTrend)}%
                  </span>
                )}
              </div>
              {/* Sparkline */}
              <svg width="56" height="28" className="text-indigo-400 flex-shrink-0">
                {stats.sparkData.map((v, i) => {
                  const max = Math.max(...stats.sparkData, 1);
                  const bh = Math.max((v / max) * 24, 2);
                  const bw = 6;
                  return (
                    <rect key={i} x={i * 8} y={28 - bh} width={bw} height={bh}
                      rx="1" fill="currentColor" opacity={0.3 + 0.7 * (v / max)} />
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Em triagem */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Em triagem</p>
            <p className="text-3xl font-bold text-slate-950 leading-none">{stats.screening}</p>
          </div>

          {/* Contratados */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Contratados</p>
            <div>
              <p className="text-3xl font-bold text-slate-950 leading-none">{stats.hired}</p>
              {stats.hiredThisMonth > 0 && (
                <span className="flex items-center gap-0.5 text-xs font-bold mt-1 text-emerald-400">
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                    <path d="M4 1L7 6H1L4 1Z" />
                  </svg>
                  +{stats.hiredThisMonth} este mês
                </span>
              )}
            </div>
          </div>

          {/* Tempo médio */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Tempo médio</p>
            <p className="text-3xl font-bold text-slate-950 leading-none">{stats.avgDays}d</p>
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
      {viewMode !== 'openings' && viewMode !== 'talents' && (
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

      {/* ─── Kanban ─── */}
      {viewMode === 'kanban' && (
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-h-0">
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex gap-4 overflow-x-auto rounded-2xl bg-slate-50/80 p-3 pb-4 custom-scrollbar">
              {PIPELINE_STATUSES.map(status => (
                <DroppableColumn
                  key={status}
                  status={status}
                  candidates={pipelineCandidates.filter(c => c.status === status)}
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
          getToken={getToken}
          canManage={canManage}
          onOpen={setDetailCandidate}
          onReactivated={loadData}
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
