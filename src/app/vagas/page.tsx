"use client";

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  MapPin, Monitor, Users, ChevronRight, Loader2,
  Briefcase, Search, Building2, Clock, Globe,
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

const ROLE_COLORS = [
  'bg-indigo-500', 'bg-violet-500', 'bg-blue-500', 'bg-emerald-500',
  'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-orange-500',
];

function getRoleColor(name: string) {
  return ROLE_COLORS[(name?.charCodeAt(0) ?? 0) % ROLE_COLORS.length];
}

export default function VagasPage() {
  const [openings, setOpenings] = useState<PublicOpening[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterWorkType, setFilterWorkType] = useState<WorkType | ''>('');
  const [filterCategory, setFilterCategory] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/hr/openings/public')
      .then(r => r.json())
      .then(data => setOpenings(data))
      .catch(() => setError('Não foi possível carregar as vagas no momento.'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = openings.filter(o => {
    if (
      search &&
      !o.title.toLowerCase().includes(search.toLowerCase()) &&
      !(o.jobRoleName ?? '').toLowerCase().includes(search.toLowerCase()) &&
      !(o.location ?? '').toLowerCase().includes(search.toLowerCase())
    ) return false;
    if (filterWorkType && o.workType !== filterWorkType) return false;
    if (filterCategory && o.jobRoleName !== filterCategory) return false;
    return true;
  });

  const categories = Array.from(
    openings.reduce((acc, o) => {
      const key = o.jobRoleName ?? 'Outros';
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const presencialCount = openings.filter(o => o.workType === 'presencial').length;
  const remotoCount = openings.filter(o => o.workType === 'remoto').length;
  const hibridoCount = openings.filter(o => o.workType === 'hibrido').length;

  const hasFilters = !!(search || filterWorkType || filterCategory);

  const scrollToList = () =>
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* ── Nav ── */}
      <header className="border-b border-white/5 bg-slate-950/90 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-white text-sm tracking-tight">Coala Shakes</span>
          </div>
          <nav className="flex items-center gap-6">
            <a
              href="#vagas"
              onClick={e => { e.preventDefault(); scrollToList(); }}
              className="text-sm text-slate-400 hover:text-white transition-colors hidden sm:block"
            >
              Vagas
            </a>
            <a
              href="mailto:rh@coalashakes.com.br"
              className="text-sm text-slate-400 hover:text-white transition-colors hidden sm:block"
            >
              Contato
            </a>
            <button
              onClick={scrollToList}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors"
            >
              Candidate-se
            </button>
          </nav>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-indigo-600/8 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="grid md:grid-cols-2 gap-12 items-center">

            {/* Left — text */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-indigo-400 text-xs font-medium mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                {loading
                  ? '…'
                  : `${openings.length} vaga${openings.length !== 1 ? 's' : ''} disponíve${openings.length !== 1 ? 'is' : 'l'}`}
              </div>

              <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight leading-tight mb-4">
                Tem talento?<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                  Encontre seu lugar.
                </span>
              </h1>

              <p className="text-slate-400 text-lg mb-8 leading-relaxed max-w-sm">
                Junte-se à equipe Coala Shakes. Valorizamos comprometimento, iniciativa e vontade de crescer.
              </p>

              <div className="relative mb-5 max-w-md">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onFocus={scrollToList}
                  placeholder="Buscar por cargo ou localidade…"
                  className="w-full pl-11 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 text-sm"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {(['', 'presencial', 'remoto', 'hibrido'] as const).map(wt => (
                  <button
                    key={wt}
                    onClick={() => { setFilterWorkType(wt); scrollToList(); }}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      filterWorkType === wt
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-white'
                    }`}
                  >
                    {wt === '' ? 'Todas' : WORK_TYPE_LABELS[wt]}
                  </button>
                ))}
              </div>
            </div>

            {/* Right — stat cards */}
            <div className="hidden md:block">
              <div className="space-y-3 max-w-xs ml-auto">
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center gap-4">
                  <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <MapPin className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white">{loading ? '—' : presencialCount}</p>
                    <p className="text-xs text-slate-500">Vagas presenciais</p>
                  </div>
                </div>
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center gap-4 ml-10">
                  <div className="w-10 h-10 bg-green-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Monitor className="h-5 w-5 text-green-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white">{loading ? '—' : remotoCount}</p>
                    <p className="text-xs text-slate-500">Vagas remotas</p>
                  </div>
                </div>
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center gap-4">
                  <div className="w-10 h-10 bg-violet-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Globe className="h-5 w-5 text-violet-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white">{loading ? '—' : hibridoCount}</p>
                    <p className="text-xs text-slate-500">Vagas híbridas</p>
                  </div>
                </div>
                <div className="p-4 bg-indigo-600/10 border border-indigo-500/30 rounded-2xl flex items-center gap-4 ml-5">
                  <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Users className="h-5 w-5 text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white">{loading ? '—' : openings.length}</p>
                    <p className="text-xs text-slate-500">Total de vagas abertas</p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-6">

        {/* ── Para a empresa / Para você ── */}
        <div className="grid sm:grid-cols-2 gap-4 py-12">
          <div className="p-7 bg-indigo-600 rounded-2xl">
            <div className="w-11 h-11 bg-white/15 rounded-xl flex items-center justify-center mb-5">
              <Building2 className="h-6 w-6 text-white" />
            </div>
            <h3 className="font-bold text-white text-xl mb-2">Para a empresa</h3>
            <p className="text-indigo-100/80 text-sm leading-relaxed">
              Buscamos profissionais comprometidos que queiram crescer junto com o time
              e fazer a diferença no dia a dia de cada unidade.
            </p>
          </div>
          <div className="p-7 bg-violet-600 rounded-2xl">
            <div className="w-11 h-11 bg-white/15 rounded-xl flex items-center justify-center mb-5">
              <Users className="h-6 w-6 text-white" />
            </div>
            <h3 className="font-bold text-white text-xl mb-2">Para você</h3>
            <p className="text-violet-100/80 text-sm leading-relaxed">
              Trabalho com propósito, equipe unida e um ambiente onde sua contribuição
              é vista e valorizada desde o primeiro dia.
            </p>
          </div>
        </div>

        {/* ── Categorias ── */}
        {!loading && categories.length >= 2 && (
          <div className="mb-12">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white">Categorias</h2>
              {filterCategory && (
                <button
                  onClick={() => setFilterCategory('')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Ver todas
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {categories.map(({ name, count }) => {
                const color = getRoleColor(name);
                const initial = (name ?? '?')[0].toUpperCase();
                const isActive = filterCategory === name;
                return (
                  <button
                    key={name}
                    onClick={() => { setFilterCategory(isActive ? '' : name); scrollToList(); }}
                    className={`p-4 rounded-2xl border text-left transition-all ${
                      isActive
                        ? 'bg-indigo-600/15 border-indigo-500/40'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className={`w-9 h-9 ${color} rounded-xl flex items-center justify-center text-sm font-bold text-white mb-3`}>
                      {initial}
                    </div>
                    <p className="font-semibold text-white text-sm leading-snug mb-1 line-clamp-2">{name}</p>
                    <p className="text-xs text-slate-500">{count} vaga{count !== 1 ? 's' : ''}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Listagem ── */}
        <div ref={listRef} id="vagas" className="pb-20">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-white">
              {hasFilters
                ? `${filtered.length} resultado${filtered.length !== 1 ? 's' : ''}`
                : 'Vagas abertas'}
            </h2>
            {hasFilters && (
              <button
                onClick={() => { setSearch(''); setFilterWorkType(''); setFilterCategory(''); }}
                className="text-xs text-slate-500 hover:text-white transition-colors"
              >
                Limpar filtros
              </button>
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
                {hasFilters
                  ? 'Nenhuma vaga encontrada para estes filtros.'
                  : 'Nenhuma vaga aberta no momento.'}
              </p>
              {hasFilters && (
                <button
                  onClick={() => { setSearch(''); setFilterWorkType(''); setFilterCategory(''); }}
                  className="text-sm text-indigo-400 hover:text-indigo-300 mt-2"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="space-y-3">
              {filtered.map(opening => {
                const color = getRoleColor(opening.jobRoleName ?? opening.title);
                const initial = (opening.jobRoleName ?? opening.title ?? '?')[0].toUpperCase();
                return (
                  <Link
                    key={opening.id}
                    href={`/vagas/${opening.slug}`}
                    className="group flex items-center gap-5 p-5 bg-slate-900 border border-slate-800 rounded-2xl hover:border-indigo-500/40 hover:bg-slate-900/60 transition-all"
                  >
                    <div className={`w-12 h-12 ${color} rounded-2xl flex items-center justify-center text-base font-bold text-white flex-shrink-0`}>
                      {initial}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-white text-base group-hover:text-indigo-300 transition-colors leading-snug truncate mb-1.5">
                        {opening.title}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2">
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
                        {opening.slots > 1 && (
                          <span className="flex items-center gap-1 text-[11px] text-slate-500">
                            <Users className="h-3 w-3" /> {opening.slots} vagas
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      {opening.closesAt && (
                        <span className="flex items-center gap-1 text-[11px] text-amber-500/70 whitespace-nowrap">
                          <Clock className="h-3 w-3" />
                          até {new Date(opening.closesAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                        </span>
                      )}
                      <span className="hidden sm:flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 group-hover:bg-indigo-500 text-white text-xs font-medium rounded-xl transition-colors whitespace-nowrap">
                        Ver vaga <ChevronRight className="h-3 w-3" />
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-8 text-center text-xs text-slate-600">
          © {new Date().getFullYear()} Coala Shakes. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
}
