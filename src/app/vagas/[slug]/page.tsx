"use client";

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  MapPin, Monitor, Users, CheckCircle2, ArrowLeft,
  Loader2, AlertTriangle, Send, Paperclip, X, Building2,
} from 'lucide-react';

type WorkType = 'presencial' | 'remoto' | 'hibrido';

interface PublicOpening {
  id: string;
  title: string;
  slug: string;
  jobRoleName?: string;
  description?: string;
  requirements?: string[];
  location?: string;
  workType?: WorkType;
  slots: number;
  closesAt?: string;
}

const WORK_TYPE_LABELS: Record<WorkType, string> = {
  presencial: 'Presencial',
  remoto: 'Remoto',
  hibrido: 'Híbrido',
};

export default function VagaDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const [opening, setOpening] = useState<PublicOpening | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/hr/openings/public')
      .then(r => r.json())
      .then((data: PublicOpening[]) => {
        const found = data.find(o => o.slug === slug);
        if (found) setOpening(found);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const payload: Record<string, string> = {
        slug,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        message: form.message.trim(),
        source: 'site',
      };

      // Upload CV if provided
      if (resumeFile) {
        const fd = new FormData();
        fd.append('file', resumeFile);
        const uploadRes = await fetch('/api/hr/upload', { method: 'POST', body: fd });
        if (uploadRes.ok) {
          const { url } = await uploadRes.json();
          payload.resumeUrl = url;
        }
      }

      const res = await fetch('/api/hr/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Falha ao enviar candidatura.');
      }

      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro ao enviar. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (notFound || !opening) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4 text-slate-400">
        <p className="text-lg">Vaga não encontrada ou encerrada.</p>
        <Link href="/vagas" className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Ver todas as vagas
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <Building2 className="h-6 w-6 text-indigo-400" />
          <Link href="/vagas" className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Vagas
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="grid md:grid-cols-[1fr_380px] gap-10 items-start">
          {/* Job Details */}
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight mb-2">{opening.title}</h1>
            {opening.jobRoleName && opening.jobRoleName !== opening.title && (
              <p className="text-slate-500 mb-4">{opening.jobRoleName}</p>
            )}

            <div className="flex flex-wrap items-center gap-4 mb-8">
              {opening.location && (
                <span className="flex items-center gap-1.5 text-sm text-slate-400">
                  <MapPin className="h-4 w-4 text-slate-500" /> {opening.location}
                </span>
              )}
              {opening.workType && (
                <span className="flex items-center gap-1.5 text-sm text-slate-400">
                  <Monitor className="h-4 w-4 text-slate-500" /> {WORK_TYPE_LABELS[opening.workType]}
                </span>
              )}
              {opening.slots > 1 && (
                <span className="flex items-center gap-1.5 text-sm text-slate-400">
                  <Users className="h-4 w-4 text-slate-500" /> {opening.slots} vagas
                </span>
              )}
              {opening.closesAt && (
                <span className="text-sm text-amber-500/80">
                  Inscrições até {new Date(opening.closesAt).toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>

            {opening.description && (
              <div className="mb-8">
                <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3">Sobre a vaga</h2>
                <p className="text-slate-400 leading-relaxed whitespace-pre-line">{opening.description}</p>
              </div>
            )}

            {opening.requirements && opening.requirements.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3">Requisitos</h2>
                <ul className="space-y-2">
                  {opening.requirements.map((req, i) => (
                    <li key={i} className="flex items-start gap-2 text-slate-400">
                      <CheckCircle2 className="h-4 w-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Apply Form */}
          <div className="sticky top-24">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              {submitted ? (
                <div className="py-8 text-center space-y-3">
                  <div className="w-14 h-14 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="h-7 w-7 text-green-400" />
                  </div>
                  <h3 className="font-bold text-white text-lg">Candidatura enviada!</h3>
                  <p className="text-slate-400 text-sm">
                    Recebemos sua candidatura. Nossa equipe entrará em contato em breve.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <h2 className="font-bold text-white text-lg mb-2">Candidatar-se</h2>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Nome completo *</label>
                    <input
                      type="text" value={form.name} onChange={set('name')} required
                      className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                      placeholder="Seu nome"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">E-mail *</label>
                    <input
                      type="email" value={form.email} onChange={set('email')} required
                      className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                      placeholder="email@exemplo.com"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Telefone</label>
                    <input
                      type="tel" value={form.phone} onChange={set('phone')}
                      className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                      placeholder="(11) 9 0000-0000"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Currículo (PDF, DOC)</label>
                    {resumeFile ? (
                      <div className="flex items-center gap-2 p-2.5 bg-slate-950 border border-indigo-500/30 rounded-xl">
                        <Paperclip className="h-4 w-4 text-indigo-400 flex-shrink-0" />
                        <span className="text-sm text-slate-300 truncate flex-1">{resumeFile.name}</span>
                        <button type="button" onClick={() => setResumeFile(null)} className="text-slate-500 hover:text-white">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center gap-2 p-2.5 bg-slate-950 border border-slate-700 rounded-xl cursor-pointer hover:border-slate-600 transition-colors">
                        <Paperclip className="h-4 w-4 text-slate-500" />
                        <span className="text-sm text-slate-500">Anexar currículo</span>
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx"
                          className="hidden"
                          onChange={e => setResumeFile(e.target.files?.[0] ?? null)}
                        />
                      </label>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Mensagem</label>
                    <textarea
                      value={form.message} onChange={set('message')} rows={3}
                      className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm resize-none"
                      placeholder="Conte um pouco sobre você..."
                    />
                  </div>

                  {submitError && (
                    <p className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" /> {submitError}
                    </p>
                  )}

                  <button
                    type="submit" disabled={submitting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-medium text-sm transition-all"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {submitting ? 'Enviando…' : 'Enviar candidatura'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
