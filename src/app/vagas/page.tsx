"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  Banknote,
  BriefcaseBusiness,
  Building2,
  Cake,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Coffee,
  GraduationCap,
  HeartHandshake,
  Instagram,
  MapPin,
  MessageCircle,
  Search,
  ShieldPlus,
  Sparkles,
  Star,
  Ticket,
  TramFront,
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

const FALLBACK_ROLES = [
  "Marketing",
  "Atendente",
  "Operador(a) de loja",
  "Auxiliar de cozinha",
  "Caixa",
  "Gerente de unidade",
  "Estagio",
];

const CARD_ACCENTS = [
  "border-t-[#a8d7b5]",
  "border-t-[#61bed7]",
  "border-t-[#df69a6]",
  "border-t-[#f3d45c]",
  "border-t-[#f5b19f]",
  "border-t-[#c8a7e7]",
];

const ROLE_ICONS = [BriefcaseBusiness, Coffee, HeartHandshake, Sparkles, Ticket, Building2];

const VALUE_CARDS = [
  {
    title: "Quem entra, cresce.",
    text: "70% dos gerentes comecaram no balcao. Tem trilha clara, treino interno e gente disposta a ensinar.",
    footer: "Trilha: balcao -> lider de turno -> subgerente -> gerente",
    icon: Sparkles,
    color: "bg-[#f6d7e8]",
    image: "bg-[#df69a6]/15",
  },
  {
    title: "Time que e time mesmo.",
    text: "A gente revisa escala junto, divide gorjeta por loja e tira foto na quinta. Sem misterio, sem hierarquia desnecessaria.",
    footer: "Nota media no Glassdoor: 4,6 estrelas",
    icon: HeartHandshake,
    color: "bg-[#cdeef6]",
    image: "bg-[#61bed7]/15",
  },
  {
    title: "Salario em dia, sempre.",
    text: "PLR semestral, day-off de aniversario, VT integral, refeicao na loja e Sulamerica apos 90 dias. Sem letras miudas.",
    footer: "Pagamento no 5o dia util, sem excecao",
    icon: Banknote,
    color: "bg-[#fff0bc]",
    image: "bg-[#f3d45c]/20",
  },
];

const BENEFITS = [
  { title: "Shake na casa", text: "1 shake e 1 refeicao por turno trabalhado", icon: Coffee },
  { title: "Vale-transporte", text: "Cobertura completa do deslocamento", icon: TramFront },
  { title: "PLR semestral", text: "Atrelada as metas da sua loja", icon: Banknote },
  { title: "Trilha de carreira", text: "70% dos gerentes comecaram no balcao", icon: GraduationCap },
  { title: "Plano Sulamerica", text: "Apos 90 dias, com coparticipacao", icon: ShieldPlus },
  { title: "Day-off de aniversario", text: "Folga remunerada no seu dia", icon: Cake },
];

const PROCESS_STEPS = [
  {
    title: "Voce se inscreve",
    text: "Formulario rapido mais curriculo opcional. A gente le tudo.",
    color: "bg-[#df69a6]",
  },
  {
    title: "Triagem",
    text: "Em ate 5 dias uteis voce recebe um e-mail confirmando se segue.",
    color: "bg-[#61bed7]",
  },
  {
    title: "Conversa rapida",
    text: "Papo de 30 min com a lider da unidade: pessoa, rotina, expectativa.",
    color: "bg-[#f3d45c]",
  },
  {
    title: "Dia de loja",
    text: "Voce passa um turno com a gente para sentir como e.",
    color: "bg-[#f5b19f]",
  },
  {
    title: "Proposta",
    text: "Se rolar match, mandamos a proposta com tudo escrito. Sem surpresa.",
    color: "bg-[#a8d7b5]",
  },
];

