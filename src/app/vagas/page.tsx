"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  BriefcaseBusiness,
  Cake,
  ChevronDown,
  ChevronRight,
  Coffee,
  GraduationCap,
  HeartHandshake,
  Instagram,
  Mail,
  Search,
  ShieldPlus,
  Sparkles,
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
  hibrido: "Híbrido",
};

const FALLBACK_ROLES = [
  "Atendente",
  "Operador(a) de loja",
  "Auxiliar de cozinha",
  "Caixa",
  "Gerente de unidade",
  "Estágio · Marketing",
];

const FALLBACK_PUBLIC_UNITS = [
  "Tirirical",
  "João Paulo",
  "Tirimai",
  "Administrativo/CTA",
];

const ROLE_META = [
  { emoji: "🥤", color: "#EE6FA8" },
  { emoji: "🏪", color: "#3FBCD9" },
  { emoji: "🍳", color: "#F7D154" },
  { emoji: "💳", color: "#FFB39A" },
  { emoji: "📋", color: "#A2D8B5" },
  { emoji: "✨", color: "#C9A6E0" },
];

const ROLE_META_BY_KEY = [
  { key: "atendente", emoji: "🥤", color: "#EE6FA8" },
  { key: "operador", emoji: "🏪", color: "#3FBCD9" },
  { key: "auxiliar de cozinha", emoji: "🍳", color: "#F7D154" },
  { key: "cozinha", emoji: "🍳", color: "#F7D154" },
  { key: "caixa", emoji: "💳", color: "#FFB39A" },
  { key: "gerente", emoji: "📋", color: "#A2D8B5" },
  { key: "marketing", emoji: "✨", color: "#C9A6E0" },
];

const VALUE_CARDS = [
  {
    emoji: "🚀",
    title: "Quem entra, cresce.",
    text: "70% dos gerentes começaram no balcão. Trilha clara, treino interno e gente disposta a ensinar.",
    footer: "Trilha: balcão → líder → gerente",
    color: "#EE6FA8",
    background: "#FCDFEB",
  },
  {
    emoji: "🤝",
    title: "Time que é time mesmo.",
    text: "Revisão de escala conjunta e ambiente sem hierarquia desnecessária. Todo mundo contribui para o resultado.",
    footer: "Escala revisada todo mês",
    color: "#3FBCD9",
    background: "#CFEEF6",
  },
  {
    emoji: "💸",
    title: "Salário em dia, sempre.",
    text: "Bonificações, day-off de aniversário, VT integral, refeições de acordo com a jornada e plano odontológico.",
    footer: "Pagamento no 5º dia útil",
    color: "#9A7200",
    background: "#FBEDC2",
  },
];

const BENEFITS = [
  { title: "Shake na casa", text: "1 shake por turno", icon: Coffee, color: "#EE6FA8" },
  { title: "Vale-transporte", text: "Cobertura total do deslocamento", icon: TramFront, color: "#3FBCD9" },
  { title: "Bonificações", text: "Atreladas ao desempenho e metas", icon: Banknote, color: "#E0A100" },
  { title: "Trilha de carreira", text: "70% dos gerentes vieram do balcão", icon: GraduationCap, color: "#2FA86A" },
  { title: "Plano odontológico", text: "Cobertura odontológica para você", icon: ShieldPlus, color: "#9A6FD0" },
  { title: "Day-off aniversário", text: "Folga remunerada no seu dia", icon: Cake, color: "#F0794F" },
];

const PROCESS_STEPS = [
  { color: "#EE6FA8", title: "Você se inscreve", text: "Formulário rápido + currículo opcional. A gente lê tudo." },
  { color: "#3FBCD9", title: "Triagem", text: "Nosso time de RH avalia o perfil e confirma os próximos passos." },
  { color: "#F7D154", textColor: "#2A1F2A", title: "Conversa rápida", text: "Papo sobre rotina, expectativas e disponibilidade." },
  { color: "#FFB39A", title: "Dia de loja", text: "Quando fizer sentido, você sente na prática como é a operação." },
  { color: "#C7E8C8", textColor: "#2A1F2A", title: "Proposta", text: "Se rolar match, mandamos tudo por escrito. Sem surpresa." },
  { color: "#EE6FA8", title: "Contratação", text: "Documentação, integração e primeiro turno. Do oi ao crachá." },
];

