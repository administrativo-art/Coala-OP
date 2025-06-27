
"use client"

import { useState } from "react"
import Image from "next/image"
import { useForm as useFormHook } from "@/hooks/use-form"
import { useAuth } from "@/hooks/use-auth"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { PlusCircle, Edit, Trash2, FileText, ListChecks } from "lucide-react"
import { type FormTemplate } from "@/types"
import { AddEditFormTemplateModal } from "./add-edit-form-template-modal"
import { FillFormModal } from "./fill-form-modal"
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog"

export function FormModule() {
    const { templates, loading, addTemplate, updateTemplate, deleteTemplate, addSubmission } = useFormHook()
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
                <div className="text-center py-8 flex flex-col items-center gap-6">
                    <Image
                        src="https://placehold.co/300x225.png"
                        alt="Ilustração de um coala fofo espiando"
                        width={300}
                        height={225}
                        data-ai-hint="cute koala peeking illustration"
                        className="dark:mix-blend-lighten"
                    />
                    <div className="space-y-2">
                        <h3 className="text-xl font-semibold">Nenhum formulário por aqui</h3>
                        <p className="text-muted-foreground max-w-sm">
                            Que tal criar o seu primeiro modelo de formulário para começar?
                        </p>
                    </div>
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


    return (
        <>
            <Card className="w-full mx-auto animate-in fade-in zoom-in-95">
                <CardHeader>
                    <CardTitle className="font-headline flex items-center gap-2">
                       <ListChecks /> Formulários
                    </CardTitle>
                    <CardDescription>Crie, preencha e gerencie formulários para as operações diárias.</CardDescription>
                </CardHeader>
                <CardContent>
                    {permissions.forms.manage && (
                        <Button onClick={handleAddNew} className="w-full mb-6">
                            <PlusCircle className="mr-2 h-4 w-4" /> Novo formulário
                        </Button>
                    )}
                    {renderContent()}
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
