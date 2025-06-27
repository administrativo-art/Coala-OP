
"use client"

import { useState } from "react"
import { useForm as useFormHook } from "@/hooks/use-form"
import { useAuth } from "@/hooks/use-auth"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { PlusCircle, Edit, Trash2, FileText, ListChecks, Wand2 } from "lucide-react"
import { type FormTemplate } from "@/types"
import { AddEditFormTemplateModal } from "./add-edit-form-template-modal"
import { FillFormModal } from "./fill-form-modal"
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog"

export function FormModule() {
    const { templates, loading, addTemplate, updateTemplate, deleteTemplate, addSubmission, submissions } = useFormHook()
    const { permissions } = useAuth()

    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false)
    const [templateToEdit, setTemplateToEdit] = useState<FormTemplate | null>(null)
    const [templateToDelete, setTemplateToDelete] = useState<FormTemplate | null>(null)
    const [templateToFill, setTemplateToFill] = useState<FormTemplate | null>(null);

    const handleAddNew = () => {
        setTemplateToEdit(null)
        setIsAddEditModalOpen(true)
    }

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

    const handleDeleteConfirm = () => {
        if (templateToDelete) {
            deleteTemplate(templateToDelete.id)
            setTemplateToDelete(null)
        }
    }

    const renderTemplateList = () => {
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
                    <h3 className="text-xl font-semibold">Nenhum formulário criado</h3>
                    <p className="text-muted-foreground mt-2 mb-6 max-w-sm">
                        Crie seu primeiro modelo de formulário para padronizar processos.
                    </p>
                    {permissions.forms.manage && <Button size="lg" onClick={handleAddNew}>
                        <PlusCircle className="mr-2 h-5 w-5" /> Criar modelo
                    </Button>}
                </div>
            )
        }

        return (
             <ScrollArea className="h-96">
                <div className="space-y-2 pr-4">
                {templates.map(template => {
                    const itemCount = template.sections.reduce((acc, section) => acc + section.questions.length, 0);
                    return (
                        <div key={template.id} className="flex items-center justify-between rounded-md border p-3">
                            <div className="flex items-center gap-3">
                                <FileText className="h-5 w-5 text-primary" />
                                <div>
                                    <span className="font-medium">{template.name}</span>
                                    <p className="text-xs text-muted-foreground">{itemCount} itens</p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                {permissions.forms.fill && <Button variant="outline" size="sm" onClick={() => handleFill(template)}>Preencher</Button>}
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

    const renderHistory = () => {
        if (loading) {
            return (
                <div className="space-y-3">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                </div>
            )
        }

        if (submissions.length === 0) {
            return (
                <div className="text-center py-16 text-muted-foreground">
                    <p>Nenhum formulário foi preenchido ainda.</p>
                </div>
            )
        }
        
        // A more detailed history view can be implemented here
        return (
            <ScrollArea className="h-96">
                <div className="space-y-2 pr-4">
                    {submissions.map(sub => (
                        <div key={sub.id} className="text-sm p-3 border rounded-md">
                           <p><strong>{sub.templateName}</strong> preenchido por <strong>{sub.username}</strong></p>
                           <p className="text-xs text-muted-foreground">
                                Em {new Date(sub.createdAt).toLocaleString()} no quiosque {sub.kioskName}
                           </p>
                        </div>
                    ))}
                </div>
            </ScrollArea>
        )
    }


    return (
        <>
            <Card className="w-full mx-auto animate-in fade-in zoom-in-95">
                <CardHeader>
                    <CardTitle className="text-center font-headline flex items-center justify-center gap-2">
                       <ListChecks /> Módulo de formulários
                    </CardTitle>
                    <CardDescription className="text-center">Crie, preencha e gerencie formulários para as operações diárias.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="fill">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="fill" disabled={!permissions.forms.fill}>Preencher formulário</TabsTrigger>
                            <TabsTrigger value="history" disabled={!permissions.forms.viewHistory}>Histórico</TabsTrigger>
                        </TabsList>
                        
                        <TabsContent value="fill" className="mt-6">
                            {permissions.forms.manage && <Button onClick={handleAddNew} className="w-full mb-4">
                                <PlusCircle className="mr-2 h-4 w-4" /> Novo formulário
                            </Button>}
                            {renderTemplateList()}
                        </TabsContent>

                        <TabsContent value="history" className="mt-6">
                            {renderHistory()}
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>
            
            {permissions.forms.manage && <AddEditFormTemplateModal
                open={isAddEditModalOpen}
                onOpenChange={setIsAddEditModalOpen}
                templateToEdit={templateToEdit}
                addTemplate={addTemplate}
                updateTemplate={updateTemplate}
            />}

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
