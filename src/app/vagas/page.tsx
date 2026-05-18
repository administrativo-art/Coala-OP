"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  Building2,
  ChevronRight,
  Clock,
  MapPin,
  Search,
  Users,
} from "lucide-react";

type WorkType = "presencial" | "remoto" | "hibrido";

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
  presencial: "Presencial",
  remoto: "Remoto",
  hibrido: "Hibrido",
};

const WORK_TYPE_COLORS: Record<WorkType, string> = {
  presencial: "bg-emerald-50 text-emerald-700 border-emerald-100",
  remoto: "bg-violet-50 text-violet-700 border-violet-100",
  hibrido: "bg-sky-50 text-sky-700 border-sky-100",
};

const ROLE_COLORS = [
  "bg-emerald-600",
  "bg-teal-600",
  "bg-cyan-600",
  "bg-lime-600",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-600",
  "bg-slate-800",
];

function getRoleColor(name: string) {
  return ROLE_COLORS[(name?.charCodeAt(0) ?? 0) % ROLE_COLORS.length];
}

export default function VagasPage() {
  const [openings, setOpenings] = useState<PublicOpening[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterWorkType, setFilterWorkType] = useState<WorkType | "">("");
  const [filterCategory, setFilterCategory] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/hr/openings/public")
      .then((response) => response.json())
      .then((data) => setOpenings(data))
      .catch(() => setError("Nao foi possivel carregar as vagas no momento."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = openings.filter((opening) => {
    const term = search.toLowerCase();
    if (
      term &&
      !opening.title.toLowerCase().includes(term) &&
      !(opening.jobRoleName ?? "").toLowerCase().includes(term) &&
      !(opening.location ?? "").toLowerCase().includes(term)
    ) {
      return false;
    }
    if (filterWorkType && opening.workType !== filterWorkType) return false;
    if (filterCategory && opening.jobRoleName !== filterCategory) return false;
    return true;
  });

  const categories = Array.from(
    openings.reduce((acc, opening) => {
      const key = opening.jobRoleName ?? "Outros";
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const hasFilters = !!(search || filterWorkType || filterCategory);
  const openCount = openings.length;
  const todayCount = openings.filter((opening) => {
    const createdAt = new Date(opening.createdAt).getTime();
    return Number.isFinite(createdAt) && Date.now() - createdAt < 86_400_000;
  }).length;

  const scrollToList = () => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="min-h-screen bg-[#f7f7f2] text-slate-950">
      <div className="mx-auto min-h-screen max-w-6xl bg-white shadow-sm">
        <div className="bg-slate-950 px-6 py-2 text-[11px] text-white/75">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Processos seletivos Coala. Encontre a vaga certa para o seu momento.</span>
            <span>rh@coalashakes.com.br</span>
          </div>
        </div>

        <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center justify-between px-6">
            <Link href="/vagas" className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-700 text-white">
                <Building2 className="h-5 w-5" />
              </span>
              <span className="text-xl font-bold tracking-tight text-emerald-800">Coala</span>
            </Link>
            <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
              <button onClick={scrollToList} className="hover:text-slate-950">Vagas</button>
              <a href="#categorias" className="hover:text-slate-950">Categorias</a>
              <a href="mailto:rh@coalashakes.com.br" className="hover:text-slate-950">Contato</a>
            </nav>
            <button
              onClick={scrollToList}
              className="rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"
            >
              Candidate-se
            </button>
          </div>
        </header>

        <section className="relative overflow-hidden bg-[#eef7f2] px-6 py-14 md:py-20">
          <div className="grid items-center gap-10 md:grid-cols-[1fr_440px]">
            <div className="max-w-xl">
              <h1 className="text-4xl font-bold leading-tight tracking-tight text-slate-950 md:text-5xl">
                Tem talento?
                <br />
                Encontre oportunidade
              </h1>
              <p className="mt-4 text-base text-slate-600">
                Veja vagas abertas, filtre por localidade e envie sua candidatura para o time Coala.
              </p>

              <div className="mt-7 flex max-w-2xl flex-col gap-2 rounded-full bg-white p-2 shadow-lg shadow-emerald-950/5 ring-1 ring-slate-100 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    onFocus={scrollToList}
                    placeholder="Cargo, palavra-chave ou unidade"
                    className="h-11 w-full rounded-full border-0 bg-transparent pl-10 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </div>
                <select
                  value={filterWorkType}
                  onChange={(event) => {
                    setFilterWorkType(event.target.value as WorkType | "");
                    scrollToList();
                  }}
                  className="h-11 rounded-full border-0 bg-slate-50 px-4 text-sm font-medium text-slate-600 outline-none"
                >
                  <option value="">Todas as modalidades</option>
                  <option value="presencial">Presencial</option>
                  <option value="remoto">Remoto</option>
                  <option value="hibrido">Hibrido</option>
                </select>
                <button
                  onClick={scrollToList}
                  className="h-11 rounded-full bg-emerald-700 px-6 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  Buscar
                </button>
              </div>

              <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-950">Buscas populares:</span>
                {categories.slice(0, 3).map((category) => (
                  <button
                    key={category.name}
                    onClick={() => {
                      setFilterCategory(category.name);
                      scrollToList();
                    }}
                    className="hover:text-emerald-700"
                  >
                    {category.name}
                  </button>
                ))}
              </div>

              <div className="mt-12">
                <p className="text-xs font-medium text-slate-500">Vagas abertas agora</p>
                <div className="mt-3 flex items-center gap-6 text-sm font-semibold text-slate-700">
                  <span>{openCount} no total</span>
                  <span>{todayCount} adicionada{todayCount === 1 ? "" : "s"} hoje</span>
                </div>
              </div>
            </div>

            <div className="relative hidden min-h-[380px] md:block">
              <div className="absolute bottom-0 right-4 h-80 w-80 rounded-full bg-emerald-100" />
              <img
                src="/loginfundo.png"
                alt="Pessoa em ambiente de trabalho"
                className="absolute bottom-0 right-8 h-[360px] w-[320px] rounded-[42px] object-cover object-center shadow-2xl shadow-emerald-950/10"
              />
              <div className="absolute left-3 top-28 rounded-2xl bg-white px-5 py-4 text-sm font-semibold text-slate-800 shadow-xl shadow-emerald-950/10">
                Alerta de vagas ativo
              </div>
              <div className="absolute bottom-14 right-0 rounded-2xl bg-white px-5 py-4 shadow-xl shadow-emerald-950/10">
                <p className="text-xs font-semibold text-slate-500">Candidaturas abertas</p>
                <p className="mt-1 text-2xl font-bold text-slate-950">{openCount}</p>
              </div>
            </div>
          </div>
        </section>

        <main className="px-6 py-12">
          <section className="grid gap-5 md:grid-cols-2">
            <div className="grid min-h-36 grid-cols-[1fr_150px] overflow-hidden rounded-2xl bg-[#fde7df] p-7">
              <div>
                <h2 className="text-lg font-bold">Para gestores</h2>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-600">
                  Publique vagas e acompanhe candidatos no painel interno de recrutamento.
                </p>
                <Link href="/dashboard/hr/recruitment" className="mt-5 inline-flex rounded-full bg-emerald-700 px-4 py-2 text-xs font-semibold text-white">
                  Abrir painel
                </Link>
              </div>
              <div className="flex items-end justify-end">
                <Building2 className="h-24 w-24 text-emerald-800/25" />
              </div>
            </div>

            <div className="grid min-h-36 grid-cols-[1fr_150px] overflow-hidden rounded-2xl bg-[#fde2d7] p-7">
              <div>
                <h2 className="text-lg font-bold">Para candidatos</h2>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-600">
                  Escolha uma vaga, envie seu curriculo e acompanhe o contato do RH.
                </p>
                <button onClick={scrollToList} className="mt-5 rounded-full bg-emerald-700 px-4 py-2 text-xs font-semibold text-white">
                  Ver vagas
                </button>
              </div>
              <div className="flex items-end justify-end">
                <Users className="h-24 w-24 text-emerald-800/25" />
              </div>
            </div>
          </section>

          <section id="categorias" className="mt-14">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">Categorias populares</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {openCount} vaga{openCount === 1 ? "" : "s"} aberta{openCount === 1 ? "" : "s"} no momento.
                </p>
              </div>
              {filterCategory && (
                <button onClick={() => setFilterCategory("")} className="text-sm font-semibold text-emerald-700">
                  Ver todas
                </button>
              )}
            </div>

            {categories.length === 0 ? (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-8 text-sm text-slate-500">
                Nenhuma categoria disponivel.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {categories.slice(0, 4).map(({ name, count }) => {
                  const isActive = filterCategory === name;
                  return (
                    <button
                      key={name}
                      onClick={() => {
                        setFilterCategory(isActive ? "" : name);
                        scrollToList();
                      }}
                      className={`rounded-2xl border p-5 text-left transition-all ${
                        isActive
                          ? "border-emerald-300 bg-emerald-50"
                          : "border-slate-100 bg-[#f1f8f5] hover:border-emerald-200"
                      }`}
                    >
                      <span className={`mb-5 flex h-11 w-11 items-center justify-center rounded-full ${getRoleColor(name)} text-white`}>
                        <Briefcase className="h-5 w-5" />
                      </span>
                      <h3 className="font-bold text-slate-950">{name}</h3>
                      <p className="mt-2 text-sm text-slate-500">{count} vaga{count === 1 ? "" : "s"}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section ref={listRef} id="vagas" className="mt-16 pb-10">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">
                  {hasFilters ? `${filtered.length} resultado${filtered.length === 1 ? "" : "s"}` : "Ultimas vagas"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {openCount} vaga{openCount === 1 ? "" : "s"} aberta{openCount === 1 ? "" : "s"}.
                </p>
              </div>
              {hasFilters && (
                <button
                  onClick={() => {
                    setSearch("");
                    setFilterWorkType("");
                    setFilterCategory("");
                  }}
                  className="text-sm font-semibold text-emerald-700"
                >
                  Limpar filtros
                </button>
              )}
            </div>

            {loading && (
              <div className="grid gap-4 md:grid-cols-2">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="h-32 animate-pulse rounded-2xl border border-slate-100 bg-slate-50" />
                ))}
              </div>
            )}

            {error && <div className="rounded-2xl bg-red-50 p-8 text-center text-sm text-red-700">{error}</div>}

            {!loading && !error && filtered.length === 0 && (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-12 text-center">
                <Briefcase className="mx-auto mb-4 h-11 w-11 text-slate-300" />
                <p className="text-sm text-slate-500">
                  {hasFilters ? "Nenhuma vaga encontrada para estes filtros." : "Nenhuma vaga aberta no momento."}
                </p>
              </div>
            )}

            {!loading && !error && filtered.length > 0 && (
              <div className="grid gap-5 md:grid-cols-2">
                {filtered.map((opening) => {
                  const color = getRoleColor(opening.jobRoleName ?? opening.title);
                  const initial = (opening.jobRoleName ?? opening.title ?? "?")[0].toUpperCase();
                  return (
                    <Link
                      key={opening.id}
                      href={`/vagas/${opening.slug}`}
                      className="group rounded-2xl border border-amber-100 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-lg hover:shadow-emerald-950/5"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-4">
                          <span className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${color} font-bold text-white`}>
                            {initial}
                          </span>
                          <div className="min-w-0">
                            <h3 className="truncate font-bold text-slate-950 group-hover:text-emerald-700">{opening.title}</h3>
                            <p className="mt-1 text-sm text-slate-500">{opening.jobRoleName ?? "Time Coala"}</p>
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 flex-shrink-0 text-slate-300 group-hover:text-emerald-700" />
                      </div>

                      <div className="mt-5 flex flex-wrap gap-2">
                        {opening.workType && (
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${WORK_TYPE_COLORS[opening.workType]}`}>
                            {WORK_TYPE_LABELS[opening.workType]}
                          </span>
                        )}
                        {opening.location && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                            <MapPin className="h-3 w-3" />
                            {opening.location}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                          <Users className="h-3 w-3" />
                          {opening.slots} vaga{opening.slots === 1 ? "" : "s"}
                        </span>
                      </div>

                      {opening.closesAt && (
                        <p className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                          <Clock className="h-3.5 w-3.5" />
                          Inscricoes ate {new Date(opening.closesAt).toLocaleDateString("pt-BR")}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </main>

        <footer className="border-t border-slate-100 px-6 py-8 text-center text-xs text-slate-400">
          © {new Date().getFullYear()} Coala Shakes. Todos os direitos reservados.
        </footer>
      </div>
    </div>
  );
}
