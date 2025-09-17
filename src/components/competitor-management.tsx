
"use client";

import React, { useState } from 'react';
import { useCompetitors } from '@/hooks/use-competitors';
import { 
    Card, 
    CardContent, 
    CardDescription, 
    CardHeader, 
    CardTitle 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Edit, Trash2, Building } from 'lucide-react';
import { Skeleton } from './ui/skeleton';

export function CompetitorManagement() {
  const { competitors, loading, addCompetitor, updateCompetitor, deleteCompetitor } = useCompetitors();
  const [newCompetitorName, setNewCompetitorName] = useState('');
  const [editingCompetitor, setEditingCompetitor] = useState<{ id: string, name: string } | null>(null);

  const handleAddCompetitor = async () => {
    if (newCompetitorName.trim()) {
      await addCompetitor(newCompetitorName.trim());
      setNewCompetitorName('');
    }
  };

  const handleUpdateCompetitor = async () => {
    if (editingCompetitor && newCompetitorName.trim()) {
      await updateCompetitor(editingCompetitor.id, { name: newCompetitorName.trim() });
      setNewCompetitorName('');
      setEditingCompetitor(null);
    }
  };
  
  const handleStartEdit = (competitor: { id: string, name: string }) => {
    setEditingCompetitor(competitor);
    setNewCompetitorName(competitor.name);
  };

  const handleCancelEdit = () => {
    setEditingCompetitor(null);
    setNewCompetitorName('');
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gerenciamento de Concorrência</CardTitle>
        <CardDescription>Adicione, edite e remova concorrentes para análise de preços.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input 
            placeholder={editingCompetitor ? `Editando "${editingCompetitor.name}"` : "Nome do novo concorrente"}
            value={newCompetitorName}
            onChange={(e) => setNewCompetitorName(e.target.value)}
          />
          {editingCompetitor ? (
            <>
              <Button onClick={handleUpdateCompetitor}>Salvar</Button>
              <Button variant="outline" onClick={handleCancelEdit}>Cancelar</Button>
            </>
          ) : (
            <Button onClick={handleAddCompetitor}>
              <PlusCircle className="mr-2 h-4 w-4" /> Adicionar
            </Button>
          )}
        </div>
        <div className="space-y-2 pt-4 border-t">
          {competitors.map(c => (
            <div key={c.id} className="flex items-center justify-between p-2 border rounded-lg">
              <div className="flex items-center gap-2">
                <Building className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium">{c.name}</span>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => handleStartEdit(c)}>
                  <Edit className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteCompetitor(c.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
