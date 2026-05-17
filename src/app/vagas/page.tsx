"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  MapPin, Monitor, Users, ChevronRight, Loader2,
  Briefcase, Search, ArrowRight, Building2, Clock,
} from 'lucide-react';

type WorkType = 'presencial' | 'remoto' | 'hibrido';

interface PublicOpening {
  id: string;
  title: string;
  slug: string;
  jobRoleName?: string;
  description?: string;
  location?: string;
  workType?: WorkType;
  slots: number;
  closesAt?: string;
  createdAt: string;
}

const WORK_TYPE_LABELS: Record<WorkType, string> = {
  presencial: 'Presencial',
  remoto: 'Remoto',
  hibrido: 'Híbrido',
};

const WORK_TYPE_COLORS: Record<WorkType, string> = {
  presencial: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  remoto:     'bg-green-500/10 text-green-400 border-green-500/20',
  hibrido:    'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

export default function VagasPage() {
  const [openings, setOpenings] = useState<PublicOpening[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/hr/openings/public')
      .then(r => r.json())
      .then(data => setOpenings(data))
      .catch(() => setError('Não foi possível carregar as vagas no momento.'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = openings.filter(o =>
    !search ||
    o.title.toLowerCase().includes(search.toLowerCase()) ||
    (o.jobRoleName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (o.location ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <header className="border-b border-white/5 bg-slate-950/90 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-white text-sm tracking-tight">Coala Sistemas</span>
          </div>
          <a
            href="mailto:rh@coalasistemas.com.br"
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Contato
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/40 border-b border-white/5">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-violet-600/8 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-indigo-400 text-xs font-medium mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              {loading ? '…' : `${openings.length} vaga${openings.length !== 1 ? 's' : ''} disponíve${openings.length !== 1 ? 'is' : 'l'}`}
            </div>

            <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight leading-tight mb-4">
              Encontre seu lugar<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                no nosso time
              </span>
            </h1>

            <p className="text-slate-400 text-lg mb-10 leading-relaxed">
              Trabalhamos com tecnologia para transformar a gestão de restaurantes.
              Junte-se a nós e ajude a construir algo relevante.
            </p>

            {/* Search */}
            <div className="relative max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por cargo ou localidade…"
                className="w-full pl-11 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 text-sm backdrop-blur-sm"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Cards — For Company / For Candidates */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid sm:grid-cols-2 gap-4 mb-16">
          <div className="p-6 bg-gradient-to-br from-indigo-600/10 to-indigo-600/5 border border-indigo-500/20 rounded-2xl">
            <div className="w-10 h-10 bg-indigo-500/15 rounded-xl flex items-center justify-center mb-4">
              <Building2 className="h-5 w-5 text-indigo-400" />
            </div>
            <h3 className="font-bold text-white text-lg mb-1">Para a empresa</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Buscamos profissionais comprometidos que queiram crescer junto com o produto
              e impactar milhares de operações no setor de food service.
            </p>
          </div>
          <div className="p-6 bg-gradient-to-br from-violet-600/10 to-violet-600/5 border border-violet-500/20 rounded-2xl">
            <div className="w-10 h-10 bg-violet-500/15 rounded-xl flex items-center justify-center mb-4">
              <Users className="h-5 w-5 text-violet-400" />
            </div>
            <h3 className="font-bold text-white text-lg mb-1">Para você</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Trabalho com propósito, equipe enxuta e ambiente onde sua contribuição
              é visível e valorizada desde o primeiro dia.
            </p>
          </div>
        </div>

        {/* Job listings */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">
            {search ? `Resultados para "${search}"` : 'Vagas abertas'}
          </h2>
          {!loading && (
            <span className="text-sm text-slate-500">
              {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
          </div>
        )}

        {error && (
          <div className="py-20 text-center text-slate-400">{error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="py-20 text-center">
            <Briefcase className="h-12 w-12 text-slate-800 mx-auto mb-4" />
            <p className="text-slate-400">
              {search ? 'Nenhuma vaga encontrada para esta busca.' : 'Nenhuma vaga aberta no momento.'}
            </p>
            {search && (
              <button onClick={() => setSearch('')} className="text-sm text-indigo-400 hover:text-indigo-300 mt-2">
                Limpar busca
              </button>
            )}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-4">
            {filtered.map(opening => (
              <Link
                key={opening.id}
                href={`/vagas/${opening.slug}`}
                className="group p-6 bg-slate-900 border border-slate-800 rounded-2xl hover:border-indigo-500/40 hover:bg-slate-900/60 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Briefcase className="h-5 w-5 text-indigo-400" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-600 group-hover:text-indigo-400 transition-colors mt-1" />
                </div>

                <h3 className="font-bold text-white text-base group-hover:text-indigo-300 transition-colors mb-1 leading-snug">
                  {opening.title}
                </h3>
                {opening.jobRoleName && opening.jobRoleName !== opening.title && (
                  <p className="text-xs text-slate-500 mb-3">{opening.jobRoleName}</p>
                )}

                {opening.description && (
                  <p className="text-sm text-slate-400 line-clamp-2 mb-4">{opening.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-2 mt-auto">
                  {opening.workType && (
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${WORK_TYPE_COLORS[opening.workType]}`}>
                      {WORK_TYPE_LABELS[opening.workType]}
                    </span>
                  )}
                  {opening.location && (
                    <span className="flex items-center gap-1 text-[11px] text-slate-500">
                      <MapPin className="h-3 w-3" /> {opening.location}
                    </span>
                  )}
                  {opening.closesAt && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-500/70 ml-auto">
                      <Clock className="h-3 w-3" />
                      até {new Date(opening.closesAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-20">
        <div className="max-w-6xl mx-auto px-6 py-8 text-center text-xs text-slate-600">
          © {new Date().getFullYear()} Coala Sistemas. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
}
