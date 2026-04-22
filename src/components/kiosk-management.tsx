"use client";

import { useState, useMemo } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useDP } from '@/components/dp-context';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import type { Kiosk, DPUnit, DPShiftDefinition } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { shiftDefinitionMatchesUnit } from '@/lib/dp-shift-definitions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Trash2, Save, Store, Clock3 } from 'lucide-react';

// ─── Name normalizer for Kiosk ↔ DPUnit matching ─────────────────────────────

function normalizeName(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/quiosque\s*/gi, '')
    .replace(/quisque\s*/gi, '')
    .replace(/centro de distribuicao\s*/gi, '')
    .replace(/[-–_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function matchUnit(kioskName: string, units: DPUnit[]): DPUnit | undefined {
  const kn = normalizeName(kioskName);
  // Exact / substring match first
  const exact = units.find(u => {
    const un = normalizeName(u.name);
    return kn === un || kn.includes(un) || un.includes(kn);
  });
  if (exact) return exact;
  // Fuzzy fallback: allow up to 3 edits (handles typos like "Tirircal" vs "Tirirical")
  let best: DPUnit | undefined;
  let bestDist = Infinity;
  for (const u of units) {
    const un = normalizeName(u.name);
    const d = editDistance(kn, un);
    const threshold = Math.max(3, Math.floor(Math.max(kn.length, un.length) * 0.25));
    if (d < bestDist && d <= threshold) { best = u; bestDist = d; }
  }
  return best;
}

// ─── KioskRow ─────────────────────────────────────────────────────────────────

function getShiftAccent(name: string) {
  const normalized = name.toLowerCase();

  if (normalized.includes('intermedi')) {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200';
  }

  if (normalized.includes('manhã') || normalized.includes('manha')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200';
  }

  if (normalized.includes('tarde')) {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200';
  }

  if (normalized.includes('noite')) {
    return 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-200';
  }

  return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-500/20 dark:bg-slate-500/10 dark:text-slate-200';
}

function KioskRow({
  kiosk,
  canEdit,
  onSave,
  onDelete,
  shifts,
  compact = false,
}: {
  kiosk: Kiosk;
  canEdit: boolean;
  onSave: (updated: Kiosk) => Promise<void>;
  onDelete: () => void;
  shifts: DPShiftDefinition[];
  compact?: boolean;
}) {
  const [pdv, setPdv] = useState(kiosk.pdvFilialId ?? '');
  const [bizneo, setBizneo] = useState(kiosk.bizneoId ?? '');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const isDirty =
    pdv !== (kiosk.pdvFilialId ?? '') || bizneo !== (kiosk.bizneoId ?? '');

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        ...kiosk,
        pdvFilialId: pdv.trim() || undefined,
        bizneoId: bizneo.trim() || undefined,
      });
      toast({ title: 'Identificadores salvos.', description: kiosk.name });
    } catch {
      toast({ title: 'Erro ao salvar.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={cn(
        'rounded-2xl border border-border/70 bg-card/40 shadow-sm transition-colors hover:bg-card/55',
        compact ? 'px-5 py-4' : 'px-6 py-5'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Store className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-lg font-semibold">{kiosk.name}</span>
              {kiosk.id === 'matriz' && (
                <Badge
                  variant="outline"
                  className="rounded-full border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200"
                >
                  Matriz
                </Badge>
              )}
            </div>
          </div>
        </div>
        {kiosk.id !== 'matriz' ? (
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-2xl border-border/70 bg-background/80 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            disabled={!canEdit}
            title="Excluir unidade"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : (
          <div className="h-11 w-11 shrink-0" />
        )}
      </div>

      <div className={cn('mt-4', compact ? 'space-y-3' : 'space-y-4')}>
        <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto_auto_minmax(0,1fr)] lg:items-center">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            PDV
          </Label>
          <Input
            placeholder="ex: 17343"
            value={pdv}
            onChange={e => setPdv(e.target.value)}
            disabled={!canEdit}
            className={cn(
              'rounded-xl border-border/70 bg-background/70 text-base shadow-none',
              compact ? 'h-14 px-4' : 'h-12'
            )}
          />
          <span className="hidden text-lg text-muted-foreground/40 lg:inline">·</span>
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Bizneo
          </Label>
          <Input
            placeholder="ex: 42"
            value={bizneo}
            onChange={e => setBizneo(e.target.value)}
            disabled={!canEdit}
            className={cn(
              'rounded-xl border-border/70 bg-background/70 text-base shadow-none',
              compact ? 'h-14 px-4' : 'h-12'
            )}
          />
        </div>

        {shifts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {shifts.map(s => (
              <span
                key={s.id}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium',
                  getShiftAccent(s.name)
                )}
              >
                <Clock3 className="h-3.5 w-3.5" />
                <span>{s.name.trim()}</span>
                <span className="opacity-75">{s.startTime}–{s.endTime}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            Nenhum turno vinculado
          </p>
        )}
      </div>

      {isDirty && (
        <div className="mt-4 flex justify-end">
          <Button size="sm" className="rounded-xl" onClick={handleSave} disabled={saving || !canEdit}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── KioskManagement (main export) ───────────────────────────────────────────

export function KioskManagement({ compact = false }: { compact?: boolean } = {}) {
  const { kiosks, loading, addKiosk, updateKiosk, deleteKiosk } = useKiosks();
  const { units, shiftDefinitions } = useDP();
  const { permissions } = useAuth();
  const { toast } = useToast();

  const canEdit = !!permissions.settings.manageKiosks;

  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [kioskToDelete, setKioskToDelete] = useState<Kiosk | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sorted = useMemo(
    () =>
      [...kiosks].sort((a, b) => {
        if (a.id === 'matriz') return -1;
        if (b.id === 'matriz') return 1;
        return a.name.localeCompare(b.name);
      }),
    [kiosks],
  );

  // Map each kiosk to its DP unit and that unit's shifts
  const kioskShifts = useMemo(() => {
    const result = new Map<string, DPShiftDefinition[]>();
    sorted.forEach(kiosk => {
      const dpUnit = matchUnit(kiosk.name, units);
      const shifts = dpUnit
        ? shiftDefinitions.filter(s => shiftDefinitionMatchesUnit(s, dpUnit.id))
        : [];
      result.set(kiosk.id, shifts);
    });
    return result;
  }, [sorted, units, shiftDefinitions]);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      await addKiosk({ name });
      setNewName('');
      toast({ title: 'Unidade adicionada.' });
    } catch {
      toast({ title: 'Erro ao adicionar unidade.', variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete() {
    if (!kioskToDelete) return;
    setDeleting(true);
    try {
      await deleteKiosk(kioskToDelete.id);
      toast({ title: 'Unidade excluída.' });
    } catch {
      toast({ title: 'Erro ao excluir unidade.', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setKioskToDelete(null);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  const listContent = (
    <div className={compact ? "space-y-2 pb-8" : "space-y-3 pr-3 pb-6"}>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Nenhuma unidade cadastrada.
        </p>
      ) : (
        sorted.map(kiosk => (
          <KioskRow
            key={kiosk.id}
            kiosk={kiosk}
            canEdit={canEdit}
            onSave={updateKiosk}
            onDelete={() => setKioskToDelete(kiosk)}
            shifts={kioskShifts.get(kiosk.id) ?? []}
            compact={compact}
          />
        ))
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Add new */}
      {canEdit && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            placeholder="Nome do novo quiosque / unidade"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            disabled={adding}
            className={cn(
              'rounded-2xl border-border/70 bg-background/70 text-base shadow-none',
              compact ? 'h-14 px-5' : 'h-12'
            )}
          />
          <Button
            size={compact ? "sm" : "default"}
            variant="outline"
            className={cn('rounded-2xl px-5', compact ? 'h-14 text-base' : '')}
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Adicionar
          </Button>
        </div>
      )}

      {/* List */}
      {compact ? (
        listContent
      ) : (
        <ScrollArea className="h-[calc(100vh-280px)]">
          {listContent}
        </ScrollArea>
      )}

      <AlertDialog
        open={!!kioskToDelete}
        onOpenChange={open => { if (!open) setKioskToDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir unidade?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{kioskToDelete?.name}</strong> será excluída permanentemente.
              Dados associados (metas, faturamento) não serão apagados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
