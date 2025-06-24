"use client"

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Trash2 } from 'lucide-react';
import { type Location } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

type LocationManagementModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations: Location[];
  addLocation: (name: string) => void;
  deleteLocation: (id: string) => void;
  permissions: { add: boolean, delete: boolean };
};

export function LocationManagementModal({ open, onOpenChange, locations, addLocation, deleteLocation, permissions }: LocationManagementModalProps) {
  const [newLocationName, setNewLocationName] = useState('');
  const [locationToDelete, setLocationToDelete] = useState<Location | null>(null);

  const handleAddLocation = () => {
    if (newLocationName.trim()) {
      addLocation(newLocationName.trim());
      setNewLocationName('');
    }
  };

  const handleDeleteClick = (location: Location) => {
    setLocationToDelete(location);
  };

  const handleDeleteConfirm = () => {
    if (locationToDelete) {
      deleteLocation(locationToDelete.id);
      setLocationToDelete(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Gerenciar Lojas/Locais</DialogTitle>
            <DialogDescription>Adicione, edite ou exclua os locais de armazenamento.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Nome do novo local"
                value={newLocationName}
                onChange={(e) => setNewLocationName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddLocation()}
                disabled={!permissions.add}
              />
              <Button onClick={handleAddLocation} disabled={!permissions.add}>
                <PlusCircle className="h-4 w-4" />
              </Button>
            </div>
            <Separator />
            <ScrollArea className="h-60">
              <div className="space-y-2 pr-4">
                {locations.length > 0 ? locations.map(location => (
                  <div key={location.id} className="flex items-center justify-between rounded-md border p-3">
                    <span className="font-medium">{location.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteClick(location)}
                      disabled={!permissions.delete}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )) : (
                  <p className="text-center text-muted-foreground py-8">Nenhum local cadastrado.</p>
                )}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
      {locationToDelete && (
        <DeleteConfirmationDialog
          open={!!locationToDelete}
          onOpenChange={() => setLocationToDelete(null)}
          onConfirm={handleDeleteConfirm}
          itemName={`o local "${locationToDelete.name}"`}
        />
      )}
    </>
  );
}