const TESTIMONIALS = [
  {
    quote: "Em 14 meses fui de atendente a subgerente. Aqui ninguem te empurra pra tras.",
    name: "Patricia L.",
    role: "Subgerente - Iguatemi - 2 anos de Coala",
    initials: "PL",
    color: "bg-[#df69a6]",
  },
  {
    quote: "Treinamento e levado a serio mesmo. Comecei sem saber nada de cozinha e hoje toco a estacao fria sozinha.",
    name: "Karina P.",
    role: "Aux. de cozinha - Morumbi - 8 meses",
    initials: "KP",
    color: "bg-[#61bed7]",
  },
  {
    quote: "Esperava so um job de fim de semana. Acabei ficando porque o time e absurdamente bom.",
    name: "Lucas B.",
    role: "Atendente - Higienopolis - 1 ano",
    initials: "LB",
    color: "bg-[#f3d45c]",
  },
];

const FAQS = [
  {
    question: "Preciso ter experiencia?",
    answer: "Para a maioria das vagas de atendimento e balcao, nao. Treinamos do zero. Voce so precisa querer estar la.",
  },
  {
    question: "Quanto tempo leva o processo?",
    answer: "A meta e fechar tudo em ate 12 dias, com retorno por e-mail em cada movimento.",
  },
  {
    question: "Tem oportunidade para menor aprendiz?",
    answer: "Quando a vaga abre, ela aparece na lista. Voce tambem pode deixar seu cadastro no banco de talentos.",
  },
  {
    question: "E se eu nao encontrar uma vaga para o meu perfil?",
    answer: "Mande seu CV para o banco de talentos. Chamamos primeiro quando abrir algo perto de voce.",
  },
];