const FAQS = [
  {
    question: "Preciso ter experiência?",
    answer: "Para a maioria das vagas de atendimento e balcão, não. Treinamos do zero — você só precisa querer estar lá.",
  },
  {
    question: "Quanto tempo leva o processo?",
    answer: "Nosso time de RH manterá você atualizado sobre cada etapa do processo.",
  },
  {
    question: "Há oportunidades para menor aprendiz?",
    answer: "Ainda não temos vagas para menor aprendiz abertas. Deixe seu cadastro no banco de talentos e entraremos em contato quando houver.",
  },
  {
    question: "E se eu não encontrar uma vaga pro meu perfil?",
    answer: "Deixa seu currículo no banco de talentos. A gente te chama assim que uma oportunidade surgir!",
  },
];

function formatUnitName(name: string) {
  return name.replace(/^\s*(qui[oa]?sque|loja|unidade)\s+/i, "").trim() || name;
}

function getLocationLabel(value?: string) {
  if (!value?.trim()) return "São Luís";
  return value
    .split(/[,-]/)[0]
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\p{L}/gu, (char) => char.toLocaleUpperCase("pt-BR"));
}

function getPreview(text?: string) {
  const fallback = "Rotina dinâmica, atendimento próximo e treinamento completo com o time Coala.";
  const source = text?.split("\n")[0]?.trim() || fallback;
  return source.length > 132 ? `${source.slice(0, 132).trim()}...` : source;
}

function getRoleLabel(opening: PublicOpening) {
  return opening.jobRoleName || opening.title.split("-")[0]?.split("—")[0]?.trim() || "Time Coala";
}

function getRoleMeta(label: string) {
  const normalized = label.toLocaleLowerCase("pt-BR");
  const mapped = ROLE_META_BY_KEY.find((item) => normalized.includes(item.key));
  if (mapped) return mapped;

  const index = Math.abs(Array.from(label).reduce((sum, char) => sum + char.charCodeAt(0), 0)) % ROLE_META.length;
  return ROLE_META[index];
}

function daysUntil(date?: string) {
  if (!date) return null;
  const diff = new Date(date).getTime() - Date.now();
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-baseline gap-[0.3em] leading-none">
      <span className="fd text-[#EE6FA8]" style={{ fontSize: size, letterSpacing: "-0.04em" }}>coala</span>
      <span className="fd text-[#3FBCD9]" style={{ fontSize: size * 0.62 }}>shakes</span>
    </span>
  );
}

