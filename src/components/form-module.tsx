
"use client"

import { useState } from "react"
import { useForm as useFormHook } from "@/hooks/use-form"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { PlusCircle, Edit, Trash2, FileText, ListChecks, History } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { type FormTemplate } from "@/types"
import { AddEditFormTemplateModal } from "./add-edit-form-template-modal"
import { FillFormModal } from "./fill-form-modal"
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog"
import { FormSubmissionsHistory } from "./form-submissions-history"
import { Badge } from "./ui/badge"

export function FormModule() {
    const { templates, submissions, loading, addTemplate, updateTemplate, deleteTemplate, addSubmission, deleteSubmission } = useFormHook()
    const { permissions } = useAuth()

    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false)
    const [templateToEdit, setTemplateToEdit] = useState<FormTemplate | null>(null)
    const [templateToDelete, setTemplateToDelete] = useState<FormTemplate | null>(null)
    const [templateToFill, setTemplateToFill] = useState<FormTemplate | null>(null);

    const handleAddNew = () => {
        setTemplateToEdit(null);
        setIsAddEditModalOpen(true);
    };

    const handleEdit = (template: FormTemplate) => {
        setTemplateToEdit(template)
        setIsAddEditModalOpen(true)
    }

    const handleDelete = (template: FormTemplate) => {
        setTemplateToDelete(template)
    }

    const handleFill = (template: FormTemplate) => {
        setTemplateToFill(template);
    }

    const handleDeleteConfirm = async () => {
        if (templateToDelete) {
            await deleteTemplate(templateToDelete.id)
            setTemplateToDelete(null)
        }
    }

    const renderAvailableForms = () => {
        if (loading) {
            return (
                <div className="space-y-3 pt-4">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                </div>
            )
        }
        
        if (templates.length === 0) {
            return (
                <div className="text-center py-12 px-6 border-2 border-dashed rounded-lg text-muted-foreground mt-6">
                    <FileText className="mx-auto h-12 w-12" />
                    <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhum formulário disponível</h3>
                    {permissions.forms.manage && <p className="mt-1 text-sm">Clique no botão "Novo formulário" para criar o seu primeiro.</p>}
                </div>
            )
        }

        return (
             <ScrollArea className="h-96 mt-4">
                <div className="space-y-2 pr-4">
                {templates.map(template => {
                    const itemCount = (template.sections?.reduce((acc, section) => acc + (section.questions?.length || 0), 0) || 0) + (template.questions?.length || 0);
                    const isPublished = template.status === 'published';
                    return (
                        <div key={template.id} className="flex items-center justify-between rounded-md border p-3">
                            <div className="flex items-center gap-3">
                                <FileText className="h-5 w-5 text-primary" />
                                <div>
                                    <span className="font-medium">{template.name}</span>
                                    <div className="flex items-center gap-2">
                                        <p className="text-xs text-muted-foreground">{itemCount} itens</p>
                                        <Badge variant={isPublished ? 'default' : 'secondary'}>
                                            {isPublished ? 'Publicado' : 'Rascunho'}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                {permissions.forms.fill && isPublished && <Button variant="outline" size="sm" onClick={() => handleFill(template)}>Preencher</Button>}
                                {permissions.forms.manage && (
                                    <>
                                        <Button variant="ghost" size="icon" onClick={() => handleEdit(template)}><Edit className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(template)}><Trash2 className="h-4 w-4" /></Button>
                                    </>
                                )}
                            </div>
                        </div>
                    )
                })}
                </div>
            </ScrollArea>
        )
    }


    return (
        <>
            <Tabs defaultValue="available" className="w-full">
                <div className="flex justify-between items-center">
                    <TabsList>
                        <TabsTrigger value="available">Formulários disponíveis</TabsTrigger>
                        {permissions.forms.viewHistory && <TabsTrigger value="history"><History className="mr-2 h-4 w-4" /> Histórico de respostas</TabsTrigger>}
                    </TabsList>
                    {permissions.forms.manage && (
                        <Button onClick={handleAddNew}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Novo formulário
                        </Button>
                    )}
                </div>
                <TabsContent value="available">
                    {renderAvailableForms()}
                </TabsContent>
                {permissions.forms.viewHistory && (
                    <TabsContent value="history">
                        <FormSubmissionsHistory 
                            submissions={submissions}
                            loading={loading}
                            deleteSubmission={deleteSubmission}
                            canDelete={permissions.forms.deleteHistory}
                        />
                    </TabsContent>
                )}
            </Tabs>
            
            <AddEditFormTemplateModal
                open={isAddEditModalOpen}
                onOpenChange={setIsAddEditModalOpen}
                templateToEdit={templateToEdit}
            />

            {templateToFill && <FillFormModal
                open={!!templateToFill}
                onOpenChange={() => setTemplateToFill(null)}
                template={templateToFill}
                addSubmission={addSubmission}
            />}

            {templateToDelete && permissions.forms.manage && (
                <DeleteConfirmationDialog
                    open={!!templateToDelete}
                    onOpenChange={() => setTemplateToDelete(null)}
                    onConfirm={handleDeleteConfirm}
                    itemName={`o modelo de formulário "${templateToDelete.name}"`}
                />
            )}
        </>
    )
}
