
"use client"

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ListTodo, CheckCircle2, History, AlertCircle, Plus, Settings2, Trash2, RotateCcw, Clock } from 'lucide-react';
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
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useProfiles } from '@/hooks/use-profiles';
import { Badge } from './ui/badge';

const ALL_FILTER = '__all__';

const STATUS_LABELS: Record<Task['status'], string> = {
    pending: 'Pendente',
    in_progress: 'Em andamento',
    awaiting_approval: 'Aguardando aprovação',
    completed: 'Concluída',
    reopened: 'Reaberta',
    rejected: 'Rejeitada',
};

const ORIGIN_LABELS: Record<string, string> = {
    manual: 'Manual',
    form_trigger: 'Formulário',
    purchase_receipt: 'Recebimento de compra',
    legacy: 'Legado',
    return_request: 'Avaria/devolução',
    reposition_activity: 'Reposição',
    stock_count_approval: 'Contagem',
    item_addition_request: 'Solicitação de cadastro',
    'consumption-projection': 'Projeção de consumo',
    author_board_diary: 'Diário de bordo',
};

const AUTOMATIC_PROJECT_RULES = [
    {
        process: 'Reposição',
        project: 'Gestão de Estoque > Reposição',
        rule: 'Criada/atualizada pelo fluxo de reposição conforme a etapa: despacho, recebimento, auditoria ou conclusão.',
    },
    {
        process: 'Contagem de estoque',
        project: 'Gestão de Estoque > Contagem de estoque',
        rule: 'Criada quando uma sessão de contagem vai para revisão e concluída quando a contagem é finalizada.',
    },
    {
        process: 'Avarias e devoluções',
        project: 'Gestão de Estoque > Avarias e devoluções',
        rule: 'Criada no chamado de avaria/devolução e sincronizada com o status operacional do chamado.',
    },
    {
        process: 'Solicitações de cadastro',
        project: 'Gestão de Estoque > Solicitações de cadastro',
        rule: 'Criada quando a operação solicita cadastro de insumo durante a contagem.',
    },
    {
        process: 'Formulários',
        project: 'Configurado no gatilho do formulário',
        rule: 'Cada regra do formulário informa em qual projeto a tarefa deve nascer.',
    },
    {
        process: 'Tarefa manual',
        project: 'Escolhido pelo usuário',
        rule: 'O usuário seleciona o projeto no modal “Nova tarefa manual”.',
    },
];

function isLegacyTaskItem(task: TaskListItem): task is LegacyTask & { legacy: true } {
    return 'legacy' in task && task.legacy === true;
}

function taskOriginKey(task: Task) {
    if (task.origin.kind === 'legacy') return task.origin.type;
    return task.origin.kind;
}

function formatDate(value?: string) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('pt-BR');
}

function isOpenTask(task: Task) {
    return task.status === 'pending' || task.status === 'reopened' || task.status === 'in_progress';
}

function isTaskOverdue(task: Task) {
    if (!task.dueDate || task.status === 'completed' || task.status === 'rejected') return false;
    const due = new Date(task.dueDate);
    if (Number.isNaN(due.getTime())) return false;
    return due.getTime() < Date.now();
}

function isTaskDueToday(task: Task) {
    if (!task.dueDate) return false;
    const due = new Date(task.dueDate);
    if (Number.isNaN(due.getTime())) return false;
    const today = new Date();
    return due.toDateString() === today.toDateString();
}

