
"use client"

import { useState } from 'react';
import { useProductSimulationCategory } from '@/hooks/use-product-simulation-category';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog';
import { PlusCircle, Trash2, Edit } from 'lucide-react';

interface SimulationCategoryManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SimulationCategoryManagementModal({ open, onOpenChange }: SimulationCategoryManagementModalProps) {
  const { categories, addCategory, deleteCategory } = useProductSimulationCategory();
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryToDelete, setCategoryToDelete] = useState<{ id: string, name: string } | null>(null);

  const handleAddCategory = () => {
    if (newCategoryName.trim()) {
      addCategory(newCategoryName);
      setNewCategoryName('');
    }
  };

  const handleDeleteConfirm = () => {
    if (categoryToDelete) {
      deleteCategory(categoryToDelete.id);
      setCategoryToDelete(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerenciar Categorias de Mercadorias</DialogTitle>
            <DialogDescription>Adicione ou remova categorias para organizar suas análises.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Nome da nova categoria"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
              />
              <Button onClick={handleAddCategory}>
                <PlusCircle className="mr-2 h-4 w-4" /> Adicionar
              </Button>
            </div>
            <ScrollArea className="h-60 border rounded-md">
              <div className="p-2 space-y-2">
                {categories.map(cat => (
                  <div key={cat.id} className="flex items-center justify-between rounded-md p-2 hover:bg-muted">
                    <span className="font-medium">{cat.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setCategoryToDelete(cat)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {categoryToDelete && (
        <DeleteConfirmationDialog
          open={!!categoryToDelete}
          onOpenChange={() => setCategoryToDelete(null)}
          onConfirm={handleDeleteConfirm}
          itemName={`a categoria "${categoryToDelete.name}"`}
        />
      )}
    </>
  );
}
