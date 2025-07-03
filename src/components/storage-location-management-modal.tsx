
"use client"

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2, Edit } from 'lucide-react';
import { type Location, type Kiosk } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { useLocations } from '@/hooks/use-locations';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const locationSchema = z.object({
  name: z.string().min(1, 'O nome é obrigatório.'),
  code: z.string().optional(),
  kioskId: z.string().min(1, 'O quiosque é obrigatório.'),
});

type LocationFormValues = z.infer<typeof locationSchema>;

type StorageLocationManagementModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kiosks: Kiosk[];
};

export function StorageLocationManagementModal({ open, onOpenChange, kiosks }: StorageLocationManagementModalProps) {
  const { locations, addLocation, updateLocation, deleteLocation } = useLocations();
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [locationToDelete, setLocationToDelete] = useState<Location | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedKioskFilter, setSelectedKioskFilter] = useState<string>('all');

  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: { name: '', code: '', kioskId: '' },
  });

  const filteredLocations = useMemo(() => {
    if (selectedKioskFilter === 'all') return locations;
    return locations.filter(loc => loc.kioskId === selectedKioskFilter);
  }, [locations, selectedKioskFilter]);

  const handleEditClick = (location: Location) => {
    setEditingLocation(location);
    form.reset(location);
  };

  const handleCancelEdit = () => {
    setEditingLocation(null);
    form.reset({ name: '', code: '', kioskId: '' });
  };

  const handleDeleteClick = (location: Location) => {
    setLocationToDelete(location);
  };

  const handleDeleteConfirm = async () => {
    if (locationToDelete) {
      setIsDeleting(true);
      await deleteLocation(locationToDelete.id);
      setIsDeleting(false);
      setLocationToDelete(null);
    }
  };

  const onSubmit = (values: LocationFormValues) => {
    if (editingLocation) {
      updateLocation({ ...editingLocation, ...values });
    } else {
      addLocation(values);
    }
    handleCancelEdit();
  };
  
  const getKioskName = (kioskId: string) => kiosks.find(k => k.id === kioskId)?.name || 'Desconhecido';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Gerenciar Localizações de Estoque</DialogTitle>
            <DialogDescription>Adicione ou edite os locais de armazenamento para cada quiosque.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 p-4 border rounded-lg">
                <h3 className="font-semibold text-lg">{editingLocation ? `Editando "${editingLocation.name}"` : 'Adicionar nova localização'}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField control={form.control} name="kioskId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Quiosque</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger></FormControl>
                          <SelectContent>{kiosks.map(kiosk => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}</SelectContent>
                        </Select><FormMessage />
                      </FormItem>
                  )}/>
                  <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem><FormLabel>Nome</FormLabel><FormControl><Input placeholder="Prateleira A-1" {...field} /></FormControl><FormMessage /></FormItem>
                  )}/>
                   <FormField control={form.control} name="code" render={({ field }) => (
                      <FormItem><FormLabel>Código (Opcional)</FormLabel><FormControl><Input placeholder="PA1" {...field} /></FormControl><FormMessage /></FormItem>
                  )}/>
                </div>
                <div className="flex justify-end gap-2">
                  {editingLocation && <Button type="button" variant="outline" onClick={handleCancelEdit}>Cancelar Edição</Button>}
                  <Button type="submit">{editingLocation ? 'Salvar Alterações' : 'Adicionar'}</Button>
                </div>
              </form>
            </Form>

            <div className="space-y-2">
                <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-lg">Localizações Cadastradas</h3>
                    <Select value={selectedKioskFilter} onValueChange={setSelectedKioskFilter}>
                        <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos os Quiosques</SelectItem>
                            {kiosks.map(kiosk => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <ScrollArea className="h-60 border rounded-md">
                <div className="p-2 space-y-2">
                    {filteredLocations.length > 0 ? filteredLocations.map(location => (
                    <div key={location.id} className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <span className="font-medium">{location.name} {location.code && `(${location.code})`}</span>
                            <p className="text-sm text-muted-foreground">{getKioskName(location.kioskId)}</p>
                        </div>
                        <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleEditClick(location)}><Edit className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(location)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                    </div>
                    )) : (
                    <p className="text-center text-muted-foreground py-8">Nenhuma localização encontrada.</p>
                    )}
                </div>
                </ScrollArea>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {locationToDelete && (
        <DeleteConfirmationDialog
          open={!!locationToDelete}
          isDeleting={isDeleting}
          onOpenChange={() => setLocationToDelete(null)}
          onConfirm={handleDeleteConfirm}
          itemName={`a localização "${locationToDelete.name}"`}
        />
      )}
    </>
  );
}
