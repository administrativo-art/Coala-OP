"use client";

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { buildAccountPlanTree, type AccountPlanOption, type AccountPlanTreeNode } from '@/lib/purchasing-financial-options';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: Array<AccountPlanOption & { order?: number }>;
  placeholder: string;
  noneLabel?: string;
  allowNone?: boolean;
  disabled?: boolean;
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

        <button
          type="button"
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
          onClick={() => onSelect(node.id)}
        >
          <span className="truncate">{node.name}</span>
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
}: Props) {
  const [open, setOpen] = useState(false);
  const tree = useMemo(() => buildAccountPlanTree(options), [options]);
  const selected = useMemo(() => options.find((option) => option.id === value) ?? null, [options, value]);
  const displayLabel = value === '__none__' ? noneLabel : selected?.name ?? placeholder;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
        <ScrollArea className="max-h-80">
          <div className="space-y-0.5">
            {allowNone && (
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

            {tree.map((node) => (
              <TreeNodeRow
                key={node.id}
                node={node}
                depth={0}
                expanded={expanded}
                selectedId={value}
                onToggle={toggle}
                onSelect={handleSelect}
              />
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
