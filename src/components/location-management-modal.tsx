

"use client"

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2, Palette } from 'lucide-react';
import { type Kiosk } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { cn } from '@/lib/utils';
import { useKiosks } from '@/hooks/use-kiosks';

type KioskManagementModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kiosks: Kiosk[];
  updateKiosk: (kiosk: Kiosk) => void;
  deleteKiosk: (id: string) => void;
  permissions: { add: boolean, delete: boolean };
};

const kioskColors = ['#FCA5A5', '#FDBA74', '#FCD34D', '#A7F3D0', '#93C5FD', '#C4B5FD', '#F9A8D4'];

export function LocationManagementModal({ open, onOpenChange, kiosks, updateKiosk, deleteKiosk, permissions }: KioskManagementModalProps) {
  const { addKiosk } = useKiosks();
  const [newKioskName, setNewKioskName] = useState('');
  const [kioskToDelete, setKioskToDelete] = useState<Kiosk | null>(null);

  const handleAddKiosk = () => {
    if (newKioskName.trim()) {
      addKiosk({ name: newKioskName.trim(), color: kioskColors[0] });
      setNewKioskName('');
    }
  };
  
  const handleColorChange = (kiosk: Kiosk, color: string) => {
    updateKiosk({ ...kiosk, color });
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
                  <div key={kiosk.id} className="grid grid-cols-[1fr_auto] items-center rounded-md border p-3 gap-2">
                    <span className="font-medium">{kiosk.name}</span>
                    <div className="flex items-center gap-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="icon" className="h-8 w-8">
                            <Palette className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <div className="p-2 grid grid-cols-4 gap-2">
                            {kioskColors.map(color => (
                              <button
                                key={color}
                                className={cn(
                                  "h-8 w-8 rounded-full border-2 transition-all",
                                  kiosk.color === color ? 'border-primary ring-2 ring-ring' : 'border-transparent'
                                )}
                                style={{ backgroundColor: color }}
                                onClick={() => handleColorChange(kiosk, color)}
                              />
                            ))}
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>

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
