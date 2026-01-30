
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import type { RepositionActivity } from '@/types';

interface ResolveDivergenceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (resolution: 'trust_receipt' | 'trust_dispatch') => void;
  isLoading: boolean;
  activity: RepositionActivity | null;
}

export function ResolveDivergenceModal({
  open,
  onOpenChange,
  onConfirm,
  isLoading,
  activity
}: ResolveDivergenceModalProps) {
  if (!activity) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Resolver Divergência na Reposição</DialogTitle>
          <DialogDescription>
            A contagem no recebimento para a atividade #{activity.id.slice(-6)} foi diferente do envio. Como você deseja prosseguir?
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <Button
            variant="outline"
            className="w-full h-auto p-4 text-left justify-start"
            onClick={() => onConfirm('trust_receipt')}
            disabled={isLoading}
          >
            <div className="flex flex-col">
              <span className="font-semibold">1. Confiar no Recebimento</span>
              <span className="text-xs text-muted-foreground">
                O estoque do destino será creditado com a quantidade contada no recebimento. A diferença retornará ao estoque da origem.
              </span>
            </div>
          </Button>
          <Button
            variant="outline"
            className="w-full h-auto p-4 text-left justify-start"
            onClick={() => onConfirm('trust_dispatch')}
            disabled={isLoading}
          >
            <div className="flex flex-col">
              <span className="font-semibold">2. Confiar no Despacho</span>
              <span className="text-xs text-muted-foreground">
                O estoque do destino será creditado com a quantidade total que foi enviada. A divergência deverá ser ajustada no destino.
              </span>
            </div>
          </Button>
        </div>
        {isLoading && (
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="ml-2">Processando efetivação...</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