export function TaskManager() {
    const { allTasks, legacyTasks, loading } = useAllTasks();
    const { users } = useAuth();
    const { kiosks } = useKiosks();
    const { profiles } = useProfiles();
    const {
        addTask,
        projects,
        subprojects,
        statuses,
        createProject,
        updateProject,
        deleteProject,
        createSubproject,
        updateSubproject,
        deleteSubproject,
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
    const [draftSubprojectId, setDraftSubprojectId] = useState('');
    const [managerProjectId, setManagerProjectId] = useState('');
    const [managerProjectName, setManagerProjectName] = useState('');
    const [managerProjectDescription, setManagerProjectDescription] = useState('');
    const [managerSubprojectId, setManagerSubprojectId] = useState('');
    const [managerSubprojectName, setManagerSubprojectName] = useState('');
    const [managerSubprojectDescription, setManagerSubprojectDescription] = useState('');
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectDescription, setNewProjectDescription] = useState('');
    const [newSubprojectName, setNewSubprojectName] = useState('');
    const [newSubprojectDescription, setNewSubprojectDescription] = useState('');
    const [newStatusName, setNewStatusName] = useState('');
    const [newStatusSlug, setNewStatusSlug] = useState('');
    const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
    const [editingStatusName, setEditingStatusName] = useState('');
    const [editingStatusSlug, setEditingStatusSlug] = useState('');
    const [editingStatusCategory, setEditingStatusCategory] =
        useState<TaskStatusDoc['category']>('active');
    const [search, setSearch] = useState('');
    const [projectFilter, setProjectFilter] = useState(ALL_FILTER);
    const [subprojectFilter, setSubprojectFilter] = useState(ALL_FILTER);
    const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
    const [unitFilter, setUnitFilter] = useState(ALL_FILTER);
    const [originFilter, setOriginFilter] = useState(ALL_FILTER);
    const [assigneeFilter, setAssigneeFilter] = useState(ALL_FILTER);
    const [dueFilter, setDueFilter] = useState(ALL_FILTER);

    useEffect(() => {
        if (!draftProjectId && projects[0]?.id) {
            setDraftProjectId(projects[0].id);
        }
    }, [draftProjectId, projects]);

    useEffect(() => {
        const available = subprojects.filter((subproject) => subproject.project_id === draftProjectId);
        if (draftProjectId && (!draftSubprojectId || !available.some((entry) => entry.id === draftSubprojectId))) {
            setDraftSubprojectId(available[0]?.id ?? '');
        }
    }, [draftProjectId, draftSubprojectId, subprojects]);

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

    useEffect(() => {
        const available = subprojects.filter((subproject) => subproject.project_id === managerProjectId);
        if (managerProjectId && (!managerSubprojectId || !available.some((entry) => entry.id === managerSubprojectId))) {
            setManagerSubprojectId(available[0]?.id ?? '');
        }
    }, [managerProjectId, managerSubprojectId, subprojects]);

    useEffect(() => {
        const subproject = subprojects.find((entry) => entry.id === managerSubprojectId);
        setManagerSubprojectName(subproject?.name ?? '');
        setManagerSubprojectDescription(subproject?.description ?? '');
    }, [managerSubprojectId, subprojects]);

    const projectsById = useMemo(
        () => new Map(projects.map((project) => [project.id, project])),
        [projects]
    );

    const statusesById = useMemo(
        () => new Map(statuses.map((status) => [status.id, status])),
        [statuses]
    );

    const subprojectsById = useMemo(
        () => new Map(subprojects.map((subproject) => [subproject.id, subproject])),
        [subprojects]
    );

    const unitsById = useMemo(
        () => new Map(kiosks.map((kiosk) => [kiosk.id, kiosk.name])),
        [kiosks]
    );

    const getStatusLabel = (task: Task) => {
        const statusDoc = task.statusId ? statusesById.get(task.statusId) : null;
        return statusDoc?.name ?? STATUS_LABELS[task.status] ?? task.status;
    };

    const getProjectName = (task: Task) => {
        return task.projectId ? projectsById.get(task.projectId)?.name ?? task.projectId : 'Sem projeto';
    };

    const getSubprojectName = (task: Task) => {
        if (task.subprojectName) return task.subprojectName;
        return task.subprojectId ? subprojectsById.get(task.subprojectId)?.name ?? task.subprojectId : 'Sem subprojeto';
    };

    const getUnitName = (task: Task) => {
        if (task.unitName) return task.unitName;
        if (task.unitId) return unitsById.get(task.unitId) ?? task.unitId;
        if (task.assigneeType === 'unit') return unitsById.get(task.assigneeId) ?? task.assigneeId;
        return '';
    };

    const getAssigneeName = (task: Task) => {
        if (!task.assigneeId) return 'Não definido';
        if (task.assigneeId === '__stock_count_approver__') {
            return 'Aprovadores de contagem';
        }
        if (task.assigneeId === '__return_request_handler__') {
            return 'Responsáveis por avarias';
        }
        if (task.assigneeId === '__item_request_approver__') {
            return 'Aprovadores de cadastro';
        }
        if (task.assigneeType === 'user') {
            return users.find((entry) => entry.id === task.assigneeId)?.username ?? task.assigneeId;
        }
        if (task.assigneeType === 'profile' || task.assigneeType === 'role') {
            return profiles.find((entry) => entry.id === task.assigneeId)?.name ?? task.assigneeId;
        }
        if (task.assigneeType === 'unit') {
            return unitsById.get(task.assigneeId) ?? task.assigneeId;
        }
        return task.assigneeId;
    };

    const unitOptions = useMemo(() => {
        const options = new Map<string, string>();
        allTasks.forEach((task) => {
            const unitId = task.unitId || (task.assigneeType === 'unit' ? task.assigneeId : '');
            const unitName = getUnitName(task);
            if (unitId && unitName) options.set(unitId, unitName);
        });
        kiosks.forEach((kiosk) => options.set(kiosk.id, kiosk.name));
        return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1], 'pt-BR'));
    }, [allTasks, kiosks, unitsById]);

    const originOptions = useMemo(() => {
        const keys = new Set<string>();
        allTasks.forEach((task) => keys.add(taskOriginKey(task)));
        if (legacyTasks.length > 0) keys.add('legacy');
        return [...keys]
            .map((key) => [key, ORIGIN_LABELS[key] ?? key] as const)
            .sort((left, right) => left[1].localeCompare(right[1], 'pt-BR'));
    }, [allTasks, legacyTasks.length]);

    const subprojectOptions = useMemo(() => {
        const options = new Map<string, string>();
        allTasks.forEach((task) => {
            if (task.subprojectId) options.set(task.subprojectId, getSubprojectName(task));
        });
        subprojects.forEach((subproject) => options.set(subproject.id, subproject.name));
        return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1], 'pt-BR'));
    }, [allTasks, subprojects, subprojectsById]);

    const assigneeOptions = useMemo(() => {
        const options = new Map<string, string>();
        allTasks.forEach((task) => {
            if (!task.assigneeId) return;
            options.set(`${task.assigneeType}:${task.assigneeId}`, getAssigneeName(task));
        });
        return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1], 'pt-BR'));
    }, [allTasks, users, profiles, unitsById]);

    const filtersActive = [
        search.trim(),
        projectFilter !== ALL_FILTER,
        subprojectFilter !== ALL_FILTER,
        statusFilter !== ALL_FILTER,
        unitFilter !== ALL_FILTER,
        originFilter !== ALL_FILTER,
        assigneeFilter !== ALL_FILTER,
        dueFilter !== ALL_FILTER,
    ].some(Boolean);

    const filteredTasks = useMemo(() => {
        const searchTerm = search.trim().toLowerCase();
        return allTasks.filter((task) => {
            const projectName = getProjectName(task);
            const subprojectName = getSubprojectName(task);
            const unitName = getUnitName(task);
            const assigneeName = getAssigneeName(task);
            const originKey = taskOriginKey(task);
            const originLabel = ORIGIN_LABELS[originKey] ?? originKey;
            const haystack = [
                task.title,
                task.description ?? '',
                projectName,
                subprojectName,
                unitName,
                assigneeName,
                originLabel,
                getStatusLabel(task),
            ].join(' ').toLowerCase();

            if (searchTerm && !haystack.includes(searchTerm)) return false;
            if (projectFilter !== ALL_FILTER && task.projectId !== projectFilter) return false;
            if (subprojectFilter !== ALL_FILTER && task.subprojectId !== subprojectFilter) return false;
            if (statusFilter !== ALL_FILTER) {
                if (statusFilter === 'open') {
                    if (!isOpenTask(task)) return false;
                } else if (statusFilter !== task.status) {
                    return false;
                }
            }
            if (unitFilter !== ALL_FILTER) {
                const taskUnitId = task.unitId || (task.assigneeType === 'unit' ? task.assigneeId : '');
                if (taskUnitId !== unitFilter) return false;
            }
            if (originFilter !== ALL_FILTER && originKey !== originFilter) return false;
            if (assigneeFilter !== ALL_FILTER && `${task.assigneeType}:${task.assigneeId}` !== assigneeFilter) return false;
            if (dueFilter === 'overdue' && !isTaskOverdue(task)) return false;
            if (dueFilter === 'today' && !isTaskDueToday(task)) return false;
            if (dueFilter === 'without_due_date' && task.dueDate) return false;
            return true;
        });
    }, [
        allTasks,
        search,
        projectFilter,
        subprojectFilter,
        statusFilter,
        unitFilter,
        originFilter,
        assigneeFilter,
        dueFilter,
        projectsById,
        subprojectsById,
        unitsById,
        statusesById,
        users,
        profiles,
    ]);

    const filteredLegacyTasks = useMemo(() => {
        const searchTerm = search.trim().toLowerCase();
        if (
            projectFilter !== ALL_FILTER ||
            subprojectFilter !== ALL_FILTER ||
            unitFilter !== ALL_FILTER ||
            assigneeFilter !== ALL_FILTER ||
            (originFilter !== ALL_FILTER && originFilter !== 'legacy') ||
            (statusFilter !== ALL_FILTER && statusFilter !== 'open' && statusFilter !== 'pending') ||
            dueFilter !== ALL_FILTER
        ) {
            return [];
        }

        return legacyTasks
            .filter((task) => {
                if (!searchTerm) return true;
                return [task.title, task.description, task.type].join(' ').toLowerCase().includes(searchTerm);
            })
            .map((task) => ({
                ...task,
                legacy: true as const,
            }));
    }, [legacyTasks, search, projectFilter, subprojectFilter, unitFilter, assigneeFilter, originFilter, statusFilter, dueFilter]);

    const taskLists = useMemo(() => {
        const pendingNew: TaskListItem[] = filteredTasks.filter(isOpenTask);
        const awaitingApproval = filteredTasks.filter(t => t.status === 'awaiting_approval');
        const overdue = filteredTasks.filter(isTaskOverdue);
        const completed = filteredTasks.filter(t => t.status === 'completed');
        const allVisible: TaskListItem[] = [...filteredTasks, ...filteredLegacyTasks];
        const allPending: TaskListItem[] = [...pendingNew, ...filteredLegacyTasks];

        return {
            pending: allPending,
            overdue,
            awaiting_approval: awaitingApproval,
            completed,
            all: allVisible,
        };
    }, [filteredTasks, filteredLegacyTasks]);

    if (loading) {
        return <Skeleton className="h-96 w-full" />;
    }

    const selectedProjectSubprojects = subprojects
        .filter((subproject) => subproject.project_id === managerProjectId)
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.name.localeCompare(right.name, 'pt-BR'));

    const selectedSubprojectStatuses = statuses
        .filter((status) => status.subproject_id === managerSubprojectId)
        .sort((left, right) => left.order - right.order);

    const resetFilters = () => {
        setSearch('');
        setProjectFilter(ALL_FILTER);
        setSubprojectFilter(ALL_FILTER);
        setStatusFilter(ALL_FILTER);
        setUnitFilter(ALL_FILTER);
        setOriginFilter(ALL_FILTER);
        setAssigneeFilter(ALL_FILTER);
        setDueFilter(ALL_FILTER);
    };

    const renderTaskMeta = (task: Task) => {
        const unitName = getUnitName(task);
        const originKey = taskOriginKey(task);
        const dueLabel = formatDate(task.dueDate);
        return (
            <>
                <Badge variant="secondary">{getProjectName(task)}</Badge>
                {task.subprojectId ? <Badge variant="outline">Subprojeto: {getSubprojectName(task)}</Badge> : null}
                {unitName ? <Badge variant="outline">Unidade: {unitName}</Badge> : null}
                <Badge variant="outline">Origem: {ORIGIN_LABELS[originKey] ?? originKey}</Badge>
                <Badge variant="outline">Resp.: {getAssigneeName(task)}</Badge>
                {dueLabel ? (
                    <Badge variant={isTaskOverdue(task) ? 'destructive' : 'outline'}>
                        Prazo: {dueLabel}
                    </Badge>
                ) : null}
            </>
        );
    };

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
            subprojectId: draftSubprojectId || undefined,
            subprojectName: draftSubprojectId ? subprojectsById.get(draftSubprojectId)?.name : undefined,
        });

        if (!taskId) {
            toast({ variant: 'destructive', title: 'Não foi possível criar a tarefa.' });
            return;
        }

        setDraftTitle('');
        setDraftDescription('');
        setDraftProjectId(projects[0]?.id ?? '');
        setDraftSubprojectId('');
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

    const handleCreateSubproject = async () => {
        if (!managerProjectId || !newSubprojectName.trim()) {
            toast({ variant: 'destructive', title: 'Projeto e nome do subprojeto são obrigatórios.' });
            return;
        }

        const subprojectId = await createSubproject({
            project_id: managerProjectId,
            name: newSubprojectName.trim(),
            description: newSubprojectDescription.trim() || undefined,
        });

        if (!subprojectId) {
            toast({ variant: 'destructive', title: 'Não foi possível criar o subprojeto.' });
            return;
        }

        setNewSubprojectName('');
        setNewSubprojectDescription('');
        setManagerSubprojectId(subprojectId);
        toast({ title: 'Subprojeto criado' });
    };

    const handleUpdateSubproject = async () => {
        if (!managerSubprojectId || !managerSubprojectName.trim()) {
            toast({ variant: 'destructive', title: 'Selecione um subprojeto válido.' });
            return;
        }

        await updateSubproject(managerSubprojectId, {
            name: managerSubprojectName.trim(),
            description: managerSubprojectDescription.trim() || undefined,
        });
        toast({ title: 'Subprojeto atualizado' });
    };

    const handleDeleteSubproject = async () => {
        if (!managerSubprojectId) return;
        await deleteSubproject(managerSubprojectId);
        setManagerSubprojectId(selectedProjectSubprojects.find((subproject) => subproject.id !== managerSubprojectId)?.id ?? '');
        toast({ title: 'Subprojeto removido' });
    };

    const handleCreateStatus = async () => {
        if (!managerProjectId || !managerSubprojectId || !newStatusName.trim() || !newStatusSlug.trim()) {
            toast({ variant: 'destructive', title: 'Projeto, subprojeto, nome e slug do status são obrigatórios.' });
            return;
        }

        const statusId = await createStatus({
            project_id: managerProjectId,
            subproject_id: managerSubprojectId,
            name: newStatusName.trim(),
            slug: newStatusSlug.trim(),
            category: 'active',
            order: selectedSubprojectStatuses.length * 10 + 50,
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
            subproject_id: status.subproject_id ?? managerSubprojectId,
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
                                Projetos e quadros
                            </Button>
                            <Button onClick={() => setIsCreateOpen(true)}>
                                <Plus className="mr-2 h-4 w-4" />
                                Nova tarefa
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="mb-4 space-y-3 rounded-xl border bg-muted/20 p-3">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <div>
                                <p className="text-sm font-medium">Filtros da central</p>
                                <p className="text-xs text-muted-foreground">
                                    Projetos representam processos; unidades entram como escopo da tarefa.
                                </p>
                            </div>
                            {filtersActive ? (
                                <Button variant="ghost" size="sm" onClick={resetFilters}>
                                    <RotateCcw className="mr-2 h-4 w-4" />
                                    Limpar filtros
                                </Button>
                            ) : null}
                        </div>

                        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                            <Input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Buscar por título, origem, unidade..."
                            />

                            <Select value={projectFilter} onValueChange={setProjectFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Projeto" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL_FILTER}>Todos os projetos</SelectItem>
                                    {projects.map((project) => (
                                        <SelectItem key={project.id} value={project.id}>
                                            {project.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Select value={subprojectFilter} onValueChange={setSubprojectFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Subprojeto" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL_FILTER}>Todos os subprojetos</SelectItem>
                                    {subprojectOptions.map(([subprojectId, subprojectName]) => (
                                        <SelectItem key={subprojectId} value={subprojectId}>
                                            {subprojectName}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Select value={unitFilter} onValueChange={setUnitFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Unidade" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL_FILTER}>Todas as unidades</SelectItem>
                                    {unitOptions.map(([unitId, unitName]) => (
                                        <SelectItem key={unitId} value={unitId}>
                                            {unitName}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL_FILTER}>Todos os status</SelectItem>
                                    <SelectItem value="open">Abertas</SelectItem>
                                    <SelectItem value="pending">Pendentes</SelectItem>
                                    <SelectItem value="in_progress">Em andamento</SelectItem>
                                    <SelectItem value="awaiting_approval">Aguardando aprovação</SelectItem>
                                    <SelectItem value="completed">Concluídas</SelectItem>
                                    <SelectItem value="reopened">Reabertas</SelectItem>
                                    <SelectItem value="rejected">Rejeitadas</SelectItem>
                                </SelectContent>
                            </Select>

                            <Select value={originFilter} onValueChange={setOriginFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Origem" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL_FILTER}>Todas as origens</SelectItem>
                                    {originOptions.map(([originKey, originLabel]) => (
                                        <SelectItem key={originKey} value={originKey}>
                                            {originLabel}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Responsável" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL_FILTER}>Todos os responsáveis</SelectItem>
                                    {assigneeOptions.map(([assigneeKey, assigneeName]) => (
                                        <SelectItem key={assigneeKey} value={assigneeKey}>
                                            {assigneeName}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Select value={dueFilter} onValueChange={setDueFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Prazo" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL_FILTER}>Todos os prazos</SelectItem>
                                    <SelectItem value="overdue">Atrasadas</SelectItem>
                                    <SelectItem value="today">Vencem hoje</SelectItem>
                                    <SelectItem value="without_due_date">Sem prazo</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <Tabs defaultValue="pending">
                        <TabsList className="grid w-full grid-cols-2 gap-1 md:grid-cols-5">
                            <TabsTrigger value="pending">
                                <AlertCircle className="mr-2 h-4 w-4" /> Abertas ({taskLists.pending.length})
                            </TabsTrigger>
                            <TabsTrigger value="overdue">
                                <Clock className="mr-2 h-4 w-4" /> Atrasadas ({taskLists.overdue.length})
                            </TabsTrigger>
                            <TabsTrigger value="awaiting_approval">
                                <History className="mr-2 h-4 w-4" /> Aguardando aprovação ({taskLists.awaiting_approval.length})
                            </TabsTrigger>
                            <TabsTrigger value="completed">
                                <CheckCircle2 className="mr-2 h-4 w-4" /> Concluídas ({taskLists.completed.length})
                            </TabsTrigger>
                            <TabsTrigger value="all">
                                <ListTodo className="mr-2 h-4 w-4" /> Todas ({taskLists.all.length})
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="pending" className="mt-4">
                            <TaskList tasks={taskLists.pending} onTaskSelect={setSelectedTask} getTaskMeta={renderTaskMeta} getTaskStatusLabel={getStatusLabel} />
                        </TabsContent>
                        <TabsContent value="overdue" className="mt-4">
                            <TaskList tasks={taskLists.overdue} onTaskSelect={setSelectedTask} getTaskMeta={renderTaskMeta} getTaskStatusLabel={getStatusLabel} />
                        </TabsContent>
                         <TabsContent value="awaiting_approval" className="mt-4">
                            <TaskList tasks={taskLists.awaiting_approval} onTaskSelect={setSelectedTask} getTaskMeta={renderTaskMeta} getTaskStatusLabel={getStatusLabel} />
                        </TabsContent>
                        <TabsContent value="completed" className="mt-4">
                            <TaskList tasks={taskLists.completed} onTaskSelect={setSelectedTask} getTaskMeta={renderTaskMeta} getTaskStatusLabel={getStatusLabel} />
                        </TabsContent>
                        <TabsContent value="all" className="mt-4">
                            <TaskList tasks={taskLists.all} onTaskSelect={setSelectedTask} getTaskMeta={renderTaskMeta} getTaskStatusLabel={getStatusLabel} />
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
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Subprojeto / quadro</label>
                            <Select value={draftSubprojectId} onValueChange={setDraftSubprojectId} disabled={!draftProjectId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione um subprojeto" />
                                </SelectTrigger>
                                <SelectContent>
                                    {subprojects
                                        .filter((subproject) => subproject.project_id === draftProjectId)
                                        .map((subproject) => (
                                            <SelectItem key={subproject.id} value={subproject.id}>
                                                {subproject.name}
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
                <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-5xl">
                    <DialogHeader>
                        <DialogTitle>Projetos, subprojetos e colunas</DialogTitle>
                        <DialogDescription>
                            Projeto é a definição macro. Subprojeto é o quadro/fluxo. Status são as colunas do subprojeto.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="rounded-xl border bg-muted/30 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-1">
                                <h3 className="text-sm font-semibold">Onde cada tarefa roda</h3>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                    Toda tarefa salva o campo técnico <span className="font-medium text-foreground">projectId</span>.
                                    Agora ela também pode salvar <span className="font-medium text-foreground">subprojectId</span>.
                                    Os fluxos automáticos definem projeto e subprojeto; nas tarefas manuais, o usuário escolhe.
                                </p>
                            </div>
                            <Badge variant="secondary" className="w-fit shrink-0">
                                Subprojeto = quadro
                            </Badge>
                        </div>

                        <div className="mt-4 grid gap-2 md:grid-cols-2">
                            {AUTOMATIC_PROJECT_RULES.map((item) => (
                                <div key={item.process} className="rounded-lg border bg-background/80 p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-medium">{item.process}</p>
                                        <Badge variant="outline">{item.project}</Badge>
                                    </div>
                                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.rule}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
                        <div className="space-y-4">
                            <div className="space-y-3 rounded-xl border p-4">
                                <div>
                                    <h3 className="font-medium">Criar projeto</h3>
                                    <p className="text-xs text-muted-foreground">
                                        Use para novos processos que terão tarefas próprias.
                                    </p>
                                </div>
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
                                <Button onClick={handleCreateProject} className="w-full sm:w-fit">
                                    Criar projeto
                                </Button>
                            </div>

                            <div className="space-y-3 rounded-xl border p-4">
                                <div>
                                    <h3 className="font-medium">Editar projeto</h3>
                                    <p className="text-xs text-muted-foreground">
                                        O nome/descrição organiza a central. Não altera automaticamente a origem das tarefas já criadas.
                                    </p>
                                </div>
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
                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <Button onClick={handleUpdateProject} disabled={!managerProjectId} className="sm:flex-1">
                                        Salvar projeto
                                    </Button>
                                    <Button variant="destructive" onClick={handleDeleteProject} disabled={!managerProjectId} className="sm:flex-1">
                                        Excluir projeto
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-3 rounded-xl border p-4">
                                <div>
                                    <h3 className="font-medium">Subprojetos / quadros</h3>
                                    <p className="text-xs text-muted-foreground">
                                        Aqui ficam os quadros do projeto macro. É no subprojeto que as colunas/status são definidas.
                                    </p>
                                </div>

                                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                                    <Input
                                        value={newSubprojectName}
                                        onChange={(event) => setNewSubprojectName(event.target.value)}
                                        placeholder="Nome do subprojeto"
                                        disabled={!managerProjectId}
                                    />
                                    <Button onClick={handleCreateSubproject} disabled={!managerProjectId}>
                                        Criar
                                    </Button>
                                </div>
                                <Textarea
                                    value={newSubprojectDescription}
                                    onChange={(event) => setNewSubprojectDescription(event.target.value)}
                                    placeholder="Descrição opcional do subprojeto"
                                    rows={2}
                                    disabled={!managerProjectId}
                                />

                                <Select value={managerSubprojectId} onValueChange={setManagerSubprojectId} disabled={!managerProjectId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione um subprojeto" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {selectedProjectSubprojects.map((subproject) => (
                                            <SelectItem key={subproject.id} value={subproject.id}>
                                                {subproject.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Input
                                    value={managerSubprojectName}
                                    onChange={(event) => setManagerSubprojectName(event.target.value)}
                                    placeholder="Nome do subprojeto"
                                    disabled={!managerSubprojectId}
                                />
                                <Textarea
                                    value={managerSubprojectDescription}
                                    onChange={(event) => setManagerSubprojectDescription(event.target.value)}
                                    placeholder="Descrição"
                                    rows={2}
                                    disabled={!managerSubprojectId}
                                />
                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <Button onClick={handleUpdateSubproject} disabled={!managerSubprojectId} className="sm:flex-1">
                                        Salvar subprojeto
                                    </Button>
                                    <Button variant="destructive" onClick={handleDeleteSubproject} disabled={!managerSubprojectId} className="sm:flex-1">
                                        Excluir subprojeto
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-3 rounded-xl border p-4">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <h3 className="font-medium">Criar coluna/status</h3>
                                        <p className="text-xs text-muted-foreground">
                                            A nova coluna será criada dentro do subprojeto selecionado.
                                        </p>
                                    </div>
                                    {managerSubprojectName ? (
                                        <Badge variant="outline" className="w-fit">
                                            {managerSubprojectName}
                                        </Badge>
                                    ) : null}
                                </div>
                                <Input
                                    value={newStatusName}
                                    onChange={(event) => setNewStatusName(event.target.value)}
                                    placeholder="Nome da coluna/status"
                                    disabled={!managerSubprojectId}
                                />
                                <Input
                                    value={newStatusSlug}
                                    onChange={(event) => setNewStatusSlug(event.target.value)}
                                    placeholder="Slug"
                                    disabled={!managerSubprojectId}
                                />
                                <Button onClick={handleCreateStatus} disabled={!managerSubprojectId} className="w-full sm:w-fit">
                                    Criar coluna
                                </Button>
                            </div>

                            <div className="space-y-3 rounded-xl border p-4">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <h3 className="font-medium">Colunas/status do subprojeto</h3>
                                        <p className="text-xs text-muted-foreground">
                                            Cada subprojeto pode ter seu próprio fluxo de colunas.
                                        </p>
                                    </div>
                                    <Badge variant="secondary" className="w-fit">
                                        {selectedSubprojectStatuses.length} status
                                    </Badge>
                                </div>
                                {!managerSubprojectId ? (
                                    <p className="text-sm text-muted-foreground">Selecione um subprojeto para gerenciar suas colunas/status.</p>
                                ) : selectedSubprojectStatuses.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">Nenhum status cadastrado neste subprojeto.</p>
                                ) : (
                                    <div className="space-y-3">
                                        {selectedSubprojectStatuses.map((status) => (
                                            <div key={status.id} className="space-y-2 rounded-lg border p-3">
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
                                                        <div className="flex flex-col gap-2 sm:flex-row">
                                                            <Button onClick={() => handleUpdateStatus(status)}>Salvar status</Button>
                                                            <Button variant="outline" onClick={() => setEditingStatusId(null)}>Cancelar</Button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                            <div className="min-w-0">
                                                                <p className="font-medium">{status.name}</p>
                                                                <div className="mt-1 flex flex-wrap gap-1.5">
                                                                    <Badge variant="outline">{status.slug}</Badge>
                                                                    <Badge variant="secondary">{status.category}</Badge>
                                                                    {status.is_initial ? <Badge variant="outline">Inicial</Badge> : null}
                                                                    {status.is_terminal ? <Badge variant="outline">Terminal</Badge> : null}
                                                                </div>
                                                            </div>
                                                            <div className="flex shrink-0 gap-2">
                                                                <Button variant="outline" size="sm" onClick={() => startEditStatus(status)}>
                                                                    Editar
                                                                </Button>
                                                                <Button variant="ghost" size="icon" onClick={() => handleDeleteStatus(status.id)} aria-label={`Excluir status ${status.name}`}>
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
