
"use client";

import React, { useState, useMemo } from 'react';
import { useCompetitors } from '@/hooks/use-competitors';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle, Edit, Trash2, Building } from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ScrollArea } from './ui/scroll-area';
import { type Competitor } from '@/types';
import { AddEditCompetitorModal } from './add-edit-competitor-modal';

export function CompetitorManagementModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { competitors, loading, deleteCompetitor } = useCompetitors();
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [competitorToDelete, setCompetitorToDelete] = useState<Competitor | null>(null);

  const handleAddNew = () => {
    setEditingCompetitor(null);
    setIsFormModalOpen(true);
  };
  
  const handleStartEdit = (competitor: Competitor) => {
    setEditingCompetitor(competitor);
    setIsFormModalOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (competitorToDelete) {
        deleteCompetitor(competitorToDelete.id);
        setCompetitorToDelete(null);
    }
  };

  if (loading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-xl h-[90vh] flex flex-col">
            <DialogHeader>
                <DialogTitle>Gerenciamento de Concorrência</DialogTitle>
                <DialogDescription>Adicione, edite e gerencie seus concorrentes.</DialogDescription>
            </DialogHeader>

            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="mb-4">
                    <Button onClick={handleAddNew} className="w-full">
                        <PlusCircle className="mr-2 h-4 w-4" /> Adicionar novo concorrente
                    </Button>
                </div>
                <div className="flex-1 overflow-auto mt-2">
                    <ScrollArea className="h-full pr-4">
                        <div className="space-y-2">
                            {competitors.map(c => (
                                <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <Building className="h-5 w-5 text-muted-foreground" />
                                        <div>
                                            <p className="font-semibold">{c.name}</p>
                                            <p className="text-sm text-muted-foreground">{c.address}, {c.city} - {c.state}</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-1">
                                        <Button variant="ghost" size="icon" onClick={() => handleStartEdit(c)}><Edit className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setCompetitorToDelete(c)}><Trash2 className="h-4 w-4" /></Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                </div>
            </div>
             <DialogFooter className="border-t pt-4">
                <Button variant="outline" onClick={onClose}>Fechar</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    {isFormModalOpen && (
        <AddEditCompetitorModal
            isOpen={isFormModalOpen}
            onClose={() => setIsFormModalOpen(false)}
            competitorToEdit={editingCompetitor}
        />
    )}

    <DeleteConfirmationDialog 
        open={!!competitorToDelete}
        onOpenChange={() => setCompetitorToDelete(null)}
        onConfirm={handleDeleteConfirm}
        itemName={`o concorrente "${competitorToDelete?.name}"`}
        description="Esta ação também excluirá permanentemente todos os produtos e preços associados a este concorrente."
    />
    </>
  );
}
