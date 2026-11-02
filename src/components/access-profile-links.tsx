"use client";

import type { ReactNode } from "react";

import { PersonAvatar } from "@/components/patterns/person-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ProfileLinkItem = {
  id: string;
  name: string;
  detail?: string | null;
  avatarUrl?: string | null;
  color?: string | null;
};

export type ProfileLinkGroup = {
  title: string;
  items: ProfileLinkItem[];
};

type ProfileLinksPopoverProps = {
  icon: ReactNode;
  label: string;
  profileName: string;
  groups: ProfileLinkGroup[];
  emptyText: string;
  withAvatar?: boolean;
};

/** Contagem clicável na linha do perfil; o clique abre a lista sem selecionar a linha. */
export function ProfileLinksPopover({ icon, label, profileName, groups, emptyText, withAvatar = false }: ProfileLinksPopoverProps) {
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  if (total === 0) {
    return <span className="text-[12.5px] text-ds-ink-muted">{emptyText}</span>;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Ver ${label.toLocaleLowerCase("pt-BR")} do perfil ${profileName}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-ds-border bg-ds-surface px-2.5 text-[12px] font-bold text-ds-ink transition hover:border-ds-accent hover:text-ds-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-modal data-[state=open]:border-ds-accent data-[state=open]:text-ds-accent"
        >
          <span aria-hidden="true" className="[&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
          {total}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        collisionPadding={16}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[min(420px,calc(100vh-32px))] w-[300px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-ds-btn-lg border-ds-border p-0 text-xs"
      >
        <p className="border-b border-ds-divider px-4 py-3 text-sm font-extrabold text-ds-ink">
          {label} · {profileName}
        </p>
        {groups.filter((group) => group.items.length > 0).map((group) => (
          <div key={group.title} className="px-2 py-2">
            {groups.length > 1 ? (
              <p className="px-2 pb-1 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-muted">
                {group.title} · {group.items.length}
              </p>
            ) : null}
            <ul>
              {group.items.map((item) => (
                <li key={item.id} className="flex items-center gap-2.5 rounded-ds-sm px-2 py-1.5">
                  {withAvatar ? <PersonAvatar name={item.name} avatarUrl={item.avatarUrl} color={item.color} size={28} /> : null}
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-bold text-ds-ink">{item.name}</span>
                    {item.detail ? <span className="block truncate text-[11.5px] text-ds-ink-muted">{item.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
