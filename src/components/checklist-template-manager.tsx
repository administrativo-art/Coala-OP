"use client"

import { useState } from "react"
import { useChecklist } from "@/hooks/use-checklist"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { PlusCircle, Edit, Trash2, FileText, ListChecks, Wand2 } from "lucide-react"
import { type ChecklistTemplate } from "@/types"
import { AddEditChecklistTemplateModal } from "./add-edit-checklist-template-modal"
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog"

export function ChecklistTemplateManager() {
    const { templates, loading, addTemplate, updateTemplate, deleteTemplate } = useChecklist()
    const { permissions } = useAuth()

    const [isModalOpen, setIsModalOpen] = useState(false)
    const [templateToEdit, setTemplateToEdit] = useState<ChecklistTemplate | null>(null)
    const [templateToDelete, setTemplateToDelete] = useState<ChecklistTemplate | null>(null)

    const handleAddNew = () => {
        setTemplateToEdit(null)
        setIsModalOpen(true)
    }

    const handleEdit = (template: ChecklistTemplate) => {
        setTemplateToEdit(template)
        setIsModalOpen(true)
    }

    const handleDelete = (template: ChecklistTemplate) => {
        setTemplateToDelete(template)
    }

    const handleDeleteConfirm = () => {
        if (templateToDelete) {
            deleteTemplate(templateToDelete.id)
            setTemplateToDelete(null)
        }
    }

    const renderContent = () => {
        if (loading) {
            return (
                <div className="space-y-3">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                </div>
            )
        }
        
        if (templates.length === 0) {
            return (
                <div className="text-center py-8 flex flex-col items-center">
                    <Wand2 className="h-16 w-16 text-muted-foreground/50 mb-4" />
                    <h3 className="text-xl font-semibold">Nenhum modelo de checklist criado</h3>
                    <p className="text-muted-foreground mt-2 mb-6 max-w-sm">
                        Crie seu primeiro modelo de checklist para padronizar processos.
                    </p>
                    <Button size="lg" onClick={handleAddNew}>
                        <PlusCircle className="mr-2 h-5 w-5" /> Criar Modelo
                    </Button>
                </div>
            )
        }

        return (
             <ScrollArea className="h-72">
                <div className="space-y-2 pr-4">
                {templates.map(template => (
                    <div key={template.id} className="flex items-center justify-between rounded-md border p-3">
                    <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-primary" />
                        <div>
                             <span className="font-medium">{template.name}</span>
                             <p className="text-xs text-muted-foreground">{template.questions.length} perguntas</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(template)}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(template)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    </div>
                ))}
                </div>
            </ScrollArea>
        )
    }

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-xl"><ListChecks /> Modelos de Checklist</CardTitle>
                    <CardDescription>Crie e edite os modelos que serão preenchidos pelos usuários.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button onClick={handleAddNew} className="w-full mb-4">
                        <PlusCircle className="mr-2 h-4 w-4" /> Criar Novo Modelo
                    </Button>
                    {renderContent()}
                </CardContent>
            </Card>

            <AddEditChecklistTemplateModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                templateToEdit={templateToEdit}
                addTemplate={addTemplate}
                updateTemplate={updateTemplate}
            />

            {templateToDelete && (
                <DeleteConfirmationDialog
                    open={!!templateToDelete}
                    onOpenChange={() => setTemplateToDelete(null)}
                    onConfirm={handleDeleteConfirm}
                    itemName={`o modelo de checklist "${templateToDelete.name}"`}
                />
            )}
        </>
    )
}