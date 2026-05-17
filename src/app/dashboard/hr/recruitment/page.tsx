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
  Globe, PauseCircle, Archive, Plus, Pencil,
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
  const questionSnapshot = candidate.latestApplication?.formQuestionSnapshot ?? role?.formQuestions ?? [];
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
  applied:        'border-t-blue-500   bg-blue-500/5',
  screening:      'border-t-indigo-500 bg-indigo-500/5',
  interview:      'border-t-purple-500 bg-purple-500/5',
  technical_test: 'border-t-pink-500   bg-pink-500/5',
  offer:          'border-t-yellow-500 bg-yellow-500/5',
  hired:          'border-t-green-500  bg-green-500/5',
  rejected:       'border-t-red-500    bg-red-500/5',
  withdrawn:      'border-t-slate-500  bg-slate-500/5',
};

function CandidateInitials({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase();
  const colors = [
    'bg-indigo-500', 'bg-purple-500', 'bg-pink-500', 'bg-blue-500',
    'bg-teal-500', 'bg-orange-500', 'bg-green-500', 'bg-rose-500',
  ];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className={`w-7 h-7 rounded-full ${color} flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0`}>
      {initials}
    </div>
  );
}

const SOURCE_TAG_COLORS: Record<string, string> = {
  LinkedIn:    'bg-blue-500/10  text-blue-400  border-blue-500/20',
  Indicação:   'bg-green-500/10 text-green-400 border-green-500/20',
  Site:        'bg-violet-500/10 text-violet-400 border-violet-500/20',
  Indeed:      'bg-orange-500/10 text-orange-400 border-orange-500/20',
  Catho:       'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  Espontâneo:  'bg-slate-500/10 text-slate-400 border-slate-500/20',
  Outro:       'bg-slate-500/10 text-slate-400 border-slate-500/20',
  site:        'bg-violet-500/10 text-violet-400 border-violet-500/20',
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

  return (
    <div
      ref={setNodeRef} style={style} {...attributes}
      className="bg-slate-900 border border-slate-800/80 rounded-xl shadow-sm hover:border-slate-700 hover:shadow-md hover:shadow-black/20 transition-all group"
    >
      <button onClick={onOpen} className="w-full text-left p-4">
        {/* Top row: initials + name + drag handle */}
        <div className="flex items-start gap-2.5 mb-3">
          <CandidateInitials name={candidate.name} />
          <div className="flex-1 min-w-0 pt-0.5">
            <h4 className="font-semibold text-white group-hover:text-indigo-300 transition-colors text-sm leading-snug truncate">
              {candidate.name}
            </h4>
            <p className="text-[11px] text-slate-500 truncate mt-0.5">{candidate.jobRoleName}</p>
          </div>
          <div
            {...listeners}
            onClick={e => e.stopPropagation()}
            className="cursor-grab active:cursor-grabbing p-1 text-slate-700 hover:text-slate-500 flex-shrink-0 mt-0.5"
          >
            <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
              <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
              <circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/>
              <circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/>
            </svg>
          </div>
        </div>

        {/* Rating */}
        {(candidate.rating ?? 0) > 0 && (
          <div className="mb-3">
            <RatingStars value={candidate.rating ?? 0} readonly />
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {sourceColor && candidate.source && (
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${sourceColor}`}>
              {candidate.source}
            </span>
          )}
          {candidate.resumeUrl && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-full">
              <Paperclip className="h-2.5 w-2.5" /> CV
            </span>
          )}
          <span className="ml-auto text-[10px] text-slate-600 flex items-center gap-1">
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
    <div className="flex-shrink-0 w-72 flex flex-col">
      {/* Column header card */}
      <div className={`border-t-2 ${accent} bg-slate-900/40 border border-slate-800/60 rounded-t-xl px-4 py-3 flex items-center gap-2`}>
        <h3 className="font-bold text-white text-xs uppercase tracking-wider flex-1">{cfg.label}</h3>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${cfg.color}/15 text-slate-300`}>
          {candidates.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-2 p-2 min-h-[160px] rounded-b-xl border border-t-0 transition-colors ${
          isOver
            ? 'border-indigo-500/50 bg-indigo-500/5'
            : 'border-slate-800/60 bg-slate-900/10'
        }`}
      >
        {candidates.map(c => (
          <DraggableCard key={c.id} candidate={c} onOpen={() => onCardOpen(c)} />
        ))}
        {candidates.length === 0 && (
          <div className={`flex-1 min-h-[80px] flex items-center justify-center rounded-lg border border-dashed ${
            isOver ? 'border-indigo-500/40' : 'border-slate-800/40'
          }`}>
            <UserPlus className="h-4 w-4 text-slate-700" />
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));

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
      <div className="relative z-10 w-full max-w-lg bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
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
        <p className="text-slate-400 text-sm">{openings.filter(o => o.status === 'open').length} vagas abertas</p>
        {canManage && (
          <button onClick={() => setModal('new')}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-sm">
            <Plus className="h-4 w-4" /> Nova vaga
          </button>
        )}
      </div>

      {openings.length === 0 && (
        <div className="py-16 text-center">
          <Briefcase className="h-10 w-10 text-slate-700 mx-auto mb-3" />
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
                    className="p-5 bg-slate-900/60 border border-slate-800 rounded-2xl hover:border-slate-700 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-bold text-white text-sm">{opening.title}</h4>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.color}`}>
                            {cfg.label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mb-2">{role?.name ?? opening.jobRoleName}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                          {opening.location && <span>📍 {opening.location}</span>}
                          {opening.workType && <span>💼 {{ presencial: 'Presencial', remoto: 'Remoto', hibrido: 'Híbrido' }[opening.workType]}</span>}
                          <span>👥 {opening.slots} vaga{opening.slots !== 1 ? 's' : ''}</span>
                          {opening.closesAt && (
                            <span className="text-amber-500/70">
                              até {new Date(opening.closesAt).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => onCandidatesFilter(opening.id)}
                          className="px-3 py-1.5 text-xs text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700 rounded-lg transition-colors">
                          Candidatos
                        </button>
                        {canManage && (
                          <>
                            <button onClick={() => setModal(opening)}
                              className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800">
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
          <div className="relative z-10 w-full max-w-sm bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-4">
            <h3 className="font-bold text-white">Excluir vaga?</h3>
            <p className="text-sm text-slate-400">"{deleteTarget.title}" será removida permanentemente.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 px-3 py-2 text-sm border border-slate-700 text-slate-400 rounded-xl">
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

// ─── RecruitmentPage ──────────────────────────────────────────────────────────

export default function RecruitmentPage() {
  const { firebaseUser, permissions, loading: authLoading } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Nav
  const [activeTab, setActiveTab] = useState<'pipeline' | 'openings'>('pipeline');

  // Pipeline filters
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterOpening, setFilterOpening] = useState('');
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [showArchived, setShowArchived] = useState(false);

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

  const filtered = useMemo(() => {
    return candidates.filter(c => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase()) &&
          !c.email.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterRole && c.jobRoleId !== filterRole) return false;
      if (filterStatus && c.status !== filterStatus) return false;
      if (filterOpening && c.jobOpeningId !== filterOpening) return false;
      return true;
    });
  }, [candidates, search, filterRole, filterStatus, filterOpening]);

  const pipelineCandidates = useMemo(() =>
    filtered.filter(c => PIPELINE_STATUSES.includes(c.status)), [filtered]);

  const archivedCandidates = useMemo(() =>
    filtered.filter(c => ARCHIVED_STATUSES.includes(c.status)), [filtered]);

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
    setActiveTab('pipeline');
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

  const activeFilters = [filterRole, filterStatus, filterOpening].filter(Boolean).length;

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Recrutamento</h1>
          <p className="text-slate-400 mt-1 text-sm">
            {candidates.length} candidato{candidates.length !== 1 ? 's' : ''} ·{' '}
            {openings.filter(o => o.status === 'open').length} vaga{openings.filter(o => o.status === 'open').length !== 1 ? 's' : ''} aberta{openings.filter(o => o.status === 'open').length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'pipeline' && canManage && (
            <button onClick={() => setShowNewModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-sm shadow-lg shadow-indigo-500/20">
              <UserPlus className="h-4 w-4" />
              <span>Novo Candidato</span>
            </button>
          )}
          <a href="/vagas" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white rounded-xl text-sm transition-colors">
            <Globe className="h-4 w-4" />
            <span className="hidden md:inline">Página pública</span>
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-slate-900/50 border border-slate-800 rounded-xl p-1 w-fit">
        {([['pipeline', 'Pipeline'], ['openings', 'Vagas']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Pipeline Tab ── */}
      {activeTab === 'pipeline' && (
        <div className="flex flex-col flex-1 space-y-4 min-h-0">
          {/* Filters bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar…"
                className="pl-9 pr-4 py-2 bg-slate-900/50 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-48 text-sm" />
            </div>

            <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
              className="px-3 py-2 bg-slate-900/50 border border-slate-800 rounded-xl text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">Todos os cargos</option>
              {roles.filter(r => r.isActive !== false).map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>

            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="px-3 py-2 bg-slate-900/50 border border-slate-800 rounded-xl text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">Todos os status</option>
              {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
            </select>

            {openings.length > 0 && (
              <select value={filterOpening} onChange={e => setFilterOpening(e.target.value)}
                className="px-3 py-2 bg-slate-900/50 border border-slate-800 rounded-xl text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                <option value="">Todas as vagas</option>
                {openings.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
              </select>
            )}

            {activeFilters > 0 && (
              <button
                onClick={() => { setFilterRole(''); setFilterStatus(''); setFilterOpening(''); setSearch(''); }}
                className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-400 hover:text-white border border-slate-800 rounded-xl hover:border-slate-700">
                <X className="h-3 w-3" /> Limpar filtros
              </button>
            )}

            <div className="ml-auto flex bg-slate-900 border border-slate-800 rounded-xl p-1">
              <button onClick={() => setViewMode('kanban')}
                className={`p-2 rounded-lg transition-all ${viewMode === 'kanban' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                <Kanban className="h-4 w-4" />
              </button>
              <button onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Kanban */}
          {viewMode === 'kanban' && (
            <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-h-0">
              <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <div className="flex gap-4 overflow-x-auto pb-2 custom-scrollbar">
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

              {/* Archived section */}
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

          {/* List */}
          {viewMode === 'list' && (
            <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/80">
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Candidato</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Cargo</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider hidden md:table-cell">Avaliação</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider hidden lg:table-cell">Inscrição</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-600 text-sm">
                        Nenhum candidato encontrado.
                      </td>
                    </tr>
                  )}
                  {filtered.map(candidate => (
                    <tr key={candidate.id} onClick={() => setDetailCandidate(candidate)}
                      className="hover:bg-slate-800/30 transition-colors cursor-pointer group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-white group-hover:text-indigo-300 transition-colors text-sm truncate">
                              {candidate.name}
                            </span>
                            <span className="text-xs text-slate-500 truncate">{candidate.email}</span>
                          </div>
                          {candidate.resumeUrl && (
                            <Paperclip className="h-3 w-3 text-slate-600 flex-shrink-0" />
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-slate-300">{candidate.jobRoleName ?? '—'}</span>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={candidate.status} />
                      </td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        <RatingStars value={candidate.rating ?? 0} readonly />
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-400 hidden lg:table-cell">
                        {new Date(candidate.appliedAt).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                        {canManage ? (
                          <ListRowMenu
                            candidate={candidate}
                            onOpen={() => setDetailCandidate(candidate)}
                            onDelete={() => setDeleteCandidate(candidate)}
                          />
                        ) : (
                          <button onClick={() => setDetailCandidate(candidate)}
                            className="p-2 text-slate-500 hover:text-white">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Openings Tab ── */}
      {activeTab === 'openings' && (
        <OpeningsView
          openings={openings}
          roles={roles}
          getToken={getToken}
          canManage={canManage}
          onRefresh={loadData}
          onCandidatesFilter={handleOpeningsFilterFromTab}
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
