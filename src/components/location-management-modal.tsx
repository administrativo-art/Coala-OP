

"use client"

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2, Palette, Save } from 'lucide-react';
import { type Kiosk } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { cn } from '@/lib/utils';
import { useKiosks } from '@/hooks/use-kiosks';
import { useToast } from '@/hooks/use-toast';

type KioskManagementModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kiosks: Kiosk[];
  updateKiosk: (kiosk: Kiosk) => void;
  deleteKiosk: (id: string) => void;
  permissions: { add: boolean, delete: boolean };
};

export function LocationManagementModal({ open, onOpenChange, kiosks, updateKiosk, deleteKiosk, permissions }: KioskManagementModalProps) {
  const { addKiosk } = useKiosks();
  const { toast } = useToast();
  const [newKioskName, setNewKioskName] = useState('');
  const [kioskToDelete, setKioskToDelete] = useState<Kiosk | null>(null);
  const [pdvIds, setPdvIds] = useState<Record<string, string>>({});

  const handleAddKiosk = () => {
    if (newKioskName.trim()) {
      addKiosk({ name: newKioskName.trim() });
      setNewKioskName('');
    }
  };

  const handleDeleteClick = (kiosk: Kiosk) => {
    setKioskToDelete(kiosk);
  };

  const handleDeleteConfirm = async () => {
    if (kioskToDelete) {
      await deleteKiosk(kioskToDelete.id);
      setKioskToDelete(null);
    }
  };
  
  const sortedKiosks = useMemo(() => {
    return [...kiosks].sort((a,b) => {
        if(a.id === 'matriz') return -1;
        if(b.id === 'matriz') return 1;
        return a.name.localeCompare(b.name);
    })
  }, [kiosks]);

  const getPdvId = (kiosk: Kiosk) =>
    pdvIds[kiosk.id] !== undefined ? pdvIds[kiosk.id] : (kiosk.pdvFilialId ?? '');

  const handleSavePdvId = async (kiosk: Kiosk) => {
    const pdvFilialId = (pdvIds[kiosk.id] ?? kiosk.pdvFilialId ?? '').trim();
    await updateKiosk({ ...kiosk, pdvFilialId: pdvFilialId || undefined });
    toast({ title: 'Salvo', description: `ID PDV Legal de ${kiosk.name} atualizado.` });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Gerenciar quiosques</DialogTitle>
            <DialogDescription>Adicione, edite ou exclua os quiosques.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Nome do novo quiosque"
                value={newKioskName}
                onChange={(e) => setNewKioskName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddKiosk()}
                disabled={!permissions.add}
              />
              <Button onClick={handleAddKiosk} disabled={!permissions.add}>
                <PlusCircle className="h-4 w-4" />
              </Button>
            </div>
            
            <ScrollArea className="h-72">
              <div className="space-y-2 pr-4">
                {sortedKiosks.length > 0 ? sortedKiosks.map(kiosk => (
                  <div key={kiosk.id} className="rounded-md border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{kiosk.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive h-8 w-8"
                        onClick={() => handleDeleteClick(kiosk)}
                        disabled={!permissions.delete || kiosk.id === 'matriz'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">ID PDV Legal</Label>
                        <Input
                          placeholder="ex: 17343"
                          value={getPdvId(kiosk)}
                          onChange={e => setPdvIds(prev => ({ ...prev, [kiosk.id]: e.target.value }))}
                          className="h-8 text-sm"
                          disabled={!permissions.add}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-5 h-8"
                        onClick={() => handleSavePdvId(kiosk)}
                        disabled={!permissions.add}
                      >
                        <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                      </Button>
                    </div>
                  </div>
                )) : (
                  <p className="text-center text-muted-foreground py-8">Nenhum quiosque cadastrado.</p>
                )}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
      {kioskToDelete && (
        <DeleteConfirmationDialog
          open={!!kioskToDelete}
          onOpenChange={() => setKioskToDelete(null)}
          onConfirm={handleDeleteConfirm}
          itemName={`o quiosque "${kioskToDelete.name}"`}
        />
      )}
    </>
  );
}
