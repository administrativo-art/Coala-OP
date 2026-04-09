"use client";

import { useState } from 'react';
import { useGoals } from '@/contexts/goals-context';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { type GoalPeriodDoc } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface CloseGoalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: GoalPeriodDoc | null;
}

export function CloseGoalModal({ open, onOpenChange, period }: CloseGoalModalProps) {
  const { closePeriod } = useGoals();
  const { user } = useAuth();
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const handleClose = async (status: 'closed' | 'cancelled') => {
    if (!period || !note.trim()) return;
    setLoading(true);
    await closePeriod(period.id, status, note.trim(), user?.id ?? '');
    toast({ title: status === 'closed' ? 'Meta encerrada.' : 'Meta cancelada.' });
    setNote('');
    setLoading(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Encerrar meta</DialogTitle>
          <DialogDescription>Informe o motivo antes de encerrar ou cancelar esta meta.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="closure-note">Nota de encerramento <span className="text-destructive">*</span></Label>
          <Textarea
            id="closure-note"
            placeholder="Descreva o motivo do encerramento..."
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={4}
          />
        </div>
        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button
            variant="destructive"
            onClick={() => handleClose('cancelled')}
            disabled={!note.trim() || loading}
          >
            Cancelar Meta
          </Button>
          <Button
            onClick={() => handleClose('closed')}
            disabled={!note.trim() || loading}
          >
            Encerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
