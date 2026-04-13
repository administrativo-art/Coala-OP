"use client";

import { useState, useMemo } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useDP } from '@/hooks/use-dp';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import type { Kiosk, DPUnit, DPShiftDefinition } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import Link from 'next/link';
import { PlusCircle, Trash2, Save, Building2, Clock, ExternalLink } from 'lucide-react';

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

const DOW_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function KioskRow({
  kiosk,
  canEdit,
  onSave,
  onDelete,
  shifts,
}: {
  kiosk: Kiosk;
  canEdit: boolean;
  onSave: (updated: Kiosk) => Promise<void>;
  onDelete: () => void;
  shifts: DPShiftDefinition[];
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
    <div className="rounded-lg border p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm">{kiosk.name}</span>
          {kiosk.id === 'matriz' && (
            <Badge variant="secondary" className="text-xs">Matriz</Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          disabled={!canEdit || kiosk.id === 'matriz'}
          title={kiosk.id === 'matriz' ? 'A Matriz não pode ser excluída' : 'Excluir unidade'}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Integration IDs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            ID PDV Legal
          </Label>
          <Input
            placeholder="ex: 17343"
            value={pdv}
            onChange={e => setPdv(e.target.value)}
            disabled={!canEdit}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            ID Bizneo
          </Label>
          <Input
            placeholder="ex: 42"
            value={bizneo}
            onChange={e => setBizneo(e.target.value)}
            disabled={!canEdit}
            className="h-8 text-sm"
          />
        </div>
      </div>

      {/* Shifts from DP */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Clock className="h-3 w-3" /> Turnos (DP)
          </p>
          <Link
            href="/dashboard/dp/settings/shifts"
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Gerenciar <ExternalLink className="h-2.5 w-2.5" />
          </Link>
        </div>
        {shifts.length > 0 ? (
          <div className="w-full flex flex-wrap gap-1">
            {shifts.map(s => (
              <div key={s.id} className="rounded border bg-muted/50 px-1.5 py-0.5 flex items-center gap-1 text-[10px]">
                <span className="font-mono font-bold bg-primary/10 text-primary rounded px-0.5">{s.code}</span>
                <span className="text-muted-foreground">{s.name.trim()}</span>
                <span className="text-muted-foreground/70">{s.startTime}–{s.endTime}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Nenhum turno vinculado. Vincule a unidade DP nos{' '}
            <Link href="/dashboard/dp/settings/shifts" className="underline hover:text-foreground">
              turnos do DP
            </Link>
            .
          </p>
        )}
      </div>

      {isDirty && (
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={saving || !canEdit}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── KioskManagement (main export) ───────────────────────────────────────────

export function KioskManagement() {
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
        ? shiftDefinitions.filter(s => s.unitId === dpUnit.id)
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

  return (
    <div className="space-y-4">
      {/* Add new */}
      {canEdit && (
        <div className="flex gap-2">
          <Input
            placeholder="Nome do novo quiosque / unidade"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            disabled={adding}
          />
          <Button onClick={handleAdd} disabled={adding || !newName.trim()}>
            <PlusCircle className="mr-1.5 h-4 w-4" />
            Adicionar
          </Button>
        </div>
      )}

      {/* List */}
      <ScrollArea className="h-[calc(100vh-280px)]">
        <div className="space-y-3 pr-3">
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
              />
            ))
          )}
        </div>
      </ScrollArea>

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
