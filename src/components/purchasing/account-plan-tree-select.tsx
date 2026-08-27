"use client";

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { buildAccountPlanSearchText, buildAccountPlanTree, type AccountPlanOption, type AccountPlanTreeNode } from '@/lib/purchasing-financial-options';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: Array<AccountPlanOption & { order?: number }>;
  placeholder: string;
  noneLabel?: string;
  allowNone?: boolean;
  disabled?: boolean;
  triggerClassName?: string;
}

function collectParentPath(
  options: Array<AccountPlanOption & { order?: number }>,
  targetId: string,
) {
  const byId = new Map(options.map((option) => [option.id, option]));
  const path: string[] = [];
  let current = byId.get(targetId);

  while (current?.parentId) {
    path.unshift(current.parentId);
    current = byId.get(current.parentId);
  }

  return path;
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getOptionPath(
  options: Array<AccountPlanOption & { order?: number }>,
  targetId: string,
) {
  const byId = new Map(options.map((option) => [option.id, option]));
  const path: string[] = [];
  let current = byId.get(targetId);

  while (current) {
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return path;
}

function sortOptionsByTreeOrder(
  options: Array<AccountPlanOption & { order?: number }>,
  tree: AccountPlanTreeNode[],
) {
  const orderById = new Map<string, number>();
  let index = 0;

  const walk = (nodes: AccountPlanTreeNode[]) => {
    nodes.forEach((node) => {
      orderById.set(node.id, index);
      index += 1;
      walk(node.children);
    });
  };

  walk(tree);
  return [...options].sort((left, right) => (orderById.get(left.id) ?? 0) - (orderById.get(right.id) ?? 0));
}

function TreeNodeRow({
  node,
  depth,
  expanded,
  selectedId,
  onToggle,
  onSelect,
}: {
  node: AccountPlanTreeNode;
  depth: number;
  expanded: Set<string>;
  selectedId: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted',
          isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90',
        )}
        style={{ paddingLeft: `${8 + depth * 18}px` }}
      >
        <button
          type="button"
          className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
          onClick={() => hasChildren && onToggle(node.id)}
        >
          {hasChildren ? (
            isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <span className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Nó com filhas é grupo: lançamento só em folha, clicar expande/recolhe. */}
        <button
          type="button"
          className={cn(
            'flex min-w-0 flex-1 items-center justify-between gap-3 text-left',
            hasChildren && 'font-medium text-muted-foreground',
          )}
          onClick={() => (hasChildren ? onToggle(node.id) : onSelect(node.id))}
        >
          <span className="min-w-0">
            <span className="block truncate">{node.name}</span>
            {!hasChildren && node.description && (
              <span className={cn('block truncate text-xs text-muted-foreground', isSelected && 'text-primary-foreground/75')}>
                {node.description}
              </span>
            )}
          </span>
          {isSelected && <Check className="h-4 w-4 shrink-0" />}
        </button>
      </div>

      {hasChildren && isOpen && (
        <div className="mt-0.5 space-y-0.5">
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AccountPlanTreeSelect({
  value,
  onChange,
  options,
  placeholder,
  noneLabel = 'Sem padrão',
  allowNone = false,
  disabled = false,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const tree = useMemo(() => buildAccountPlanTree(options), [options]);
  const selected = useMemo(() => options.find((option) => option.id === value) ?? null, [options, value]);
  const displayLabel = value === '__none__' ? noneLabel : selected?.name ?? placeholder;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const normalizedSearch = normalizeSearch(search);

  const optionPaths = useMemo(
    () => new Map(options.map((option) => [option.id, getOptionPath(options, option.id)])),
    [options],
  );

  const groupIds = useMemo(
    () => new Set(options.map((option) => option.parentId).filter(Boolean)),
    [options],
  );

  const filteredOptions = useMemo(() => {
    if (!normalizedSearch) return [];

    const tokens = normalizedSearch.split(/\s+/).filter(Boolean);
    return sortOptionsByTreeOrder(options, tree).filter((option) => {
      // Grupos não recebem lançamento; a busca só retorna folhas.
      if (groupIds.has(option.id)) return false;
      // Busca por caminho na árvore + palavras-chave cadastradas na conta.
      const haystack = buildAccountPlanSearchText(option, optionPaths.get(option.id));
      return tokens.every((token) => haystack.includes(token));
    });
  }, [groupIds, normalizedSearch, optionPaths, options, tree]);

  useEffect(() => {
    if (!value || value === '__none__') {
      setExpanded(new Set());
      return;
    }

    setExpanded(new Set(collectParentPath(options, value)));
  }, [options, tree, value]);

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
    setSearch('');
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn('w-full justify-between font-normal hover:bg-background hover:text-foreground', triggerClassName)}
        >
          <span className={cn('truncate', !selected && value !== '__none__' && 'text-muted-foreground')}>{displayLabel}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-h-[var(--radix-popover-content-available-height)] overflow-hidden p-2"
        align="start"
        sideOffset={4}
      >
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar plano de contas..."
            className="h-9 pl-8"
          />
        </div>
        <div className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-4.5rem))] overflow-y-auto pr-1">
          <div className="space-y-0.5">
            {allowNone && (!normalizedSearch || normalizeSearch(noneLabel).includes(normalizedSearch)) && (
              <button
                type="button"
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                  value === '__none__' && 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
                onClick={() => handleSelect('__none__')}
              >
                <span>{noneLabel}</span>
                {value === '__none__' && <Check className="h-4 w-4" />}
              </button>
            )}

            {normalizedSearch ? (
              filteredOptions.length > 0 ? (
                filteredOptions.map((option) => {
                  const path = optionPaths.get(option.id) ?? [option.name];
                  const isSelected = value === option.id;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted',
                        isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90',
                      )}
                      onClick={() => handleSelect(option.id)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{option.name}</span>
                        {path.length > 1 && (
                          <span className={cn('block truncate text-xs text-muted-foreground', isSelected && 'text-primary-foreground/75')}>
                            {path.slice(0, -1).join(' / ')}
                          </span>
                        )}
                        {option.description && (
                          <span className={cn('block truncate text-xs text-muted-foreground', isSelected && 'text-primary-foreground/75')}>
                            {option.description}
                          </span>
                        )}
                      </span>
                      {isSelected && <Check className="h-4 w-4 shrink-0" />}
                    </button>
                  );
                })
              ) : (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Nenhum plano encontrado.
                </div>
              )
            ) : (
              tree.map((node) => (
                <TreeNodeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  selectedId={value}
                  onToggle={toggle}
                  onSelect={handleSelect}
                />
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