function Cup({ size = 56, fill = "#EE6FA8" }: { size?: number; fill?: string }) {
  return (
    <svg viewBox="0 0 64 80" width={size} height={size} aria-hidden="true">
      <rect x="10" y="8" width="44" height="10" rx="3" fill="#2A1F2A" />
      <rect x="36" y="0" width="6" height="22" rx="2" fill="#F7D154" />
      <path d="M14 18 L50 18 L46 72 Q46 76 42 76 L22 76 Q18 76 18 72 Z" fill={fill} />
      <path d="M20 22 L22 70" stroke="white" strokeWidth="3" opacity=".35" strokeLinecap="round" />
      <circle cx="42" cy="14" r="3" fill="#D9528E" />
    </svg>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function PageStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
      .vagas-publicas {
        --pk: #EE6FA8;
        --pk-d: #D9528E;
        --cy: #3FBCD9;
        --cr: #F4ECD8;
        --ik: #2A1F2A;
        --ik2: #5B4C5B;
        --ye: #F7D154;
        --mn: #C7E8C8;
        --pe: #FFB39A;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
        -webkit-font-smoothing: antialiased;
        max-width: 100vw;
        overflow-x: hidden;
      }
      .vagas-publicas * {
        min-width: 0;
      }
      .vagas-publicas .fd {
        font-family: 'Baloo 2', system-ui, sans-serif !important;
        font-weight: 800 !important;
        letter-spacing: -0.025em;
      }
      .vagas-publicas .fm {
        font-family: 'JetBrains Mono', monospace;
        font-weight: 600;
      }
      .vagas-publicas .vagas-shell {
        width: min(1280px, calc(100vw - clamp(40px, 7vw, 120px)));
        max-width: calc(100vw - 40px);
        margin-left: auto;
        margin-right: auto;
      }
      .vagas-publicas .vagas-readable {
        width: min(880px, calc(100vw - clamp(40px, 7vw, 120px)));
        max-width: calc(100vw - 40px);
        margin-left: auto;
        margin-right: auto;
      }
      .vagas-publicas .stk {
        box-shadow: 2px 2px 0 rgba(42,31,42,.12);
      }
      .vagas-publicas .btn {
        border-radius: 999px !important;
        box-shadow: 0 4px 0 rgba(42,31,42,.15) !important;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif !important;
        transition: transform .12s, box-shadow .12s;
      }
      .vagas-publicas .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 0 rgba(42,31,42,.15);
      }
      .vagas-publicas .btn:active {
        transform: translateY(2px);
        box-shadow: 0 2px 0 rgba(42,31,42,.15);
      }
      .vagas-publicas .squig {
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 8'><path d='M0 4 Q7.5 0,15 4 T30 4 T45 4 T60 4' fill='none' stroke='%23F7D154' stroke-width='3' stroke-linecap='round'/></svg>");
        background-repeat: repeat-x;
        background-position: 0 100%;
        background-size: 60px 8px;
        padding-bottom: 8px;
      }
      @keyframes vagasFloat {
        0%,100% { transform: translateY(0) rotate(-4deg); }
        50% { transform: translateY(-10px) rotate(4deg); }
      }
      @keyframes vagasCardIconFloat {
        0%,100% { transform: translate3d(0,0,0) rotate(-6deg) scale(1); }
        50% { transform: translate3d(0,-10px,0) rotate(4deg) scale(1.04); }
      }
      @keyframes vagasCardIconPulse {
        0%,100% { transform: translate3d(0,0,0) scale(1); }
        50% { transform: translate3d(0,-3px,0) scale(1.08); }
      }
      .vagas-publicas .wgl {
        animation: vagasFloat 3.6s ease-in-out infinite;
        transform-origin: bottom center;
        filter: drop-shadow(0 10px 12px rgba(238,111,168,.28));
        will-change: transform;
      }
      .vagas-publicas .wgl:hover {
        animation-duration: 1.1s;
      }
      @keyframes vagasMarquee {
        from { transform: translateX(0); }
        to { transform: translateX(-50%); }
      }
      .vagas-publicas .mq {
        animation: vagasMarquee 36s linear infinite;
      }
      .vagas-publicas .card-hover {
        transition: transform .2s, box-shadow .2s;
      }
      .vagas-publicas .card-hover:hover {
        transform: translateY(-4px);
        box-shadow: 0 12px 32px rgba(42,31,42,.12);
      }
      .vagas-publicas .value-ghost-icon {
        animation: vagasCardIconFloat 4.8s ease-in-out infinite;
        transform-origin: center;
        will-change: transform;
      }
      .vagas-publicas .value-main-icon {
        animation: vagasCardIconPulse 3.4s ease-in-out infinite;
        display: inline-block;
        transform-origin: center;
        will-change: transform;
      }
      @media (prefers-reduced-motion: reduce) {
        .vagas-publicas .mq,
        .vagas-publicas .wgl,
        .vagas-publicas .value-ghost-icon,
        .vagas-publicas .value-main-icon {
          animation: none !important;
        }
      }
      @media (max-width: 640px) {
        .vagas-publicas .vagas-shell,
        .vagas-publicas .vagas-readable {
          width: calc(100vw - 40px);
          max-width: calc(100vw - 40px);
        }
      }
    ` }} />
  );
}

interface PublicStats {
  unitCount: number;
  units: string[];
  collaboratorCount: number;
}

const FALLBACK_PUBLIC_STATS: PublicStats = {
  unitCount: FALLBACK_PUBLIC_UNITS.length,
  units: FALLBACK_PUBLIC_UNITS,
  collaboratorCount: 0,
};

function normalizePublicStats(data: unknown): PublicStats {
  if (!data || typeof data !== "object") return FALLBACK_PUBLIC_STATS;

  const payload = data as Partial<PublicStats>;
  const fetchedUnits = Array.isArray(payload.units)
    ? payload.units.filter((unit): unit is string => typeof unit === "string" && unit.trim().length > 0)
    : [];
  const units = fetchedUnits.length > 0 ? fetchedUnits : FALLBACK_PUBLIC_UNITS;
  const unitCount = typeof payload.unitCount === "number" && payload.unitCount > 0
    ? payload.unitCount
    : units.length;
  const collaboratorCount = typeof payload.collaboratorCount === "number" && payload.collaboratorCount > 0
    ? payload.collaboratorCount
    : 0;

  return { unitCount, units, collaboratorCount };
}

export default function VagasPage() {
  const [openings, setOpenings] = useState<PublicOpening[]>([]);
  const [stats, setStats] = useState<PublicStats>(FALLBACK_PUBLIC_STATS);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/hr/openings/public")
      .then((response) => {
        if (!response.ok) throw new Error("public-openings-failed");
        return response.json();
      })
      .then((data) => setOpenings(Array.isArray(data) ? data : []))
      .catch(() => setError("Não foi possível carregar as vagas no momento."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/hr/public-stats")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setStats(normalizePublicStats(data)))
      .catch(() => undefined)
      .finally(() => setStatsLoaded(true));
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
    return Array.from(new Set(openings.map((opening) => getLocationLabel(opening.location)).filter(Boolean))).sort();
  }, [openings]);

  const filtered = openings.filter((opening) => {
    const term = search.toLowerCase().trim();
    const haystack = `${opening.title} ${opening.jobRoleName ?? ""} ${opening.location ?? ""} ${opening.description ?? ""}`.toLowerCase();
    if (term && !haystack.includes(term)) return false;
    if (filterCategory && getRoleLabel(opening) !== filterCategory) return false;
    if (filterLocation && getLocationLabel(opening.location) !== filterLocation) return false;
    return true;
  });

  const openCount = openings.length;
  const unitCount = stats.unitCount;
  const collaboratorCount = stats.collaboratorCount;
  const hasOpenings = openCount > 0;
  const hasFilters = !!(search || filterCategory || filterLocation);
  const footerUnits = useMemo(() => {
    return Array.from(new Set(stats.units.map(formatUnitName)));
  }, [stats.units]);
  const statsSummary = statsLoaded && unitCount > 0
    ? `${openCount} ${pluralize(openCount, "vaga", "vagas")} em ${unitCount} ${pluralize(unitCount, "unidade", "unidades")}`
    : `${openCount} ${pluralize(openCount, "vaga", "vagas")}`;
  const hiringBadge = openCount > 0
    ? {
      label: "Estamos contratando",
      dotClass: "bg-[#3FBCD9]",
      dotPingClass: "bg-[#3FBCD9]",
    }
    : {
      label: "Novas vagas em breve!",
      dotClass: "bg-[#F7D154]",
      dotPingClass: "bg-[#F7D154]",
    };
  const companySummary = (
    <>
      Somos <strong className="text-[#2A1F2A]">{unitCount} unidades Coala Shakes</strong> em São Luís/MA
      {collaboratorCount > 0 ? (
        <> e <strong className="text-[#2A1F2A]">{collaboratorCount} coalas</strong></>
      ) : null} servindo shake todo dia.
    </>
  );
  const scrollToList = () => {
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", "#vagas");
  };
  const resetFilters = () => {
    setSearch("");
    setFilterCategory("");
    setFilterLocation("");
  };

  return (
    <div className="vagas-publicas min-h-screen overflow-x-hidden bg-[#F4ECD8] text-[#2A1F2A]">
      <PageStyles />

      <header className="sticky top-0 z-40 border-b border-[#2A1F2A]/10 bg-[#F4ECD8]/95 backdrop-blur">
        <div className="vagas-shell flex h-[68px] items-center gap-4">
          <Link href="/vagas" aria-label="Coala Shakes vagas" className="shrink-0">
            <Logo />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/vagas/banco-de-talentos"
              className="hidden h-10 items-center rounded-full border border-[#2A1F2A]/15 px-4 text-[13px] font-bold text-[#5B4C5B] transition hover:-translate-y-0.5 sm:inline-flex"
            >
              Banco de talentos
            </Link>
	            <a
	              href="#vagas"
	              onClick={(event) => {
	                event.preventDefault();
	                scrollToList();
	              }}
	              className="btn inline-flex h-10 items-center gap-1.5 bg-[#2A1F2A] px-4 text-[13px] font-bold text-white"
	            >
	              Ver vagas <ArrowRight className="h-3.5 w-3.5" />
	            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="absolute -right-20 -top-24 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,#EE6FA8_0%,transparent_65%)] opacity-55 blur-2xl" />
          <div className="absolute -left-32 top-40 h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle,#3FBCD9_0%,transparent_65%)] opacity-35 blur-2xl" />
	          <div className="vagas-shell relative pb-12 pt-10 md:pt-14">
	            <div className="mb-6 flex items-center gap-3">
	              <span className="stk inline-flex h-8 items-center gap-2 rounded-full bg-white px-3 text-[11.5px] font-bold uppercase tracking-wider">
	                <span className="relative inline-flex">
	                  <span className={`absolute inset-0 animate-ping rounded-full ${hiringBadge.dotPingClass}`} />
	                  <span className={`relative h-2 w-2 rounded-full ${hiringBadge.dotClass}`} />
	                </span>
	                {hiringBadge.label}
	              </span>
              <span className="text-[12px] text-[#5B4C5B]">{statsSummary}</span>
            </div>

            <div className="grid items-end gap-8 md:grid-cols-12">
              <div className="md:col-span-7">
                <h1 className="fd leading-[0.9]" style={{ fontSize: "clamp(52px,9vw,128px)" }}>
                  cresça com
                  <br />
                  <span className="text-[#EE6FA8]">a gente.</span>
                  <span className="wgl ml-3 inline-block align-middle"><Cup size={68} /></span>
                </h1>
                <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-[#5B4C5B]">
                  {companySummary} Vagas para quem gosta
                  de gente, de movimento e quer crescer de verdade.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href="/vagas/banco-de-talentos"
                    className="btn inline-flex h-14 items-center gap-2 bg-[#EE6FA8] px-8 text-[15px] font-bold text-white"
                  >
                    Inscreva-se no banco de talentos <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>

                <div className="-mx-5 mt-10 overflow-hidden" style={{ maskImage: "linear-gradient(90deg,transparent,black 8%,black 92%,transparent)" }}>
                  <div className="mq flex w-max gap-3">
                    {[...categories.slice(0, 8), ...categories.slice(0, 8)].map((role, index) => {
                      const meta = getRoleMeta(role.name);
                      return (
                        <button
                          key={`${role.name}-${index}`}
                          type="button"
                          onClick={() => {
                            setFilterCategory(role.name);
                            scrollToList();
                          }}
                          className="stk inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-3.5 text-[12.5px] font-bold"
                        >
                          <span>{meta.emoji}</span>{role.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:col-span-5 md:grid-cols-2">
                <div className="stk rounded-3xl bg-white p-5">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-[#5B4C5B]">no mercado desde</div>
                  <div className="fd mt-1 text-[64px] leading-none text-[#EE6FA8]">2019</div>
                  <div className="mt-1 text-[11px] text-[#5B4C5B]">servindo em São Luís</div>
                </div>
                <div className="stk rounded-3xl bg-[#3FBCD9] p-5 text-white">
                  <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">Nota no iFood</div>
                  <div className="fd mt-1 text-[64px] leading-none">4,9</div>
                  <div className="mt-1 text-[11px] opacity-80">avaliação média das nossas lojas</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="vagas-shell py-14 md:py-20">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#5B4C5B]">Por que Coala</div>
          <h2 className="fd mb-8 leading-[0.95]" style={{ fontSize: "clamp(34px,6vw,64px)" }}>
            Trabalho <span className="squig">com energia</span>,
            <br />
            ambiente <span className="text-[#EE6FA8]">com afeto.</span>
          </h2>
          <div className="mb-5 grid gap-4 md:grid-cols-3">
            {VALUE_CARDS.map((card) => (
              <article key={card.title} className="stk relative min-h-[296px] overflow-hidden rounded-3xl p-6" style={{ background: card.background }}>
                <div className="value-ghost-icon absolute -right-4 -top-4 text-[110px] leading-none opacity-20">{card.emoji}</div>
                <div className="relative flex h-full flex-col">
                  <div className="mb-3 text-[26px]"><span className="value-main-icon">{card.emoji}</span></div>
                  <h3 className="fd text-[26px] leading-tight" style={{ color: card.color }}>{card.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-[#5B4C5B]">{card.text}</p>
                  <div className="mt-auto pt-5">
                    <div className="flex min-h-10 items-center gap-2 rounded-full bg-white px-4 py-2 text-[11.5px] font-bold leading-snug">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: card.color }} />
                      <span>{card.footer}</span>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="stk rounded-3xl bg-white p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
              <h3 className="fd text-[22px]">Benefícios na prática</h3>
              <span className="hidden text-[11.5px] text-[#5B4C5B] sm:block">vale pra todo mundo, do estagiário ao gerente</span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {BENEFITS.map((benefit) => {
                const Icon = benefit.icon;
                return (
                  <div key={benefit.title} className="group rounded-2xl bg-[#EFE6CC]/50 p-3.5 transition hover:-translate-y-0.5">
                    <span
                      className="mb-2.5 inline-flex h-10 w-10 items-center justify-center rounded-xl transition group-hover:scale-110"
                      style={{ background: `${benefit.color}24`, color: benefit.color }}
                    >
                      <Icon className="h-[22px] w-[22px]" />
                    </span>
                    <div className="text-[12px] font-bold leading-tight">{benefit.title}</div>
                    <div className="mt-1 text-[10.5px] leading-snug text-[#5B4C5B]">{benefit.text}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="vagas" ref={listRef} className="scroll-mt-20 py-10">
          <div className="vagas-shell stk overflow-hidden rounded-[40px]">
            <div className="bg-[#2A1F2A] px-8 pb-8 pt-12">
              <div className="mb-8 grid items-end gap-6 md:grid-cols-[1fr_auto]">
                <div>
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">Oportunidades abertas agora</div>
                  <h2 className="fd leading-[0.9] text-white" style={{ fontSize: "clamp(44px,7vw,88px)" }}>
                    {hasOpenings ? (
                      <>vagas <span className="text-[#EE6FA8]">frescas.</span></>
                    ) : (
                      <>Novas vagas <span className="text-[#EE6FA8]">em breve!</span></>
                    )}
                  </h2>
                </div>
	                <div className="text-[16px] text-white/65">
	                  <strong className="fd block text-[42px] leading-none text-white">{openCount}</strong>
	                </div>
              </div>

              <div className="rounded-3xl bg-white p-3">
                <div className="grid gap-2 md:grid-cols-[1fr_196px_196px]">
                  <label className="flex h-[56px] items-center gap-3 px-4">
                    <Search className="h-4 w-4 text-[#2A1F2A]/35" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar cargo ou unidade..."
                      className="w-full bg-transparent text-[15px] font-medium text-[#2A1F2A] outline-none placeholder:text-[#2A1F2A]/35"
                    />
                  </label>
                  <label className="flex h-[56px] items-center gap-1.5 rounded-2xl bg-[#F4ECD8] px-4">
                    <select
                      value={filterCategory}
                      onChange={(event) => setFilterCategory(event.target.value)}
                      className="w-full appearance-none bg-transparent text-[13px] font-bold text-[#2A1F2A] outline-none"
                    >
                      <option value="">Todos os cargos</option>
                      {categories.map((category) => (
                        <option key={category.name} value={category.name}>{category.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </label>
                  <label className="flex h-[56px] items-center gap-1.5 rounded-2xl bg-[#F4ECD8] px-4">
                    <select
                      value={filterLocation}
                      onChange={(event) => setFilterLocation(event.target.value)}
                      className="w-full appearance-none bg-transparent text-[13px] font-bold text-[#2A1F2A] outline-none"
                    >
                      <option value="">Todas as unidades</option>
                      {locations.map((location) => (
                        <option key={location} value={location}>{location}</option>
                      ))}
                    </select>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </label>
                </div>
              </div>

              {hasFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 px-3 text-[12px] font-bold text-white/55 transition hover:bg-white/10"
                >
                  × Limpar filtros
                </button>
              ) : null}
            </div>

            <div className="bg-white px-8 pb-10 pt-8">
              {loading ? (
                <div className="stk rounded-3xl bg-[#F4ECD8]/70 p-12 text-center">
                  <h3 className="fd mb-2 text-[26px]">{hasOpenings ? "Carregando vagas..." : "Novas vagas em breve!"}</h3>
                  <p className="text-[14px] text-[#5B4C5B]">{hasOpenings ? "Estamos consultando as oportunidades abertas." : "Nosso banco de talentos segue aberto para receber seu cadastro."}</p>
                </div>
              ) : null}

              {error ? (
                <div className="stk rounded-3xl bg-white p-12 text-center text-[14px] font-bold text-[#B91C1C]">{error}</div>
              ) : null}

              {!loading && !error && filtered.length === 0 ? (
                <div className="stk rounded-3xl bg-white p-12 text-center">
                  <div className="mb-4 text-5xl">🔍</div>
                  <h3 className="fd mb-2 text-[26px]">{hasFilters ? "Nenhuma vaga encontrada." : "Em breve teremos novas vagas!"}</h3>
                  <p className="text-[14px] text-[#5B4C5B]">
                    {hasFilters ? "Ajuste os filtros ou deixe seu cadastro espontâneo." : "Nosso banco de talentos segue aberto para receber seu cadastro."}
                  </p>
                  {hasFilters ? (
                    <button type="button" onClick={resetFilters} className="btn mt-5 inline-flex h-10 items-center bg-[#EE6FA8] px-5 text-[13px] font-bold text-white">
                      Ver todas as vagas
                    </button>
                  ) : null}
                </div>
              ) : null}

              {!loading && !error && filtered.length > 0 ? (
                <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((opening, index) => {
                    const role = getRoleLabel(opening);
                    const meta = getRoleMeta(role);
                    const location = getLocationLabel(opening.location);
                    const closingDays = daysUntil(opening.closesAt);
                    const isNew = index < 3;
                    const urgent = closingDays != null && closingDays <= 7;
                    return (
                      <Link
                        key={opening.id}
                        href={`/vagas/${opening.slug}`}
                        className="card-hover stk flex w-full flex-col overflow-hidden rounded-3xl bg-white text-left"
                      >
                        <div className="h-[5px] shrink-0" style={{ background: meta.color }} />
                        <div className="flex flex-1 flex-col p-6">
                          <div className="flex items-start gap-4">
                            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-[28px]" style={{ background: `${meta.color}28` }}>
                              {meta.emoji}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <h3 className="fd text-[21px] leading-[1.1]">{opening.title}</h3>
                                <div className="flex shrink-0 flex-col gap-1">
                                  {isNew ? <span className="inline-flex items-center gap-1 rounded-full bg-[#3FBCD9] px-2 py-0.5 text-[9px] font-bold uppercase text-white">● nova</span> : null}
                                  {urgent ? <span className="inline-flex items-center gap-0.5 rounded-full bg-[#FFF3CD] px-2 py-0.5 text-[9px] font-bold text-[#7A5C00]">⏱ {closingDays}d</span> : null}
                                </div>
                              </div>
                              <div className="mt-1 text-[11px] font-bold uppercase tracking-widest text-[#5B4C5B]">Coala {location}</div>
                            </div>
                          </div>
                          <p className="mt-4 line-clamp-2 text-[13px] leading-relaxed text-[#5B4C5B]">{getPreview(opening.description)}</p>
                          <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                            <span className="inline-flex rounded-full bg-[#F4ECD8]/90 px-2.5 py-1 text-[11px] font-bold">{location}</span>
                            {opening.workType ? <span className="inline-flex rounded-full bg-[#F4ECD8]/90 px-2.5 py-1 text-[11px] font-bold">{WORK_TYPE_LABELS[opening.workType]}</span> : null}
                            {opening.slots > 1 ? <span className="inline-flex rounded-full bg-[#F4ECD8]/90 px-2.5 py-1 text-[11px] font-bold">{opening.slots} vagas</span> : null}
                          </div>
                        </div>
                        <div className="flex items-center justify-between border-t border-[#2A1F2A]/10 bg-[#F4ECD8]/40 px-6 py-3.5">
                          <span className="fm text-[13px]">A combinar</span>
                          <span className="inline-flex items-center gap-1 text-[12px] font-bold text-[#5B4C5B]">
                            ver vaga <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="vagas-shell py-14 text-center md:py-20">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#5B4C5B]">Como funciona</div>
          <h2 className="fd mb-3 leading-[0.95]" style={{ fontSize: "clamp(32px,5.5vw,60px)" }}>
            Do <span className="text-[#EE6FA8]">oi</span> ao <span className="text-[#3FBCD9]">crachá.</span>
          </h2>
          <p className="mx-auto mb-12 max-w-lg text-[15px] text-[#5B4C5B]">Processo curto, sem etapas desnecessárias.</p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PROCESS_STEPS.map((step, index) => (
              <article key={step.title} className="stk rounded-3xl bg-white p-6 text-left">
                <div className="fd flex h-11 w-11 items-center justify-center rounded-xl text-xl" style={{ background: step.color, color: step.textColor || "white" }}>
                  {index + 1}
                </div>
                <h3 className="fd mt-5 text-[19px]">{step.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[#5B4C5B]">{step.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="vagas-readable py-14 md:py-20">
          <div className="mb-2 text-center text-[11px] font-bold uppercase tracking-widest text-[#5B4C5B]">Dúvidas frequentes</div>
          <h2 className="fd mb-10 text-center" style={{ fontSize: "clamp(28px,5vw,52px)" }}>A gente respondeu antes.</h2>
          <div className="space-y-3">
            {FAQS.map((faq, index) => (
              <details
                key={faq.question}
                className="stk group overflow-hidden rounded-2xl bg-white text-left transition hover:-translate-y-0.5"
                open={index === 0}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:hidden">
                  <span className="text-[15px] font-bold">{faq.question}</span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F4ECD8]">
                    <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
                  </span>
                </summary>
                <p className="px-5 pb-4 text-[14px] leading-relaxed text-[#5B4C5B]">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

      </main>

      <footer className="bg-[#2A1F2A] px-5 py-14 text-white">
        <div className="vagas-shell grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-6 max-w-[420px] text-[14px] leading-relaxed text-white/50">
              Shakes únicos, rotina dinâmica e um ambiente bom para trabalhar. Estamos em São Luís desde 2019.
            </p>
            <div className="mt-6 flex gap-2">
              <a href="https://www.instagram.com/coalashakes/" target="_blank" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:-translate-y-0.5" rel="noreferrer">
                <Instagram className="h-[18px] w-[18px]" />
              </a>
              <a href="https://wa.me/5598999072739" target="_blank" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:-translate-y-0.5" rel="noreferrer">
                <WhatsAppIcon className="h-[18px] w-[18px]" />
              </a>
              <a href="mailto:vagas@coalashakes.com" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:-translate-y-0.5" aria-label="Enviar e-mail">
                <Mail className="h-[18px] w-[18px]" />
              </a>
            </div>
          </div>
          {footerUnits.length > 0 ? (
            <div>
              <div className="mb-5 text-[10.5px] font-bold uppercase tracking-widest text-white/35">Unidades</div>
              <ul className="space-y-3 text-[14px] text-white/55">
                {footerUnits.map((location) => (
                  <li key={location} className="grid grid-cols-[6px_1fr] items-start gap-3">
                    <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[#EE6FA8]" />
                    <span className="min-w-0 leading-snug">
                      <span className="block text-white/58">Coala {location}</span>
                      <span className="mt-0.5 block text-[12px] text-white/30">São Luís · MA</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <div className="mb-5 text-[10.5px] font-bold uppercase tracking-widest text-white/35">Fala com a gente</div>
            <div className="flex flex-col space-y-3 text-[14px] text-white/55">
              <a href="mailto:vagas@coalashakes.com" className="transition hover:text-white">vagas@coalashakes.com</a>
              <a href="https://wa.me/5598999072739" target="_blank" className="transition hover:text-white" rel="noreferrer">Contato: (98) 99907-2739</a>
            </div>
          </div>
        </div>
        <div className="vagas-shell mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-[12px] text-white/30">
          <span>© {new Date().getFullYear()} Coala Shakes · vagas.coalashakes.com</span>
          <a href="mailto:vagas@coalashakes.com" className="transition hover:text-white/60">Privacidade</a>
        </div>
      </footer>
    </div>
  );
}
