"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { ControlPanel } from "@/components/patterns/control-panel";
import { cn } from "@/lib/utils";

type PulseHeroProps = {
  kicker: string;
  title: string;
  titleId: string;
  subtitle?: ReactNode;
  /** Ações completas à direita do título (ex.: Atualizar e a ação principal). */
  actions?: ReactNode;
  search?: ReactNode;
  /** Indicadores e filtros em chips compactos, numa só linha. */
  chips?: ReactNode;
  /** Conteúdo extra no rodapé do painel (ex.: abas). */
  footer?: ReactNode;
  /** Resumo curto mostrado na faixa fina (ex.: o período). */
  compactInfo?: ReactNode;
  /** Só a ação principal, para a faixa fina. */
  compactActions?: ReactNode;
  /** Use quando o contêiner pai separa os filhos com `space-y` em vez de `flex gap-5`. */
  stack?: boolean;
};

/**
 * Cabeçalho escuro das telas da Programação do Instagram. O painel completo rola com a página;
 * quando sai de vista, uma faixa fina com o título e a ação principal desliza para o topo e fica
 * fixa. A faixa não altera a altura da página, então nada "pula" ao rolar.
 */
export function PulseHero({ kicker, title, titleId, subtitle, actions, search, chips, footer, compactInfo, compactActions, stack }: PulseHeroProps) {
  const heroRef = useRef<HTMLDivElement>(null);
  const [outOfView, setOutOfView] = useState(false);
  const [innerScrolled, setInnerScrolled] = useState(false);
  const [pageScrolled, setPageScrolled] = useState(false);

  /* 1) A página rolou até o painel sair de vista. */
  useEffect(() => {
    const element = heroRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    /* A raiz encolhe 72px por cima: o painel conta como "fora de vista" quando a base dele passa dessa linha. */
    const observer = new IntersectionObserver(([entry]) => setOutOfView(!entry.isIntersecting), { rootMargin: "-72px 0px 0px 0px", threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /* 2) Uma lista interna da tela rolou (posts, biblioteca…): o scroll não borbulha, então escutamos na captura.
     A barra lateral fica de fora. Com histerese (40/8px) para não oscilar. */
  useEffect(() => {
    const scrolled = new Set<Element>();
    function onScroll(event: Event) {
      const target = event.target;
      if (target === document) {
        /* Reforço do observador: a página rolou o bastante, mesmo sem o painel ter saído de vista por completo. */
        setPageScrolled((current) => (current ? window.scrollY > 60 : window.scrollY > 160));
        return;
      }
      if (!(target instanceof Element) || target.closest("aside")) return;
      const scope = heroRef.current?.parentElement;
      if (!scope?.contains(target)) return;
      if (target.scrollTop > 40) scrolled.add(target);
      else if (target.scrollTop < 8) scrolled.delete(target);
      setInnerScrolled(scrolled.size > 0);
    }
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

  const stuck = outOfView || pageScrolled || innerScrolled;

  return (
    <>
      <div ref={heroRef} className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none", innerScrolled ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100")}>
      {/* O recorte só existe enquanto o painel encolhe; aberto, nada corta a sombra dele (um recorte fixo cortava em retângulo). */}
      <div className={cn("min-h-0", innerScrolled && "overflow-hidden")}>
      <ControlPanel className="flex flex-col gap-4 px-[26px] pb-5 pt-5">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">{kicker}</span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 id={titleId} className="text-[26px] font-extrabold tracking-[-0.03em] text-ds-on-dark">{title}</h1>
          {subtitle ? <span className="text-[13px] text-ds-on-dark-sub">{subtitle}</span> : null}
          {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {search}
        {chips ? <div className="flex flex-wrap items-center gap-2">{chips}</div> : null}
        {footer}
      </ControlPanel>
      </div>
      </div>

      <div aria-hidden={!stuck} className={cn("sticky top-3 z-30 h-0", stack ? "!mt-0" : "-mb-5")}>
        <div
          className={cn(
            "absolute inset-x-0 top-0 flex items-center gap-3 rounded-ds-card-lg bg-ds-dark px-5 py-2.5 text-ds-on-dark shadow-ds-modal ring-1 ring-white/10",
            "transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
            stuck ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0",
          )}
        >
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">{kicker}</span>
          <strong className="text-[17px] font-extrabold tracking-[-0.02em]">{title}</strong>
          {compactInfo ? <span className="hidden text-[13px] text-ds-on-dark-sub sm:inline">{compactInfo}</span> : null}
          {compactActions ? <div className="ml-auto flex items-center gap-2">{stuck ? compactActions : null}</div> : null}
        </div>
      </div>
    </>
  );
}

export { HeroChip } from "@/components/patterns/hero-chip";
