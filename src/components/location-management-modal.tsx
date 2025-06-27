
"use client"

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Trash2 } from 'lucide-react';
import { type Kiosk } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

type KioskManagementModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kiosks: Kiosk[];
  addKiosk: (name: string) => void;
  deleteKiosk: (id: string) => void;
  permissions: { add: boolean, delete: boolean };
};

export function LocationManagementModal({ open, onOpenChange, kiosks, addKiosk, deleteKiosk, permissions }: KioskManagementModalProps) {
  const [newKioskName, setNewKioskName] = useState('');
  const [kioskToDelete, setKioskToDelete] = useState<Kiosk | null>(null);

  const handleAddKiosk = () => {
    if (newKioskName.trim()) {
      addKiosk(newKioskName.trim());
      setNewKioskName('');
    }
  };

  const handleDeleteClick = (kiosk: Kiosk) => {
    setKioskToDelete(kiosk);
  };

  const handleDeleteConfirm = () => {
    if (kioskToDelete) {
      deleteKiosk(kioskToDelete.id);
      setKioskToDelete(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
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
            <Separator />
            <ScrollArea className="h-60">
              <div className="space-y-2 pr-4">
                {kiosks.length > 0 ? kiosks.map(kiosk => (
                  <div key={kiosk.id} className="flex items-center justify-between rounded-md border p-3">
                    <span className="font-medium">{kiosk.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteClick(kiosk)}
                      disabled={!permissions.delete || kiosk.id === 'matriz'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
