
"use client"

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ListTodo, CheckCircle2, History, AlertCircle, Plus, Settings2, Trash2 } from 'lucide-react';
import { TaskList, type TaskListItem } from './task-list';
import { TaskDetailModal } from './task-detail-modal';
import { type Task, type LegacyTask, type TaskStatusDoc } from '@/types';
import { useAllTasks } from '@/hooks/use-all-tasks';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { useTasks } from '@/hooks/use-tasks';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


export function TaskManager() {
    const { allTasks, legacyTasks, loading } = useAllTasks();
    const {
        addTask,
        projects,
        statuses,
        createProject,
        updateProject,
        deleteProject,
        createStatus,
        updateStatusDoc,
        deleteStatusDoc,
    } = useTasks();
    const { toast } = useToast();
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isManageOpen, setIsManageOpen] = useState(false);
    const [draftTitle, setDraftTitle] = useState('');
    const [draftDescription, setDraftDescription] = useState('');
    const [draftProjectId, setDraftProjectId] = useState('');
    const [managerProjectId, setManagerProjectId] = useState('');
    const [managerProjectName, setManagerProjectName] = useState('');
    const [managerProjectDescription, setManagerProjectDescription] = useState('');
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectDescription, setNewProjectDescription] = useState('');
    const [newStatusName, setNewStatusName] = useState('');
    const [newStatusSlug, setNewStatusSlug] = useState('');
    const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
    const [editingStatusName, setEditingStatusName] = useState('');
    const [editingStatusSlug, setEditingStatusSlug] = useState('');
    const [editingStatusCategory, setEditingStatusCategory] =
        useState<TaskStatusDoc['category']>('active');

    useEffect(() => {
        if (!draftProjectId && projects[0]?.id) {
            setDraftProjectId(projects[0].id);
        }
    }, [draftProjectId, projects]);

    useEffect(() => {
        if (!managerProjectId && projects[0]?.id) {
            setManagerProjectId(projects[0].id);
        }
    }, [managerProjectId, projects]);

    useEffect(() => {
        const project = projects.find((entry) => entry.id === managerProjectId);
        setManagerProjectName(project?.name ?? '');
        setManagerProjectDescription(project?.description ?? '');
    }, [managerProjectId, projects]);

    const taskLists = useMemo(() => {
        // New tasks logic
        const pendingNew: TaskListItem[] = allTasks.filter(t => t.status === 'pending' || t.status === 'reopened');
        const awaitingApproval = allTasks.filter(t => t.status === 'awaiting_approval');
        const completed = allTasks.filter(t => t.status === 'completed');
        const legacyPending: TaskListItem[] = legacyTasks.map((task) => ({
            ...task,
            legacy: true as const,
        }));

        // Combine new pending tasks with legacy tasks
        const allPending: TaskListItem[] = [...pendingNew, ...legacyPending];

        return {
            pending: allPending,
            awaiting_approval: awaitingApproval,
            completed,
        };
    }, [allTasks, legacyTasks]);

    if (loading) {
        return <Skeleton className="h-96 w-full" />;
    }

    const selectedProjectStatuses = statuses
        .filter((status) => status.project_id === managerProjectId)
        .sort((left, right) => left.order - right.order);

    const handleCreateTask = async () => {
        if (!draftTitle.trim()) {
            toast({ variant: 'destructive', title: 'Título obrigatório' });
            return;
        }

        const taskId = await addTask({
            title: draftTitle.trim(),
            description: draftDescription.trim() || undefined,
            status: 'pending',
            assigneeType: 'user',
            assigneeId: '',
            requiresApproval: false,
            origin: { kind: 'manual' },
            history: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            projectId: draftProjectId || undefined,
        });

        if (!taskId) {
            toast({ variant: 'destructive', title: 'Não foi possível criar a tarefa.' });
            return;
        }

        setDraftTitle('');
        setDraftDescription('');
        setDraftProjectId(projects[0]?.id ?? '');
        setIsCreateOpen(false);
        toast({ title: 'Tarefa criada' });
    };

    const handleCreateProject = async () => {
        if (!newProjectName.trim()) {
            toast({ variant: 'destructive', title: 'Nome do projeto é obrigatório' });
            return;
        }

        const projectId = await createProject({
            name: newProjectName.trim(),
            description: newProjectDescription.trim() || undefined,
        });

        if (!projectId) {
            toast({ variant: 'destructive', title: 'Não foi possível criar o projeto.' });
            return;
        }

        setNewProjectName('');
        setNewProjectDescription('');
        setManagerProjectId(projectId);
        toast({ title: 'Projeto criado' });
    };

    const handleUpdateProject = async () => {
        if (!managerProjectId || !managerProjectName.trim()) {
            toast({ variant: 'destructive', title: 'Selecione um projeto válido.' });
            return;
        }

        await updateProject(managerProjectId, {
            name: managerProjectName.trim(),
            description: managerProjectDescription.trim() || undefined,
        });
        toast({ title: 'Projeto atualizado' });
    };

    const handleDeleteProject = async () => {
        if (!managerProjectId) return;
        await deleteProject(managerProjectId);
        setManagerProjectId(projects.find((project) => project.id !== managerProjectId)?.id ?? '');
        toast({ title: 'Projeto removido' });
    };

    const handleCreateStatus = async () => {
        if (!managerProjectId || !newStatusName.trim() || !newStatusSlug.trim()) {
            toast({ variant: 'destructive', title: 'Projeto, nome e slug do status são obrigatórios.' });
            return;
        }

        const statusId = await createStatus({
            project_id: managerProjectId,
            name: newStatusName.trim(),
            slug: newStatusSlug.trim(),
            category: 'active',
            order: selectedProjectStatuses.length * 10 + 50,
        });

        if (!statusId) {
            toast({ variant: 'destructive', title: 'Não foi possível criar o status.' });
            return;
        }

        setNewStatusName('');
        setNewStatusSlug('');
        toast({ title: 'Status criado' });
    };

    const startEditStatus = (status: TaskStatusDoc) => {
        setEditingStatusId(status.id);
        setEditingStatusName(status.name);
        setEditingStatusSlug(status.slug);
        setEditingStatusCategory(status.category);
    };

    const handleUpdateStatus = async (status: TaskStatusDoc) => {
        if (!editingStatusId || !editingStatusName.trim() || !editingStatusSlug.trim()) {
            toast({ variant: 'destructive', title: 'Nome e slug são obrigatórios.' });
            return;
        }

        await updateStatusDoc(status.id, {
            project_id: status.project_id,
            name: editingStatusName.trim(),
            slug: editingStatusSlug.trim(),
            category: editingStatusCategory,
            is_initial: status.is_initial,
            is_terminal: status.is_terminal,
            order: status.order,
            color: status.color ?? null,
        });

        setEditingStatusId(null);
        toast({ title: 'Status atualizado' });
    };

    const handleDeleteStatus = async (statusId: string) => {
        await deleteStatusDoc(statusId);
        if (editingStatusId === statusId) {
            setEditingStatusId(null);
        }
        toast({ title: 'Status removido' });
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <ListTodo />
                                Central de tarefas e pendências
                            </CardTitle>
                            <CardDescription>
                                Visualize e gerencie todas as suas tarefas e pendências do sistema em um só lugar.
                            </CardDescription>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setIsManageOpen(true)}>
                                <Settings2 className="mr-2 h-4 w-4" />
                                Projetos e status
                            </Button>
                            <Button onClick={() => setIsCreateOpen(true)}>
                                <Plus className="mr-2 h-4 w-4" />
                                Nova tarefa
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="pending">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="pending">
                                <AlertCircle className="mr-2 h-4 w-4" /> Pendentes ({taskLists.pending.length})
                            </TabsTrigger>
                            <TabsTrigger value="awaiting_approval">
                                <History className="mr-2 h-4 w-4" /> Aguardando aprovação ({taskLists.awaiting_approval.length})
                            </TabsTrigger>
                            <TabsTrigger value="completed">
                                <CheckCircle2 className="mr-2 h-4 w-4" /> Concluídas
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="pending" className="mt-4">
                            <TaskList tasks={taskLists.pending} onTaskSelect={setSelectedTask} />
                        </TabsContent>
                         <TabsContent value="awaiting_approval" className="mt-4">
                            <TaskList tasks={taskLists.awaiting_approval} onTaskSelect={setSelectedTask} />
                        </TabsContent>
                        <TabsContent value="completed" className="mt-4">
                            <TaskList tasks={taskLists.completed} onTaskSelect={setSelectedTask} />
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>

            <TaskDetailModal
                task={selectedTask}
                onOpenChange={() => setSelectedTask(null)}
            />

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Nova tarefa manual</DialogTitle>
                        <DialogDescription>
                            Esta criação já usa o novo motor server-side de tarefas.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Título</label>
                            <Input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Ex.: Revisar fechamento do turno" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Descrição</label>
                            <Textarea value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} placeholder="Contexto ou instruções" rows={4} />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Projeto</label>
                            <Select value={draftProjectId} onValueChange={setDraftProjectId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione um projeto" />
                                </SelectTrigger>
                                <SelectContent>
                                    {projects.map((project) => (
                                        <SelectItem key={project.id} value={project.id}>
                                            {project.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
                        <Button onClick={handleCreateTask}>Criar tarefa</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isManageOpen} onOpenChange={setIsManageOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Projetos e status do motor novo</DialogTitle>
                        <DialogDescription>
                            Gestão mínima do catálogo de tarefas por projeto e status.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-4">
                            <div className="rounded-lg border p-4 space-y-3">
                                <h3 className="font-medium">Criar projeto</h3>
                                <Input
                                    value={newProjectName}
                                    onChange={(event) => setNewProjectName(event.target.value)}
                                    placeholder="Nome do projeto"
                                />
                                <Textarea
                                    value={newProjectDescription}
                                    onChange={(event) => setNewProjectDescription(event.target.value)}
                                    placeholder="Descrição opcional"
                                    rows={3}
                                />
                                <Button onClick={handleCreateProject}>Criar projeto</Button>
                            </div>

                            <div className="rounded-lg border p-4 space-y-3">
                                <h3 className="font-medium">Editar projeto</h3>
                                <Select value={managerProjectId} onValueChange={setManagerProjectId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione um projeto" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {projects.map((project) => (
                                            <SelectItem key={project.id} value={project.id}>
                                                {project.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Input
                                    value={managerProjectName}
                                    onChange={(event) => setManagerProjectName(event.target.value)}
                                    placeholder="Nome"
                                    disabled={!managerProjectId}
                                />
                                <Textarea
                                    value={managerProjectDescription}
                                    onChange={(event) => setManagerProjectDescription(event.target.value)}
                                    placeholder="Descrição"
                                    rows={3}
                                    disabled={!managerProjectId}
                                />
                                <div className="flex gap-2">
                                    <Button onClick={handleUpdateProject} disabled={!managerProjectId}>
                                        Salvar projeto
                                    </Button>
                                    <Button variant="destructive" onClick={handleDeleteProject} disabled={!managerProjectId}>
                                        Excluir projeto
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="rounded-lg border p-4 space-y-3">
                                <h3 className="font-medium">Criar status</h3>
                                <Input
                                    value={newStatusName}
                                    onChange={(event) => setNewStatusName(event.target.value)}
                                    placeholder="Nome do status"
                                    disabled={!managerProjectId}
                                />
                                <Input
                                    value={newStatusSlug}
                                    onChange={(event) => setNewStatusSlug(event.target.value)}
                                    placeholder="Slug"
                                    disabled={!managerProjectId}
                                />
                                <Button onClick={handleCreateStatus} disabled={!managerProjectId}>
                                    Criar status
                                </Button>
                            </div>

                            <div className="rounded-lg border p-4 space-y-3">
                                <h3 className="font-medium">Status do projeto</h3>
                                {!managerProjectId ? (
                                    <p className="text-sm text-muted-foreground">Selecione um projeto para gerenciar seus status.</p>
                                ) : selectedProjectStatuses.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">Nenhum status cadastrado.</p>
                                ) : (
                                    <div className="space-y-3">
                                        {selectedProjectStatuses.map((status) => (
                                            <div key={status.id} className="rounded-md border p-3 space-y-2">
                                                {editingStatusId === status.id ? (
                                                    <>
                                                        <Input
                                                            value={editingStatusName}
                                                            onChange={(event) => setEditingStatusName(event.target.value)}
                                                            placeholder="Nome"
                                                        />
                                                        <Input
                                                            value={editingStatusSlug}
                                                            onChange={(event) => setEditingStatusSlug(event.target.value)}
                                                            placeholder="Slug"
                                                        />
                                                        <Select
                                                            value={editingStatusCategory}
                                                            onValueChange={(value) => setEditingStatusCategory(value as TaskStatusDoc['category'])}
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="not_started">Não iniciado</SelectItem>
                                                                <SelectItem value="active">Ativo</SelectItem>
                                                                <SelectItem value="done">Concluído</SelectItem>
                                                                <SelectItem value="canceled">Cancelado</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        <div className="flex gap-2">
                                                            <Button onClick={() => handleUpdateStatus(status)}>Salvar status</Button>
                                                            <Button variant="outline" onClick={() => setEditingStatusId(null)}>Cancelar</Button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div>
                                                                <p className="font-medium">{status.name}</p>
                                                                <p className="text-xs text-muted-foreground">
                                                                    {status.slug} • {status.category}
                                                                    {status.is_initial ? ' • inicial' : ''}
                                                                    {status.is_terminal ? ' • terminal' : ''}
                                                                </p>
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <Button variant="outline" size="sm" onClick={() => startEditStatus(status)}>
                                                                    Editar
                                                                </Button>
                                                                <Button variant="ghost" size="sm" onClick={() => handleDeleteStatus(status.id)}>
                                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
