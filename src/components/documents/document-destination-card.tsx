import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

export interface DocumentDestinationCardProps {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

/** Cartão de acesso dos hubs de Documentos: a área inteira é o link, no padrão de superfície branca com lift no hover. */
export function DocumentDestinationCard({ title, description, href, icon: Icon }: DocumentDestinationCardProps) {
  return (
    <Link
      href={href}
      data-ui="document-destination"
      className="group flex min-h-32 items-start gap-3.5 rounded-ds-card border border-ds-border bg-ds-surface p-5 outline-none transition-[transform,box-shadow] duration-[180ms] ease-ds-lift hover:-translate-y-[3px] hover:shadow-ds-lift focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2 motion-reduce:hover:translate-y-0"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-ds-btn bg-ds-accent-soft text-ds-accent-ink">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-extrabold text-ds-ink">{title}</span>
        <span className="mt-1 block text-[13px] leading-5 text-ds-ink-muted">{description}</span>
      </span>
      <ChevronRight className="mt-2.5 h-4 w-4 text-ds-ink-faint transition group-hover:translate-x-0.5 group-hover:text-ds-accent-ink" aria-hidden />
    </Link>
  );
}