function titleCaseCity(value?: string) {
  if (!value) return "Sao Paulo";
  return value
    .split(/[,-]/)[0]
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getPreview(text?: string) {
  if (!text) return "Rotina dinamica, atendimento proximo e treinamento completo com o time Coala.";
  return text.length > 145 ? `${text.slice(0, 145).trim()}...` : text;
}

function getRoleLabel(opening: PublicOpening) {
  return opening.jobRoleName || opening.title.split("-")[0]?.trim() || "Time Coala";
}

function Logo() {
  return (
    <span className="inline-flex items-baseline gap-1 leading-none">
      <span className="text-[28px] font-black text-[#df69a6]">coala</span>
      <span className="text-[20px] font-black text-[#61bed7]">shakes</span>
    </span>
  );
}

export default function VagasPage() {
  const [openings, setOpenings] = useState<PublicOpening[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterWorkType, setFilterWorkType] = useState<WorkType | "">("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [openFaq, setOpenFaq] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/hr/openings/public")
      .then((response) => {
        if (!response.ok) throw new Error("public-openings-failed");
        return response.json();
      })
      .then((data) => setOpenings(Array.isArray(data) ? data : []))
      .catch(() => setError("Nao foi possivel carregar as vagas no momento."))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => {
    const dynamic = Array.from(
      openings.reduce((acc, opening) => {
        const key = getRoleLabel(opening);
        acc.set(key, (acc.get(key) ?? 0) + 1);
        return acc;
      }, new Map<string, number>())
    )
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const merged = [...dynamic];
    FALLBACK_ROLES.forEach((role) => {
      if (!merged.some((item) => item.name.toLowerCase() === role.toLowerCase())) {
        merged.push({ name: role, count: 0 });
      }
    });
    return merged;
  }, [openings]);

  const locations = useMemo(() => {
    return Array.from(new Set(openings.map((opening) => titleCaseCity(opening.location)).filter(Boolean))).sort();
  }, [openings]);

  const filtered = openings.filter((opening) => {
    const term = search.toLowerCase().trim();
    const haystack = `${opening.title} ${opening.jobRoleName ?? ""} ${opening.location ?? ""} ${opening.description ?? ""}`.toLowerCase();
    if (term && !haystack.includes(term)) return false;
    if (filterWorkType && opening.workType !== filterWorkType) return false;
    if (filterCategory && getRoleLabel(opening) !== filterCategory) return false;
    if (filterLocation && titleCaseCity(opening.location) !== filterLocation) return false;
    return true;
  });

  const openCount = openings.length;
  const unitCount = locations.length || 5;
  const hasFilters = !!(search || filterWorkType || filterCategory || filterLocation);

  const scrollToList = () => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const resetFilters = () => {
    setSearch("");
    setFilterWorkType("");
    setFilterCategory("");
    setFilterLocation("");
  };

  return (
    <div className="min-h-screen bg-[#f4ecd9] text-[#2a1d29]">
      <header className="sticky top-0 z-40 border-b border-[#2a1d29]/10 bg-[#f4ecd9]/95 backdrop-blur">
        <div className="mx-auto flex h-[92px] max-w-[1728px] items-center justify-between px-6 sm:px-10 lg:px-24">
          <Link href="/vagas" aria-label="Coala Shakes vagas">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-9 text-lg font-bold text-[#5f5360] lg:flex">
            <a href="#cardapio" className="transition hover:text-[#2a1d29]">
              Cardapio
            </a>
            <a href="#unidades" className="transition hover:text-[#2a1d29]">
              Unidades
            </a>
            <button onClick={scrollToList} className="inline-flex items-center gap-2 text-[#df69a6]">
              Vagas
              <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-[#df69a6] px-2 text-sm text-white">
                {openCount || 0}
              </span>
            </button>
            <a href="mailto:trabalheconosco@coalashakes.com" className="transition hover:text-[#2a1d29]">
              Contato
            </a>
          </nav>

          <div className="flex items-center gap-4">
            <a
              href="mailto:trabalheconosco@coalashakes.com"
              className="hidden text-base font-bold text-[#5f5360] transition hover:text-[#2a1d29] md:inline-flex"
            >
              Acompanhar candidatura
            </a>
            <button
              onClick={scrollToList}
              className="inline-flex h-14 items-center gap-3 rounded-full bg-[#2a1d29] px-7 text-base font-black text-white shadow-[0_4px_0_rgba(42,29,41,0.2)] transition hover:-translate-y-0.5"
            >
              Candidatar-se
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-6 pb-20 pt-24 sm:px-10 lg:px-24 lg:pb-28 lg:pt-28">
          <div className="absolute left-0 top-36 h-56 w-56 rounded-full bg-[#61bed7]/20 blur-3xl" />
          <div className="absolute right-8 top-16 h-80 w-80 rounded-full bg-[#df69a6]/25 blur-3xl" />

          <div className="mx-auto grid max-w-[1728px] gap-12 lg:grid-cols-[1fr_640px] lg:items-end">
            <div className="relative z-10">
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-3 rounded-full bg-white px-5 py-3 text-sm font-black uppercase text-[#2a1d29] shadow-[0_3px_0_rgba(42,29,41,0.12)]">
                  <span className="h-4 w-4 rounded-full border-4 border-[#cdeef6] bg-[#61bed7]" />
                  Estamos contratando
                </span>
                <span className="text-lg font-semibold text-[#6f6370]">
                  {openCount} vagas abertas em {unitCount} unidades
                </span>
              </div>

              <h1 className="mt-14 max-w-[920px] text-[76px] font-black leading-[0.92] text-[#2a1d29] sm:text-[104px] lg:text-[132px]">
                cresce com
                <br />
                <span className="text-[#df69a6]">a gente.</span>
                <Coffee className="ml-5 inline h-14 w-14 align-middle text-[#df69a6] sm:h-20 sm:w-20" />
              </h1>

              <p className="mt-10 max-w-[780px] text-2xl leading-relaxed text-[#665b67]">
                Somos <strong className="text-[#2a1d29]">5 lojas Coala Shakes</strong> em Sao Paulo e{" "}
                <strong className="text-[#2a1d29]">68 coalas</strong> servindo shake todo dia. Vagas pra quem gosta de
                gente, de movimento e de aprender num lugar onde da pra crescer de verdade.
              </p>

              <div className="mt-12 flex flex-wrap gap-4">
                <button
                  onClick={scrollToList}
                  className="inline-flex h-20 items-center gap-3 rounded-full bg-[#df69a6] px-9 text-xl font-black text-white shadow-[0_5px_0_rgba(42,29,41,0.16)] transition hover:-translate-y-0.5"
                >
                  Ver vagas abertas
                  <ArrowDown className="h-6 w-6" />
                </button>
                <a
                  href="mailto:trabalheconosco@coalashakes.com?subject=Cadastro%20espontaneo%20-%20Coala%20Shakes"
                  className="inline-flex h-20 items-center rounded-full bg-white px-9 text-xl font-black text-[#2a1d29] shadow-[0_4px_0_rgba(42,29,41,0.14)] transition hover:-translate-y-0.5"
                >
                  Cadastro espontaneo
                </a>
              </div>

              <div className="mt-12 flex max-w-full gap-3 overflow-x-auto pb-2">
                {categories.slice(0, 7).map((category, index) => {
                  const Icon = ROLE_ICONS[index % ROLE_ICONS.length];
                  const active = filterCategory === category.name;
                  return (
                    <button
                      key={category.name}
                      onClick={() => {
                        setFilterCategory(active ? "" : category.name);
                        scrollToList();
                      }}
                      className={`inline-flex h-14 flex-shrink-0 items-center gap-3 rounded-full px-6 text-base font-black shadow-[0_3px_0_rgba(42,29,41,0.12)] transition ${
                        active ? "bg-[#df69a6] text-white" : "bg-white text-[#2a1d29]"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      {category.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="relative z-10 lg:pb-4">
              <div className="rounded-[34px] bg-[#2a1d29] p-7 shadow-[0_5px_0_rgba(42,29,41,0.18)]">
                <div className="flex items-start gap-5 rounded-[22px] bg-[#fbf0d4] p-6">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#d7d0d8] text-[#2a1d29]">
                    <Star className="h-7 w-7 fill-[#df69a6] text-[#df69a6]" />
                  </div>
                  <div>
                    <p className="text-xl font-black leading-snug">
                      "Aqui eu cresci de auxiliar pra subgerente em 14 meses."
                    </p>
                    <p className="mt-3 text-sm font-bold text-[#6f6370]">Patricia - 2 anos de Coala</p>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <div className="rounded-[28px] bg-white p-7 shadow-[0_4px_0_rgba(42,29,41,0.14)]">
                  <p className="text-sm font-black uppercase text-[#6f6370]">Vagas hoje</p>
                  <p className="mt-5 text-7xl font-black text-[#df69a6]">{openCount}</p>
                  <p className="mt-4 text-lg text-[#6f6370]">em {unitCount} unidades de SP</p>
                </div>
                <div className="rounded-[28px] bg-[#61bed7] p-7 text-white shadow-[0_4px_0_rgba(42,29,41,0.14)]">
                  <p className="text-sm font-black uppercase text-white/85">Contratados em 2026</p>
                  <p className="mt-5 text-7xl font-black">12</p>
                  <p className="mt-4 text-lg text-white/85">8 indicacoes internas</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="px-6 py-20 sm:px-10 lg:px-24">
          <div className="mx-auto max-w-[1728px]">
            <p className="text-sm font-black uppercase text-[#6f6370]">Por que Coala</p>
            <h2 className="mt-4 max-w-[920px] text-6xl font-black leading-none text-[#2a1d29] lg:text-8xl">
              Trabalho com energia,
              <br />
              ambiente <span className="text-[#df69a6]">com afeto.</span>
            </h2>

            <div className="mt-14 grid gap-6 lg:grid-cols-3">
              {VALUE_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <article key={card.title} className={`relative min-h-[340px] overflow-hidden rounded-[28px] p-8 shadow-[0_4px_0_rgba(42,29,41,0.14)] ${card.color}`}>
                    <div className={`absolute -right-8 -top-8 h-40 w-40 rounded-full ${card.image}`} />
                    <Icon className="h-11 w-11 text-[#2a1d29]" />
                    <h3 className="mt-16 text-4xl font-black text-[#df69a6]">{card.title}</h3>
                    <p className="mt-7 text-xl leading-relaxed text-[#665b67]">{card.text}</p>
                    <p className="mt-8 inline-flex rounded-full bg-white px-5 py-3 text-sm font-black text-[#2a1d29]">
                      {card.footer}
                    </p>
                  </article>
                );
              })}
            </div>

            <div className="mt-14 rounded-[30px] bg-white p-8 shadow-[0_4px_0_rgba(42,29,41,0.14)] lg:p-12">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h3 className="text-3xl font-black">Beneficios na pratica</h3>
                <p className="text-lg text-[#6f6370]">vale pra todo mundo, do estagiario ao gerente</p>
              </div>
              <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-6">
                {BENEFITS.map((benefit) => {
                  const Icon = benefit.icon;
                  return (
                    <div key={benefit.title}>
                      <Icon className="h-9 w-9 text-[#2a1d29]" />
                      <h4 className="mt-6 text-lg font-black">{benefit.title}</h4>
                      <p className="mt-2 text-base leading-snug text-[#6f6370]">{benefit.text}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section ref={listRef} id="vagas" className="relative bg-[#2a1d29] px-6 pb-24 pt-24 text-white sm:px-10 lg:px-24">
          <div className="mx-auto max-w-[1728px]">
            <div className="grid gap-10 lg:grid-cols-[1fr_420px] lg:items-end">
              <div>
                <p className="text-sm font-black uppercase text-white/55">Oportunidades abertas agora</p>
                <h2 className="mt-5 text-7xl font-black leading-none lg:text-9xl">
                  vagas <span className="text-[#df69a6]">frescas.</span>
                </h2>
              </div>
              <div className="text-2xl text-white/70">
                <strong className="block text-4xl text-white">{openCount}</strong>
                oportunidades em {unitCount} unidades, atualizadas semanalmente
              </div>
            </div>

            <div className="mt-12 grid gap-3 rounded-[32px] bg-white p-4 text-[#2a1d29] shadow-[0_4px_0_rgba(0,0,0,0.2)] lg:grid-cols-[1fr_270px_270px]">
              <label className="flex min-h-20 items-center gap-4 px-5">
                <Search className="h-6 w-6 text-[#6f6370]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por cargo, unidade..."
                  className="w-full border-0 bg-transparent text-xl font-medium outline-none placeholder:text-[#a8a0a9]"
                />
              </label>
              <label className="flex min-h-20 items-center rounded-full bg-[#f4ecd9] px-6">
                <select
                  value={filterCategory}
                  onChange={(event) => setFilterCategory(event.target.value)}
                  className="w-full appearance-none bg-transparent text-lg font-black outline-none"
                >
                  <option value="">Todos os cargos</option>
                  {categories.map((category) => (
                    <option key={category.name} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="h-5 w-5" />
              </label>
              <label className="flex min-h-20 items-center rounded-full bg-[#f4ecd9] px-6">
                <select
                  value={filterLocation}
                  onChange={(event) => setFilterLocation(event.target.value)}
                  className="w-full appearance-none bg-transparent text-lg font-black outline-none"
                >
                  <option value="">Todas as unidades</option>
                  {locations.map((location) => (
                    <option key={location} value={location}>
                      {location}
                    </option>
                  ))}
                </select>
                <ChevronDown className="h-5 w-5" />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <select
                value={filterWorkType}
                onChange={(event) => setFilterWorkType(event.target.value as WorkType | "")}
                className="rounded-full border border-white/15 bg-white/10 px-5 py-3 text-sm font-black text-white outline-none"
              >
                <option className="text-[#2a1d29]" value="">
                  Todas as modalidades
                </option>
                <option className="text-[#2a1d29]" value="presencial">
                  Presencial
                </option>
                <option className="text-[#2a1d29]" value="remoto">
                  Remoto
                </option>
                <option className="text-[#2a1d29]" value="hibrido">
                  Hibrido
                </option>
              </select>
              {hasFilters && (
                <button onClick={resetFilters} className="rounded-full bg-white/10 px-5 py-3 text-sm font-black text-white">
                  Limpar filtros
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="relative bg-[#f4ecd9] px-6 pb-24 sm:px-10 lg:px-24">
          <div className="absolute left-0 right-0 top-0 h-8 -translate-y-full bg-[radial-gradient(circle_at_16px_-4px,#f4ecd9_22px,transparent_23px)] bg-[length:32px_32px]" />
          <div className="mx-auto max-w-[1728px] pt-20">
            {loading && (
              <div className="grid gap-6 lg:grid-cols-3">
                {[0, 1, 2, 3, 4, 5].map((item) => (
                  <div key={item} className="h-[320px] animate-pulse rounded-[28px] bg-white/70" />
                ))}
              </div>
            )}

            {error && <div className="rounded-[28px] bg-white p-12 text-center text-lg font-bold text-[#df4950]">{error}</div>}

            {!loading && !error && filtered.length === 0 && (
              <div className="rounded-[28px] bg-white p-12 text-center shadow-[0_4px_0_rgba(42,29,41,0.14)]">
                <BriefcaseBusiness className="mx-auto h-14 w-14 text-[#df69a6]" />
                <h3 className="mt-6 text-3xl font-black">Nenhuma vaga encontrada.</h3>
                <p className="mt-3 text-lg text-[#6f6370]">
                  {hasFilters ? "Tente ajustar os filtros ou deixe seu cadastro espontaneo." : "Volte em breve ou envie seu CV para o banco de talentos."}
                </p>
              </div>
            )}

            {!loading && !error && filtered.length > 0 && (
              <div className="grid gap-7 lg:grid-cols-3">
                {filtered.map((opening, index) => {
                  const Icon = ROLE_ICONS[index % ROLE_ICONS.length];
                  const location = titleCaseCity(opening.location);
                  return (
                    <Link
                      key={opening.id}
                      href={`/vagas/${opening.slug}`}
                      className={`group flex min-h-[360px] flex-col overflow-hidden rounded-[28px] border-t-[8px] bg-white shadow-[0_4px_0_rgba(42,29,41,0.14)] transition hover:-translate-y-1 ${CARD_ACCENTS[index % CARD_ACCENTS.length]}`}
                    >
                      <div className="flex flex-1 gap-6 p-8">
                        <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-[#f4ecd9] text-[#2a1d29]">
                          <Icon className="h-9 w-9" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="text-3xl font-black leading-tight text-[#2a1d29]">{opening.title}</h3>
                            {index < 3 && (
                              <span className="rounded-full bg-[#61bed7] px-3 py-1 text-xs font-black uppercase text-white">Nova</span>
                            )}
                          </div>
                          <p className="mt-5 text-sm font-black uppercase text-[#6f6370]">Coala {location} - Sao Paulo</p>
                          <p className="mt-7 text-xl leading-relaxed text-[#665b67]">{getPreview(opening.description)}</p>
                          <div className="mt-8 flex flex-wrap gap-5 text-base font-black text-[#2a1d29]">
                            <span className="inline-flex items-center gap-2">
                              <MapPin className="h-5 w-5" />
                              {location}
                            </span>
                            {opening.workType && <span>{WORK_TYPE_LABELS[opening.workType]}</span>}
                            <span className="inline-flex items-center gap-2">
                              <Users className="h-5 w-5" />
                              {opening.slots} vaga{opening.slots === 1 ? "" : "s"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between border-t border-[#2a1d29]/10 px-8 py-6">
                        <span className="text-xl font-black">A combinar</span>
                        <span className="inline-flex items-center gap-2 text-lg font-black text-[#2a1d29] group-hover:text-[#df69a6]">
                          ver vaga
                          <ChevronRight className="h-5 w-5" />
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="bg-[#f4ecd9] px-6 py-24 sm:px-10 lg:px-24">
          <div className="mx-auto max-w-[1728px] text-center">
            <p className="text-sm font-black uppercase text-[#6f6370]">Como funciona</p>
            <h2 className="mx-auto mt-5 max-w-[860px] text-6xl font-black leading-none lg:text-8xl">
              Do <span className="text-[#df69a6]">oi</span> ao <span className="text-[#61bed7]">vem!</span> em 12 dias.
            </h2>
            <p className="mt-9 text-xl text-[#6f6370]">
              Processo curto, sem etapa que nao faz sentido. Voce e avisado por e-mail em cada movimento.
            </p>

            <div className="mt-20 grid gap-6 md:grid-cols-2 xl:grid-cols-5">
              {PROCESS_STEPS.map((step, index) => (
                <article key={step.title} className="relative rounded-[28px] bg-white p-8 text-left shadow-[0_4px_0_rgba(42,29,41,0.14)]">
                  <p className="text-sm font-black text-[#df69a6]">0{index + 1}</p>
                  <span className={`mt-5 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-black text-white ${step.color}`}>
                    {index + 1}
                  </span>
                  <h3 className="mt-8 text-2xl font-black">{step.title}</h3>
                  <p className="mt-4 text-lg leading-relaxed text-[#6f6370]">{step.text}</p>
                  {index < PROCESS_STEPS.length - 1 && (
                    <ChevronRight className="absolute -right-5 top-1/2 hidden h-9 w-9 -translate-y-1/2 text-[#2a1d29] xl:block" />
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#efe6cf] px-6 py-24 sm:px-10 lg:px-24">
          <div className="mx-auto max-w-[1728px]">
            <div className="grid gap-6 lg:grid-cols-[1fr_420px] lg:items-end">
              <h2 className="text-6xl font-black leading-none lg:text-8xl">
                Quem esta <span className="text-[#df69a6]">aqui</span> conta.
              </h2>
              <p className="text-xl leading-relaxed text-[#6f6370]">
                Coletado entre coalas com 6+ meses de casa. Reviews completos no Glassdoor.
              </p>
            </div>

            <div className="mt-16 grid gap-7 lg:grid-cols-3">
              {TESTIMONIALS.map((testimonial) => (
                <article key={testimonial.name} className="rounded-[28px] bg-white p-8 shadow-[0_4px_0_rgba(42,29,41,0.14)]">
                  <MessageCircle className="h-12 w-12 text-[#df69a6]" />
                  <p className="mt-9 text-2xl font-black leading-relaxed">{testimonial.quote}</p>
                  <div className="mt-10 flex items-center gap-5">
                    <span className={`flex h-16 w-16 items-center justify-center rounded-full text-xl font-black text-white ${testimonial.color}`}>
                      {testimonial.initials}
                    </span>
                    <div>
                      <p className="text-lg font-black">{testimonial.name}</p>
                      <p className="text-base text-[#6f6370]">{testimonial.role}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#f4ecd9] px-6 py-24 sm:px-10 lg:px-24">
          <div className="mx-auto max-w-[1120px] text-center">
            <p className="text-sm font-black uppercase text-[#6f6370]">Perguntas que aparecem</p>
            <h2 className="mt-5 text-5xl font-black leading-none lg:text-7xl">A gente respondeu antes.</h2>

            <div className="mt-14 space-y-5 text-left">
              {FAQS.map((faq, index) => {
                const active = openFaq === index;
                return (
                  <button
                    key={faq.question}
                    onClick={() => setOpenFaq(active ? -1 : index)}
                    className="w-full rounded-[24px] bg-white p-7 text-left shadow-[0_4px_0_rgba(42,29,41,0.12)]"
                  >
                    <span className="flex items-center justify-between gap-6">
                      <span className="text-2xl font-black">{faq.question}</span>
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f4ecd9]">
                        <ChevronDown className={`h-5 w-5 transition ${active ? "rotate-180" : ""}`} />
                      </span>
                    </span>
                    {active && <span className="mt-7 block text-xl leading-relaxed text-[#6f6370]">{faq.answer}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-[#f4ecd9] px-6 pb-24 sm:px-10 lg:px-24">
          <div className="relative mx-auto max-w-[1728px] overflow-hidden rounded-[42px] bg-[#df69a6] p-10 text-white shadow-[0_4px_0_rgba(42,29,41,0.14)] lg:p-20">
            <Coffee className="absolute right-24 top-14 h-20 w-20 rotate-12 text-[#2a1d29]" />
            <div className="absolute -bottom-24 -right-10 h-72 w-72 rounded-full bg-[#d7d0d8]" />
            <div className="absolute bottom-9 right-16 hidden h-36 w-36 rounded-full bg-[#c8c1ca] lg:block">
              <div className="absolute left-8 top-12 h-5 w-5 rounded-full bg-[#2a1d29]" />
              <div className="absolute right-8 top-12 h-5 w-5 rounded-full bg-[#2a1d29]" />
              <div className="absolute bottom-9 left-1/2 h-9 w-12 -translate-x-1/2 rounded-full bg-[#2a1d29]" />
            </div>
            <div className="relative z-10 max-w-[720px]">
              <p className="text-sm font-black uppercase text-white/75">Nao achou sua vaga?</p>
              <h2 className="mt-6 text-6xl font-black leading-none lg:text-8xl">Manda teu CV</h2>
              <p className="mt-10 text-2xl leading-relaxed text-white/85">
                Banco de talentos sempre aberto. Quando algo abrir na unidade mais perto de voce, a gente te chama primeiro.
              </p>
              <div className="mt-12 flex flex-wrap items-center gap-5">
                <a
                  href="mailto:trabalheconosco@coalashakes.com?subject=Cadastro%20espontaneo%20-%20Coala%20Shakes"
                  className="inline-flex h-16 items-center gap-3 rounded-full bg-[#2a1d29] px-8 text-lg font-black text-white shadow-[0_4px_0_rgba(42,29,41,0.2)]"
                >
                  Cadastrar curriculo
                  <ArrowRight className="h-5 w-5" />
                </a>
                <a href="mailto:trabalheconosco@coalashakes.com" className="text-lg font-black underline decoration-2 underline-offset-4">
                  ou manda direto pro nosso e-mail
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#2a1d29] px-6 py-20 text-white sm:px-10 lg:px-24">
        <div className="mx-auto grid max-w-[1728px] gap-12 lg:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-9 max-w-[420px] text-xl leading-relaxed text-white/62">
              Shakes artesanais e ambiente bom de trabalhar. Cinco lojas em Sao Paulo, desde 2019.
            </p>
            <div className="mt-9 flex gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
                <Instagram className="h-6 w-6" />
              </span>
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
                <CircleDot className="h-6 w-6" />
              </span>
            </div>
          </div>
          <div id="unidades">
            <h3 className="text-sm font-black uppercase text-white/45">Unidades</h3>
            <ul className="mt-7 space-y-4 text-xl text-white/68">
              {(locations.length ? locations : ["Iguatemi", "Higienopolis", "JK", "Morumbi", "Pinheiros"]).map((location) => (
                <li key={location} className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full bg-[#df69a6]" />
                  Coala {location} <span className="text-white/32">- Sao Paulo - SP</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-black uppercase text-white/45">Fala com a gente</h3>
            <div className="mt-7 space-y-5 text-xl text-white/68">
              <p>trabalheconosco@coalashakes.com</p>
              <p>WhatsApp RH - (11) 99999-0000</p>
              <p>Resposta em ate 5 dias uteis.</p>
            </div>
          </div>
        </div>
        <div className="mx-auto mt-16 flex max-w-[1728px] flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-8 text-base text-white/38">
          <p>{new Date().getFullYear()} Coala Shakes - op.coalashakes.com/vagas</p>
          <a href="mailto:trabalheconosco@coalashakes.com">Privacidade</a>
        </div>
      </footer>
    </div>
  );
}
