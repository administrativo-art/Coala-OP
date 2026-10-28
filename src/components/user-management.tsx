"use client"

import { useState, useEffect, useMemo, useRef, useCallback, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useForm, Controller, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@/lib/zod-resolver';
import * as z from 'zod';
import { differenceInDays, format } from 'date-fns';
import { Timestamp } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useProfiles } from '@/hooks/use-profiles';
import { useHrBootstrap } from '@/hooks/use-hr-bootstrap';
import { useDP } from '@/components/dp-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Edit, Shield, ChevronDown, Search, Eraser, Camera, Upload, KeyRound, Loader2, ArrowLeft, Download, CircleDot, UserX, CheckCircle2, MailCheck, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { type UnitAccessScope, type User } from '@/types';
import { normalizeUnitAccessScope } from '@/lib/unit-access';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ProfileManagementModal } from './profile-management-modal';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Switch } from './ui/switch';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';
import { JUST_CAUSE_TYPES, requiresTerminationSubtype } from '@/lib/hr/termination-options';
import {
  EMPLOYMENT_RELATIONSHIP_TYPES,
  employmentRelationshipLabel,
  resolveEmploymentRelationshipType,
  terminationCopyForRelationship,
  terminationReasonsForRelationship,
  type EmploymentTerminationReason,
} from '@/lib/hr/employment-relationship';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { PhotoCaptureModal } from './photo-capture-modal';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { storage } from '@/lib/firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { pickUserColor, getUserColor } from '@/lib/utils/user-colors';
import { createAuditLog } from '@/features/audit/client';
import { createManagedTerminationProcess } from '@/features/hr/termination/client';
import { MultiSelect } from '@/components/ui/multi-select';
import { Textarea } from '@/components/ui/textarea';
import { matchDPUnitForKiosk } from '@/lib/dp-kiosk-match';
import { shiftDefinitionMatchesUnit } from '@/lib/dp-shift-definitions';
import { formatPersonName } from '@/lib/person-name';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import {
  calculateVacationHealth,
  CYCLE_STATUS_CONFIG,
  getVacationCycleHistory,
} from '@/lib/utils/vacation-logic';
import { PageHeader } from '@/components/layout/page-header';
import { InfoPopover } from '@/components/ui/info-popover';

function getAvatarUploadErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === 'storage/unauthorized') {
    return 'Seu acesso não tem permissão para gravar o avatar deste usuário.';
  }
  return 'Tente novamente.';
}

function timestampToDateInput(ts: Timestamp | undefined): string {
  if (!ts) return '';
  try { return format(ts.toDate(), 'yyyy-MM-dd'); } catch { return ''; }
}

function parseDateInput(value?: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function fullYearsSince(date: Date, today = new Date()) {
  let years = today.getFullYear() - date.getFullYear();
  const anniversaryThisYear = new Date(today.getFullYear(), date.getMonth(), date.getDate());
  if (startOfLocalDay(today) < anniversaryThisYear) years -= 1;
  return Math.max(years, 0);
}

function formatTenure(date: Date, today = new Date()) {
  if (startOfLocalDay(date) > startOfLocalDay(today)) return 'Admissão futura';

  let totalMonths = (today.getFullYear() - date.getFullYear()) * 12 + today.getMonth() - date.getMonth();
  if (today.getDate() < date.getDate()) totalMonths -= 1;
  totalMonths = Math.max(totalMonths, 0);

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years === 0 && months === 0) return 'Menos de 1 mês';
  if (years === 0) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
  if (months === 0) return `${years} ${years === 1 ? 'ano' : 'anos'}`;
  return `${years} ${years === 1 ? 'ano' : 'anos'} e ${months} ${months === 1 ? 'mês' : 'meses'}`;
}

function nextAnniversary(date: Date, today = new Date()) {
  const todayStart = startOfLocalDay(today);
  let anniversary = new Date(today.getFullYear(), date.getMonth(), date.getDate());
  if (anniversary < todayStart) {
    anniversary = new Date(today.getFullYear() + 1, date.getMonth(), date.getDate());
  }
  return anniversary;
}

function daysUntil(date: Date, today = new Date()) {
  const diffMs = startOfLocalDay(date).getTime() - startOfLocalDay(today).getTime();
  return Math.max(Math.round(diffMs / 86400000), 0);
}

function formatAnniversary(date: Date, today = new Date()) {
  const days = daysUntil(date, today);
  if (days === 0) return `${format(date, 'dd/MM/yyyy')} (hoje)`;
  if (days === 1) return `${format(date, 'dd/MM/yyyy')} (amanhã)`;
  return `${format(date, 'dd/MM/yyyy')} (em ${days} dias)`;
}

function DerivedInfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-ds-md border border-ds-border bg-ds-muted p-3">
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-ds-ink-faint">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ds-ink">{value}</p>
    </div>
  );
}

function FieldHelpTooltip({ title, description }: { title: string; description: string }) {
  return (
    <InfoPopover title={title} contentClassName="w-[340px]">
      <p>{description}</p>
    </InfoPopover>
  );
}

function UserFormSection({
  title,
  description,
  help,
  compact,
  children,
}: {
  title: string;
  description?: string;
  help?: string;
  compact?: boolean;
  children: ReactNode;
}) {
  if (compact) return <div className="space-y-2">{children}</div>;

  return (
    <section data-ui="form-section" className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface shadow-xs">
      <header className="flex items-start justify-between gap-3 border-b border-ds-divider px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold tracking-tight text-ds-ink">{title}</h2>
          {description ? <p className="mt-1 text-sm text-ds-ink-muted">{description}</p> : null}
        </div>
        {help ? (
          <InfoPopover title={title} contentClassName="w-[360px]">
            <p>{help}</p>
          </InfoPopover>
        ) : null}
      </header>
      <div className="space-y-4 px-5 py-5">{children}</div>
    </section>
  );
}

type CollaboratorEditTab = 'identity' | 'journey' | 'units' | 'access';

const UNIT_ACCESS_SCOPE_NOTES: Record<UnitAccessScope, string> = {
  linked: 'Vê e opera só as unidades marcadas em "Unidades de escala e operação"; se a lotação mudar, o acesso muda junto.',
  selected: 'Vê e opera só as unidades escolhidas em "Unidades liberadas no escopo", mesmo onde não trabalha (ex.: supervisão).',
  all: 'Vê e opera todas as unidades. Reserve para gestão e administração.',
};

const COLLABORATOR_EDIT_TABS: Array<{ id: CollaboratorEditTab; label: string }> = [
  { id: 'identity', label: 'Identificação' },
  { id: 'journey', label: 'Cargo e jornada' },
  { id: 'units', label: 'Unidades' },
  { id: 'access', label: 'Acesso e rotinas' },
];

/** Abas que dependem do módulo DP; sem `dp.view` o drawer mostra só identificação e acesso. */
const DP_ONLY_EDIT_TABS = new Set<CollaboratorEditTab>(['journey', 'units']);

const COLLABORATOR_EDIT_FIELD_TAB: Partial<Record<keyof UserFormValues, CollaboratorEditTab>> = {
  username: 'identity',
  email: 'identity',
  avatarUrl: 'identity',
  employmentRelationshipType: 'identity',
  jobRoleId: 'journey',
  jobFunctionIds: 'journey',
  shiftDefinitionId: 'journey',
  admissionDate: 'journey',
  birthDate: 'journey',
  assignedKioskIds: 'units',
  unitId: 'units',
  responsibleUnitIds: 'units',
  unitAccessScope: 'units',
  unitAccessUnitIds: 'units',
  profileId: 'access',
  registrationIdBizneo: 'access',
  registrationIdPdv: 'access',
  operacional: 'access',
  participatesInGoals: 'access',
  needsTransportVoucher: 'access',
  transportVoucherValue: 'access',
};

type InactivationMode = 'temporary' | 'contract_termination';
type TransportVoucherStatus = 'none' | 'active' | 'suspended';
type TransportVoucherHistoryEntry = NonNullable<User['transportVoucherHistory']>[number];

function VacationSummaryCard({ user, admissionDate, vacations }: { user: User | null; admissionDate: Date | null; vacations: UserVacationRecord[] }) {
  if (!user) return null;

  const userVacations = vacations.filter((vacation) => vacation.userId === user.id && vacation.status !== 'REJECTED');
  const health = calculateVacationHealth(admissionDate ?? undefined, userVacations);
  const cycles = admissionDate ? getVacationCycleHistory(admissionDate, userVacations) : [];
  const openCycle = cycles.find((cycle) => cycle.status !== 'GOZADO' && cycle.status !== 'AQUISITIVO') ?? cycles.find((cycle) => cycle.status === 'AQUISITIVO');

  if (health.status === 'INVALIDO' || !openCycle) {
    return (
      <div className="rounded-ds-md border border-ds-border bg-ds-muted p-3">
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-ds-ink-faint">Férias</p>
        <p className="mt-1 text-sm font-semibold text-ds-ink">Informe a data de admissão</p>
      </div>
    );
  }

  const statusConfig = CYCLE_STATUS_CONFIG[openCycle.status];
  const progress = health.status === 'CONCESSIVO' || health.status === 'AQUISITIVO' ? Math.round(health.details.progress) : 0;
  const deadline = health.status === 'CONCESSIVO' ? health.details.deadline : openCycle.acquisitivePeriod.end;
  const daysToDeadline = differenceInDays(deadline, startOfLocalDay(new Date()));

  return (
    <div className="rounded-ds-md border border-ds-border bg-ds-muted p-3 md:col-span-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wide text-ds-ink-faint">Férias</p>
          <p className="mt-1 text-sm font-semibold text-ds-ink">
            {openCycle.balance} dias de saldo · ciclo {openCycle.id}
          </p>
        </div>
        <span className={cn('rounded-md px-2 py-1 text-[11px] font-semibold', statusConfig.bg, statusConfig.text)}>
          {statusConfig.label}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-ds-divider">
        <div className="h-full rounded-full bg-ds-accent" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-ds-ink-muted">
        <span>Usados: {openCycle.takenDays}d</span>
        <span>Prazo: {format(deadline, 'dd/MM/yyyy')}</span>
        <span>{daysToDeadline >= 0 ? `${daysToDeadline} dias restantes` : `${Math.abs(daysToDeadline)} dias vencido`}</span>
      </div>
    </div>
  );
}

type UserVacationRecord = Parameters<typeof calculateVacationHealth>[1][number];

function getTransportVoucherStatus(needsTransportVoucher: boolean | undefined, history?: User['transportVoucherHistory']): TransportVoucherStatus {
  if (needsTransportVoucher) return 'active';
  return history && history.length > 0 ? 'suspended' : 'none';
}

function transportVoucherStatusLabel(status: TransportVoucherStatus) {
  if (status === 'active') return 'Ativo';
  if (status === 'suspended') return 'Suspenso';
  return 'Sem histórico';
}

function formatTransportVoucherAction(entry: TransportVoucherHistoryEntry) {
  if (entry.toStatus === 'suspended') return 'Suspenso';
  return entry.fromStatus === 'suspended' ? 'Reativado' : 'Solicitado';
}

function nextTransportVoucherActionLabel(status: TransportVoucherStatus) {
  if (status === 'active') return 'Suspender';
  if (status === 'suspended') return 'Reativar';
  return 'Solicitar';
}

function transportVoucherActionClass(entry: TransportVoucherHistoryEntry) {
  if (entry.toStatus === 'suspended') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (entry.fromStatus === 'suspended') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-sky-200 bg-sky-50 text-sky-700';
}

function newLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}


const userSchema = z.object({
  username: z.string().trim().min(3, 'O nome de usuário deve ter pelo menos 3 caracteres.'),
  email: z.string().email("O e-mail é inválido."),
  profileId: z.string({ required_error: 'É obrigatório selecionar um perfil.' }).min(1, 'O perfil é obrigatório.'),
  unitId: z.string().optional(),
  assignedKioskIds: z.array(z.string()),
  avatarUrl: z.string().optional(),
  operacional: z.boolean().optional(),
  participatesInGoals: z.boolean().optional(),
  // Departamento Pessoal
  registrationIdBizneo: z.string().optional(),
  registrationIdPdv: z.string().optional(),
  jobRoleId: z.string().optional(),
  jobFunctionIds: z.array(z.string()).optional(),
  employmentRelationshipType: z.enum(['clt', 'apprenticeship', 'pj', 'internship', 'partner'], {
    required_error: 'Selecione o tipo de vínculo.',
  }),
  responsibleUnitIds: z.array(z.string()).optional(),
  unitAccessScope: z.enum(['linked', 'selected', 'all']).default('linked'),
  unitAccessUnitIds: z.array(z.string()).optional(),
  admissionDate: z.string().optional(),
  birthDate: z.string().optional(),
  shiftDefinitionId: z.string().optional(),
  needsTransportVoucher: z.boolean().optional(),
  transportVoucherValue: z.coerce.number().nonnegative().optional(),
}).refine(data => {
    // Quiosque obrigatório apenas para não-admins
    if (data.profileId === 'admin') return true;
    return data.assignedKioskIds.length > 0;
}, {
    message: 'Selecione pelo menos um quiosque.',
    path: ['assignedKioskIds'],
}).refine(data => data.profileId === 'admin' || Boolean(data.unitId), {
    message: 'Selecione a unidade principal do financeiro.',
    path: ['unitId'],
}).refine(data => data.unitAccessScope !== 'selected' || (data.unitAccessUnitIds?.length ?? 0) > 0, {
    message: 'Selecione ao menos uma unidade para o escopo específico.',
    path: ['unitAccessUnitIds'],
});

type UserFormValues = z.infer<typeof userSchema>;

function firstUserFormError(errors: FieldErrors<UserFormValues>) {
  for (const error of Object.values(errors)) {
    if (error && typeof error.message === 'string') return error.message;
  }
  return 'Revise os campos obrigatórios destacados antes de salvar.';
}

const USER_AUDIT_FIELDS = [
  'username',
  'profileId',
  'unitId',
  'unitIds',
  'assignedKioskIds',
  'operacional',
  'participatesInGoals',
  'registrationIdBizneo',
  'registrationIdPdv',
  'jobRoleId',
  'jobRoleName',
  'jobFunctionIds',
  'jobFunctionNames',
  'employmentRelationshipType',
  'responsibleUnitIds',
  'unitAccessScope',
  'unitAccessUnitIds',
  'admissionDate',
  'birthDate',
  'shiftDefinitionId',
  'needsTransportVoucher',
  'transportVoucherValue',
  'transportVoucherHistory',
  'loginRestrictionEnabled',
] as const;

function auditValue(value: unknown): unknown {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return [...value].sort();
  return value ?? null;
}

function userAuditDiff(before: User, after: Partial<User>) {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  USER_AUDIT_FIELDS.forEach((field) => {
    const beforeValue = auditValue((before as any)[field]);
    const afterValue = auditValue((after as any)[field]);
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes[field] = { before: beforeValue, after: afterValue };
    }
  });
  return changes;
}

type UserManagementProps = {
  createOnly?: boolean;
  editUserId?: string;
  onClose?: (reason?: 'cancel' | 'saved') => void;
  onDirtyChange?: (dirty: boolean) => void;
  presentation?: 'page' | 'drawer';
  contextLabel?: string;
  showTransportVoucher?: boolean;
};

export function UserManagement({
  createOnly = false,
  editUserId,
  onClose,
  onDirtyChange,
  presentation = 'page',
  contextLabel = 'Gestão do colaborador',
  showTransportVoucher = false,
}: UserManagementProps = {}) {
  const { permissions, users, addUser, terminateUser, user: currentUser, firebaseUser, updateUser, resetPassword, loading: authLoading } = useAuth();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { profiles, adminProfileId, loading: profilesLoading } = useProfiles();
  const { roles, functions, units, loading: hrLoading } = useHrBootstrap();
  const { shiftDefinitions, shiftDefsLoading, vacations } = useDP();
  const { toast } = useToast();
  
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showForm, setShowForm] = useState(createOnly || Boolean(editUserId));
  const [activeEditTab, setActiveEditTab] = useState<CollaboratorEditTab>('identity');
  const [userToInactivate, setUserToInactivate] = useState<User | null>(null);
  const [userToResetPassword, setUserToResetPassword] = useState<User | null>(null);
  const [inactivationMode, setInactivationMode] = useState<InactivationMode>('temporary');
  const [terminationDate, setTerminationDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [terminationEmployerUnitId, setTerminationEmployerUnitId] = useState('');
  const [terminationReason, setTerminationReason] = useState('');
  const [terminationCause, setTerminationCause] = useState('');
  const [terminationNotes, setTerminationNotes] = useState('');
  const [transportVoucherDialog, setTransportVoucherDialog] = useState<{
    fromStatus: TransportVoucherStatus;
    toStatus: 'active' | 'suspended';
  } | null>(null);
  const [transportVoucherEffectiveDate, setTransportVoucherEffectiveDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [transportVoucherReason, setTransportVoucherReason] = useState('');
  const [transportVoucherValueDraft, setTransportVoucherValueDraft] = useState('');
  const [pendingTransportVoucherHistory, setPendingTransportVoucherHistory] = useState<TransportVoucherHistoryEntry[]>([]);
  const [isProfilesModalOpen, setIsProfilesModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [profileFilter, setProfileFilter] = useState('all');
  const [kioskFilter, setKioskFilter] = useState('all');
  const [createdUserNotice, setCreatedUserNotice] = useState<{
    username: string;
    email: string;
    emailSent: boolean;
  } | null>(null);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [pdvOperatorIds, setPdvOperatorIds] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initializedEditUserIdRef = useRef<string | null>(null);

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: {
        username: '',
        email: '',
        profileId: '',
        unitId: '',
        assignedKioskIds: [],
        avatarUrl: '',
        operacional: false,
        participatesInGoals: false,
        registrationIdBizneo: '',
        registrationIdPdv: '',
        jobRoleId: '',
        jobFunctionIds: [],
        employmentRelationshipType: undefined,
        responsibleUnitIds: [],
        unitAccessScope: 'linked',
        unitAccessUnitIds: [],
        admissionDate: '',
        birthDate: '',
        shiftDefinitionId: '',
        needsTransportVoucher: false,
        transportVoucherValue: undefined,
    }
  });

  const isDrawer = presentation === 'drawer' && !createOnly;

  const visibleEditTabs = permissions.dp?.view
    ? COLLABORATOR_EDIT_TABS
    : COLLABORATOR_EDIT_TABS.filter((tab) => !DP_ONLY_EDIT_TABS.has(tab.id));
  // Ler errors/dirtyFields aqui inscreve o render nas mudanças; o ponto na aba evita salvar sem ver o que mudou em outra aba.
  const editTabStatus = (tab: CollaboratorEditTab): 'error' | 'changed' | null => {
    const inTab = (field: string) => COLLABORATOR_EDIT_FIELD_TAB[field as keyof UserFormValues] === tab;
    if (Object.keys(form.formState.errors).some(inTab)) return 'error';
    if (Object.keys(form.formState.dirtyFields).some(inTab)) return 'changed';
    return null;
  };

  const handleEditTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % visibleEditTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + visibleEditTabs.length) % visibleEditTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = visibleEditTabs.length - 1;
    else return;

    event.preventDefault();
    const nextTab = visibleEditTabs[nextIndex];
    setActiveEditTab(nextTab.id);
    window.requestAnimationFrame(() => document.getElementById(`collaborator-edit-tab-${nextTab.id}`)?.focus());
  };

  useEffect(() => {
    onDirtyChange?.(form.formState.isDirty);
  }, [form.formState.isDirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const selectedRoleId = form.watch('jobRoleId') ?? '';
  const selectedFunctionIds = form.watch('jobFunctionIds') ?? [];
  const selectedProfileId = form.watch('profileId') ?? '';
  const selectedKioskIds = form.watch('assignedKioskIds') ?? [];
  const selectedUnitAccessScope = form.watch('unitAccessScope') ?? 'linked';
  const admissionDateValue = form.watch('admissionDate');
  const birthDateValue = form.watch('birthDate');
  const needsTransportVoucherValue = form.watch('needsTransportVoucher');
  const transportVoucherValue = form.watch('transportVoucherValue');
  const hasBizneoLink = !!form.watch('registrationIdBizneo');
  const transportVoucherHistory = useMemo(
    () => [...(editingUser?.transportVoucherHistory ?? []), ...pendingTransportVoucherHistory],
    [editingUser?.transportVoucherHistory, pendingTransportVoucherHistory]
  );
  const currentTransportVoucherStatus = getTransportVoucherStatus(needsTransportVoucherValue, transportVoucherHistory);
  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) ?? null,
    [roles, selectedRoleId]
  );
  const roleOptions = useMemo(
    () => roles.map((role) => ({ value: role.id, label: role.name })),
    [roles]
  );
  const dpDateSummary = useMemo(() => {
    const admissionDate = parseDateInput(admissionDateValue);
    const birthDate = parseDateInput(birthDateValue);

    const companyAnniversary = admissionDate ? nextAnniversary(admissionDate) : null;
    const birthday = birthDate ? nextAnniversary(birthDate) : null;

    return {
      tenure: admissionDate ? formatTenure(admissionDate) : 'Informe a admissao',
      age: birthDate ? `${fullYearsSince(birthDate)} anos` : 'Informe o nascimento',
      companyAnniversary: companyAnniversary ? formatAnniversary(companyAnniversary) : 'Informe a admissao',
      birthday: birthday ? formatAnniversary(birthday) : 'Informe o nascimento',
    };
  }, [admissionDateValue, birthDateValue]);
  const compatibleFunctions = useMemo(() => {
    if (!selectedRoleId) return [];
    return functions.filter((item) => {
      const compatibleRoleIds = item.compatibleRoleIds ?? [];
      return compatibleRoleIds.length === 0 || compatibleRoleIds.includes(selectedRoleId);
    });
  }, [functions, selectedRoleId]);
  const selectedFunctions = useMemo(
    () => functions.filter((item) => selectedFunctionIds.includes(item.id)),
    [functions, selectedFunctionIds]
  );
  const compatibleFunctionOptions = useMemo(
    () => compatibleFunctions.map((item) => ({ value: item.id, label: item.name })),
    [compatibleFunctions]
  );
  const responsibleUnitOptions = useMemo(
    () => units.map((unit) => ({ value: unit.id, label: unit.name })),
    [units]
  );
  const selectedTerminationRelationship = userToInactivate?.employmentRelationshipType;
  const availableTerminationReasons = terminationReasonsForRelationship(selectedTerminationRelationship)
    .filter((reason) => selectedTerminationRelationship !== 'pj' || reason === 'Encerramento por acordo entre as partes');
  const terminationCopy = terminationCopyForRelationship(selectedTerminationRelationship);
  const contractTerminationAvailable = selectedTerminationRelationship === 'clt' || selectedTerminationRelationship === 'pj';
  const selectedWorkUnits = useMemo(() => {
    const mapped = new Map<string, { id: string; name: string }>();

    selectedKioskIds.forEach((kioskId) => {
      const kiosk = kiosks.find((item) => item.id === kioskId);
      const unit = kiosk ? matchDPUnitForKiosk(kiosk.name, units) : undefined;
      if (unit) mapped.set(unit.id, { id: unit.id, name: unit.name });
    });

    return Array.from(mapped.values());
  }, [kiosks, selectedKioskIds, units]);
  const selectedWorkUnitIds = useMemo(
    () => selectedWorkUnits.map((unit) => unit.id),
    [selectedWorkUnits]
  );
  useEffect(() => {
    const currentPrimaryUnitId = form.getValues('unitId');
    if (currentPrimaryUnitId && selectedWorkUnitIds.includes(currentPrimaryUnitId)) return;
    form.setValue('unitId', selectedWorkUnitIds[0] ?? '', {
      shouldDirty: Boolean(currentPrimaryUnitId),
      shouldValidate: false,
    });
  }, [form, selectedWorkUnitIds]);
  const filteredShiftDefinitions = useMemo(() => {
    if (selectedKioskIds.length === 0) return shiftDefinitions;
    if (selectedWorkUnitIds.length === 0) return [];

    return shiftDefinitions.filter((definition) =>
      selectedWorkUnitIds.some((unitId) => shiftDefinitionMatchesUnit(definition, unitId))
    );
  }, [selectedKioskIds.length, selectedWorkUnitIds, shiftDefinitions]);
  const shiftDefinitionHint = useMemo(() => {
    if (selectedKioskIds.length === 0) {
      return 'Selecione um quiosque para filtrar os turnos pela unidade.';
    }

    if (selectedWorkUnits.length === 0) {
      return 'Nenhuma unidade DP foi encontrada para o quiosque selecionado.';
    }

    const unitNames = selectedWorkUnits.map((unit) => unit.name).join(', ');
    if (filteredShiftDefinitions.length === 0) {
      return `Nenhum turno cadastrado para ${unitNames}.`;
    }

    return `Exibindo turnos de ${unitNames}.`;
  }, [filteredShiftDefinitions.length, selectedKioskIds.length, selectedWorkUnits]);
  const effectiveDefaultProfileId = useMemo(
    () =>
      selectedFunctions.find((item) => item.defaultProfileId)?.defaultProfileId ??
      selectedRole?.defaultProfileId ??
      '',
    [selectedFunctions, selectedRole]
  );
  const effectiveDefaultProfileName = useMemo(
    () => profiles.find((profile) => profile.id === effectiveDefaultProfileId)?.name,
    [effectiveDefaultProfileId, profiles]
  );
  const selectedProfileName = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId)?.name,
    [selectedProfileId, profiles]
  );

  useEffect(() => {
    // Sem o catálogo do RH, a lista de compatíveis está vazia e apagaria a função já gravada.
    if (hrLoading) return;
    const allowedFunctionIds = new Set(compatibleFunctions.map((item) => item.id));
    const nextValue = selectedFunctionIds.filter((id) => allowedFunctionIds.has(id)).slice(0, 1);
    if (nextValue.length !== selectedFunctionIds.length) {
      form.setValue('jobFunctionIds', nextValue, { shouldDirty: true });
    }
  }, [compatibleFunctions, form, hrLoading, selectedFunctionIds]);

  useEffect(() => {
    if (!effectiveDefaultProfileId) return;
    const isProtectedUser = editingUser?.username === 'Tiago Brasil' || editingUser?.email === 'administrativo@coalas.com';
    if (isProtectedUser) return;
    if (form.getValues('profileId') !== effectiveDefaultProfileId) {
      form.setValue('profileId', effectiveDefaultProfileId, { shouldDirty: true });
    }
  }, [effectiveDefaultProfileId, editingUser, form]);

  useEffect(() => {
    if (!createOnly || !showForm || editingUser) return;

    const clearAutofill = () => {
      form.setValue('username', '', { shouldDirty: false, shouldTouch: false, shouldValidate: false });
      form.setValue('email', '', { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    };

    clearAutofill();
    const timeout = window.setTimeout(clearAutofill, 200);
    return () => window.clearTimeout(timeout);
  }, [createOnly, editingUser, form, showForm]);

  useEffect(() => {
    const currentShiftDefinitionId = form.getValues('shiftDefinitionId');
    if (!currentShiftDefinitionId || selectedKioskIds.length === 0) return;

    const stillAvailable = filteredShiftDefinitions.some(
      (definition) => definition.id === currentShiftDefinitionId
    );

    if (!stillAvailable) {
      form.setValue('shiftDefinitionId', '', { shouldDirty: true });
    }
  }, [filteredShiftDefinitions, form, selectedKioskIds.length]);

  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      // Inativos têm tela própria (/dashboard/users/inactive); não aparecem aqui.
      if (user.isActive === false) return false;
      const term = searchTerm.toLowerCase();
      const searchMatch =
        user.username.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term) ||
        (user.jobRoleName ?? '').toLowerCase().includes(term);
      const profileMatch = profileFilter === 'all' || user.profileId === profileFilter;
      const kioskMatch = kioskFilter === 'all' || user.assignedKioskIds.includes(kioskFilter);
      return searchMatch && profileMatch && kioskMatch;
    });
  }, [users, searchTerm, profileFilter, kioskFilter]);

  // Group users by profile, ordered: admin → gestor/gerente → líder → others
  const groupedUsers = useMemo(() => {
    const profileOrder = (profileId: string, name: string) => {
      if (profileId === adminProfileId) return 0;
      const n = name.toLowerCase();
      if (n.includes('gestor') || n.includes('gerente')) return 1;
      if (n.includes('líder') || n.includes('lider')) return 2;
      return 3;
    };

    const map = new Map<string, { profileId: string; profileName: string; order: number; users: User[] }>();
    filteredUsers.forEach(user => {
      const profileName = profiles.find(p => p.id === user.profileId)?.name ?? 'Sem perfil';
      if (!map.has(user.profileId)) {
        map.set(user.profileId, {
          profileId: user.profileId,
          profileName,
          order: profileOrder(user.profileId, profileName),
          users: [],
        });
      }
      map.get(user.profileId)!.users.push(user);
    });

    return [...map.values()].sort((a, b) => a.order - b.order || a.profileName.localeCompare(b.profileName));
  }, [filteredUsers, profiles, adminProfileId]);


  const closeForm = (reason: 'cancel' | 'saved' = 'cancel') => {
    if (!isDrawer || reason === 'saved') {
      setShowForm(false);
      setEditingUser(null);
      setPendingTransportVoucherHistory([]);
    }
    if (createOnly || editUserId) onClose?.(reason);
  };

  const handleAddNew = () => {
    setEditingUser(null);
    form.reset({
      username: '',
      email: '',
      profileId: '',
      unitId: '',
      assignedKioskIds: [],
      avatarUrl: '',
      operacional: false,
      participatesInGoals: false,
      registrationIdBizneo: '',
      registrationIdPdv: '',
      jobRoleId: '',
      jobFunctionIds: [],
      employmentRelationshipType: undefined,
      responsibleUnitIds: [],
      unitAccessScope: 'linked',
      unitAccessUnitIds: [],
      admissionDate: '',
      birthDate: '',
      shiftDefinitionId: '',
      needsTransportVoucher: false,
      transportVoucherValue: undefined,
    });
    setPdvOperatorIds({});
    setPendingTransportVoucherHistory([]);
    setShowForm(true);
  };

  const handleEdit = useCallback((user: User) => {
    setEditingUser(user);
    form.reset({
      username: user.username,
      email: user.email,
      profileId: user.profileId,
      unitId: user.unitId ?? user.unitIds?.[0] ?? '',
      assignedKioskIds: Array.from(new Set([
        ...(user.assignedKioskIds ?? []).filter((id) => kiosks.some((kiosk) => kiosk.id === id)),
        ...kiosks
          .filter((kiosk) => {
            const unit = matchDPUnitForKiosk(kiosk.name, units);
            return unit ? (user.unitIds ?? []).includes(unit.id) : false;
          })
          .map((kiosk) => kiosk.id),
      ])),
      avatarUrl: user.avatarUrl || '',
      operacional: user.operacional || false,
      participatesInGoals: user.participatesInGoals || false,
      registrationIdBizneo: user.registrationIdBizneo ?? '',
      registrationIdPdv: user.registrationIdPdv ?? '',
      jobRoleId: user.jobRoleId ?? '',
      jobFunctionIds: user.jobFunctionIds ?? [],
      employmentRelationshipType: resolveEmploymentRelationshipType(
        user.employmentRelationshipType,
        user.personRecordType,
      ),
      responsibleUnitIds: user.responsibleUnitIds ?? [],
      unitAccessScope: user.unitAccessScope ?? 'linked',
      unitAccessUnitIds: (user.unitAccessUnitIds ?? []).filter((id) => units.some((unit) => unit.id === id)),
      admissionDate: timestampToDateInput(user.admissionDate),
      birthDate: timestampToDateInput(user.birthDate),
      shiftDefinitionId: user.shiftDefinitionId ?? '',
      needsTransportVoucher: user.needsTransportVoucher ?? false,
      transportVoucherValue: user.transportVoucherValue,
    });
    const existing: Record<string, string> = {};
    Object.entries(user.pdvOperatorIds ?? {}).forEach(([k, v]) => { existing[k] = String(v); });
    setPdvOperatorIds(existing);
    setPendingTransportVoucherHistory([]);
    setActiveEditTab('identity');
    setShowForm(true);
  }, [form, kiosks, units]);

  useEffect(() => {
    if (!editUserId || initializedEditUserIdRef.current === editUserId) return;
    // O reset filtra quiosques e unidades pelos catálogos; inicializar antes deles descarta vínculos gravados.
    if (hrLoading || kiosksLoading) return;
    const target = users.find((user) => user.id === editUserId);
    if (!target) return;
    initializedEditUserIdRef.current = editUserId;
    handleEdit(target);
  }, [editUserId, handleEdit, hrLoading, kiosksLoading, users]);

  const openTransportVoucherChangeDialog = (nextChecked: boolean) => {
    const fromStatus = getTransportVoucherStatus(form.getValues('needsTransportVoucher'), transportVoucherHistory);
    const toStatus = nextChecked ? 'active' : 'suspended';
    if ((toStatus === 'active' && fromStatus === 'active') || (toStatus === 'suspended' && fromStatus !== 'active')) {
      form.setValue('needsTransportVoucher', nextChecked, { shouldDirty: true });
      return;
    }
    setTransportVoucherDialog({ fromStatus, toStatus });
    setTransportVoucherEffectiveDate(format(new Date(), 'yyyy-MM-dd'));
    setTransportVoucherReason(toStatus === 'active' ? 'Solicitação de adesão ao vale-transporte.' : 'Solicitação de suspensão do vale-transporte.');
    setTransportVoucherValueDraft(
      toStatus === 'active' && transportVoucherValue !== undefined && transportVoucherValue !== null
        ? String(transportVoucherValue)
        : ''
    );
  };

  const confirmTransportVoucherChange = () => {
    if (!transportVoucherDialog) return;
    const effectiveDate = transportVoucherEffectiveDate || format(new Date(), 'yyyy-MM-dd');
    const parsedValue = transportVoucherValueDraft === '' ? undefined : Number(transportVoucherValueDraft);
    const entry: TransportVoucherHistoryEntry = {
      id: newLocalId('vt'),
      fromStatus: transportVoucherDialog.fromStatus,
      toStatus: transportVoucherDialog.toStatus,
      effectiveDate,
      reason: transportVoucherReason.trim() || (transportVoucherDialog.toStatus === 'active' ? 'Adesão ao vale-transporte.' : 'Suspensão do vale-transporte.'),
      value: transportVoucherDialog.toStatus === 'active' ? parsedValue : undefined,
      changedAt: new Date().toISOString(),
      changedBy: currentUser ? { userId: currentUser.id, username: currentUser.username } : undefined,
    };
    setPendingTransportVoucherHistory((prev) => [...prev, entry]);
    form.setValue('needsTransportVoucher', transportVoucherDialog.toStatus === 'active', { shouldDirty: true });
    if (transportVoucherDialog.toStatus === 'active') {
      form.setValue('transportVoucherValue', parsedValue, { shouldDirty: true });
    } else {
      form.setValue('transportVoucherValue', undefined, { shouldDirty: true });
    }
    setTransportVoucherDialog(null);
  };

  const logUserAudit = async (
    action: string,
    target: Pick<User, 'id' | 'username' | 'email'> | null,
    metadata: Record<string, unknown> = {}
  ) => {
    if (!firebaseUser) return;
    try {
      await createAuditLog(firebaseUser, {
        module: 'settings.users',
        action,
        targetType: 'user',
        targetId: target?.id,
        targetName: target?.username ?? target?.email,
        metadata,
      });
    } catch (error) {
      console.warn('[UserManagement] Falha ao registrar auditoria.', error);
    }
  };
  
  const profileIsAdmin = (profileId: string) => profileId === adminProfileId;
  const handleInactivateClick = (user: User) => {
    if (user.id === currentUser?.id || profileIsAdmin(user.profileId) || user.isActive === false) return;
    setInactivationMode('temporary');
    setTerminationDate(format(new Date(), 'yyyy-MM-dd'));
    setTerminationEmployerUnitId(
      units.some((unit) => unit.id === user.employerUnitId && CnpjValidator.validate(unit.cnpj ?? '').valid)
        ? user.employerUnitId ?? ''
        : units.find((unit) => CnpjValidator.clean(unit.cnpj ?? '') === CnpjValidator.clean(user.employerCnpj ?? '') && CnpjValidator.validate(unit.cnpj ?? '').valid)?.id ?? '',
    );
    setTerminationReason('');
    setTerminationCause('');
    setTerminationNotes('');
    setUserToInactivate(user);
  };

  const handleInactivateConfirm = async () => {
    if (userToInactivate) {
      if (inactivationMode === 'contract_termination' && !contractTerminationAvailable) {
        const isSpecialEmploymentContract = userToInactivate.employmentRelationshipType === 'internship'
          || userToInactivate.employmentRelationshipType === 'apprenticeship'
          || userToInactivate.employmentRelationshipType === 'partner';
        toast({
          title: isSpecialEmploymentContract ? `${terminationCopy.action} ainda não disponível.` : 'Tipo de vínculo obrigatório.',
          description: isSpecialEmploymentContract
            ? 'Nesta entrega, o encerramento específico deste vínculo ainda não foi habilitado.'
            : 'Defina o tipo de vínculo no cadastro antes de registrar o encerramento.',
          variant: 'destructive',
        });
        return;
      }
      if (inactivationMode === 'contract_termination' && !terminationReason) {
        toast({ title: `${terminationCopy.reasonLabel} obrigatório.`, description: terminationCopy.missingReason, variant: 'destructive' });
        return;
      }
      if (inactivationMode === 'contract_termination' && !terminationEmployerUnitId) {
        toast({ title: 'CNPJ empregador obrigatório.', description: 'Selecione a empresa responsável pelo vínculo.', variant: 'destructive' });
        return;
      }
      if (
        inactivationMode === 'contract_termination' &&
        !availableTerminationReasons.some((reason) => reason === terminationReason)
      ) {
        toast({ title: 'Motivo incompatível com o vínculo.', description: 'Selecione uma opção válida para o tipo de vínculo cadastrado.', variant: 'destructive' });
        return;
      }
      if (inactivationMode === 'contract_termination') {
        if (!firebaseUser || !terminationReason) return;
        const result = await createManagedTerminationProcess(firebaseUser, {
          employeeId: userToInactivate.id,
          employerUnitId: terminationEmployerUnitId,
          terminationDate,
          terminationReason: terminationReason as EmploymentTerminationReason,
          terminationCause: requiresTerminationSubtype(terminationReason) ? terminationCause : undefined,
          terminationNotes: terminationNotes || undefined,
        });
        setUserToInactivate(null);
        toast({
          title: result.reused ? 'Processo de desligamento já existente.' : terminationCopy.success,
          description: `${userToInactivate.username} permanecerá ativo até a conclusão formal.`,
        });
        window.location.assign(`/dashboard/dp/terminations/${result.process.id}`);
        return;
      }
      await terminateUser({
        uid: userToInactivate.id,
        inactivationType: 'temporary',
        terminationNotes: terminationNotes || 'Inativação temporária pela tela de usuários.',
      });
      await logUserAudit('user_inactivated', userToInactivate, {
        email: userToInactivate.email,
        profile_id: userToInactivate.profileId,
        inactivation_type: inactivationMode,
        employment_relationship_type: userToInactivate.employmentRelationshipType ?? null,
        termination_reason: terminationReason || null,
      });
      setUserToInactivate(null);
      toast({
        title: inactivationMode === 'temporary' ? 'Usuário inativado temporariamente.' : terminationCopy.success,
        description: `${userToInactivate.username} não poderá acessar o sistema até uma reativação.`,
      });
    }
  };
  
  const handleResetPasswordConfirm = async () => {
    if (userToResetPassword) {
      const success = await resetPassword(userToResetPassword.email);
      if (success) {
        await logUserAudit('password_reset_email_sent', userToResetPassword, {
          email: userToResetPassword.email,
          source: 'settings_users',
        });
        toast({
          title: "E-mail de redefinição enviado!",
          description: `Um link para redefinir a senha foi enviado para ${userToResetPassword.email}.`
        });
      } else {
        toast({
          variant: "destructive",
          title: "Falha no envio",
          description: "Não foi possível enviar o e-mail de redefinição de senha."
        });
      }
      setUserToResetPassword(null);
    }
  };

  const saveUser = async (values: UserFormValues) => {
    values = { ...values, username: formatPersonName(values.username) };
    const avatarUrl = values.avatarUrl || '';
    const admissionDate = values.admissionDate
      ? Timestamp.fromDate(new Date(values.admissionDate + 'T12:00:00'))
      : undefined;
    const birthDate = values.birthDate
      ? Timestamp.fromDate(new Date(values.birthDate + 'T12:00:00'))
      : undefined;
    const expandedUnitAccessUnitIds = values.unitAccessScope === 'selected'
      ? Array.from(new Set([
          ...(values.unitAccessUnitIds ?? []),
          ...kiosks.flatMap((kiosk) => {
            const unit = matchDPUnitForKiosk(kiosk.name, units);
            return unit && values.unitAccessUnitIds?.includes(unit.id) ? [kiosk.id] : [];
          }),
        ]))
      : [];

    if (editingUser) {
      const updatedData: Partial<User> = {
          ...values,
          avatarUrl,
          pdvOperatorIds: Object.fromEntries(
            Object.entries(pdvOperatorIds).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])
          ),
          registrationIdBizneo: values.registrationIdBizneo || undefined,
          registrationIdPdv: values.registrationIdPdv || undefined,
          jobRoleId: selectedRole?.id,
          jobRoleName: selectedRole?.name,
          jobFunctionIds: selectedFunctions.length > 0 ? selectedFunctions.map((item) => item.id) : undefined,
          jobFunctionNames: selectedFunctions.length > 0 ? selectedFunctions.map((item) => item.name) : undefined,
          employmentRelationshipType: values.employmentRelationshipType,
          unitId: values.unitId || selectedWorkUnitIds[0],
          responsibleUnitIds: values.responsibleUnitIds && values.responsibleUnitIds.length > 0 ? values.responsibleUnitIds : undefined,
          unitAccessScope: values.unitAccessScope,
          unitAccessUnitIds: expandedUnitAccessUnitIds,
          unitIds: selectedWorkUnitIds.length > 0
            ? [values.unitId || selectedWorkUnitIds[0], ...selectedWorkUnitIds.filter((unitId) => unitId !== (values.unitId || selectedWorkUnitIds[0]))]
            : undefined,
          admissionDate,
          birthDate,
          shiftDefinitionId: values.shiftDefinitionId || undefined,
          needsTransportVoucher: values.needsTransportVoucher,
          transportVoucherValue: values.needsTransportVoucher ? values.transportVoucherValue : undefined,
          transportVoucherHistory,
      };
      const mergedUser = { ...editingUser, ...updatedData };
      const changes = userAuditDiff(editingUser, mergedUser);
      await updateUser(mergedUser);
      await logUserAudit('user_updated', editingUser, {
        email: editingUser.email,
        changed_fields: Object.keys(changes),
        changes,
      });
    } else {
      const createResult = await addUser({
          username: values.username,
          profileId: values.profileId,
          assignedKioskIds: values.assignedKioskIds,
          avatarUrl: avatarUrl,
          color: pickUserColor(users.map(u => u.color)),
          operacional: values.operacional,
          participatesInGoals: values.participatesInGoals,
          pdvOperatorIds: Object.fromEntries(
            Object.entries(pdvOperatorIds).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])
          ),
          shiftDefinitionId: values.shiftDefinitionId || undefined,
          needsTransportVoucher: values.needsTransportVoucher,
          transportVoucherValue: values.needsTransportVoucher ? values.transportVoucherValue : undefined,
          transportVoucherHistory: pendingTransportVoucherHistory.length > 0 ? pendingTransportVoucherHistory : undefined,
          registrationIdBizneo: values.registrationIdBizneo || undefined,
          registrationIdPdv: values.registrationIdPdv || undefined,
          jobRoleId: selectedRole?.id,
          jobRoleName: selectedRole?.name,
          jobFunctionIds: selectedFunctions.length > 0 ? selectedFunctions.map((item) => item.id) : undefined,
          jobFunctionNames: selectedFunctions.length > 0 ? selectedFunctions.map((item) => item.name) : undefined,
          employmentRelationshipType: values.employmentRelationshipType,
          unitId: values.unitId || selectedWorkUnitIds[0],
          responsibleUnitIds: values.responsibleUnitIds && values.responsibleUnitIds.length > 0 ? values.responsibleUnitIds : undefined,
          unitAccessScope: values.unitAccessScope,
          unitAccessUnitIds: expandedUnitAccessUnitIds,
          unitIds: selectedWorkUnitIds.length > 0
            ? [values.unitId || selectedWorkUnitIds[0], ...selectedWorkUnitIds.filter((unitId) => unitId !== (values.unitId || selectedWorkUnitIds[0]))]
            : undefined,
          admissionDate,
          birthDate,
      }, values.email);

      if ('error' in createResult) {
        toast({ title: 'Erro ao criar usuário.', description: createResult.error, variant: 'destructive' });
        return;
      }
      const uid = createResult.uid;
      await logUserAudit('user_created', { id: uid, username: values.username, email: values.email }, {
        email: values.email,
        profile_id: values.profileId,
        assigned_kiosk_count: values.assignedKioskIds.length,
        first_access_email_sent: createResult.emailSent,
      });
      setCreatedUserNotice({
        username: values.username,
        email: values.email,
        emailSent: createResult.emailSent,
      });
      return;
    }
    toast({ title: 'Alterações salvas.' });
    closeForm('saved');
  };

  const onSubmit = async (values: UserFormValues) => {
    try {
      await saveUser(values);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: editingUser ? 'Não foi possível salvar as alterações.' : 'Não foi possível criar o usuário.',
        description: error instanceof Error ? error.message : 'Tente novamente.',
      });
    }
  };

  const onInvalidSubmit = (errors: FieldErrors<UserFormValues>) => {
    const field = Object.keys(errors)[0] as keyof UserFormValues | undefined;
    if (field && isDrawer) {
      setActiveEditTab(COLLABORATOR_EDIT_FIELD_TAB[field] ?? 'identity');
      window.requestAnimationFrame(() => form.setFocus(field));
    } else if (field) {
      form.setFocus(field);
    }
    toast({
      variant: 'destructive',
      title: 'Existem campos obrigatórios pendentes.',
      description: firstUserFormError(errors),
    });
    if (!isDrawer) window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  
  const handlePhotoUpdate = async (dataUrl: string) => {
    setIsUploadingPhoto(true);
    const targetUserId = editingUser?.id || `new-user-${Date.now()}`;
    try {
      const storageRef = ref(storage, `avatars/${targetUserId}`);
      await uploadString(storageRef, dataUrl, 'data_url');
      const downloadURL = await getDownloadURL(storageRef);
      form.setValue('avatarUrl', downloadURL, { shouldDirty: true });
      // Auto-save avatarUrl immediately so the photo persists
      // even if the user closes the form without clicking "Salvar alterações"
      if (editingUser) {
        await updateUser({ ...editingUser, avatarUrl: downloadURL });
        await logUserAudit('user_updated', editingUser, {
          changed_fields: ['avatarUrl'],
          source: 'photo_update',
        });
      }
      toast({ title: "Foto atualizada!" });
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Erro ao salvar foto.', description: getAvatarUploadErrorMessage(error) });
    } finally {
      setIsUploadingPhoto(false);
    }
  };
  
  const handlePhotoCaptured = async (dataUrl: string) => {
      await handlePhotoUpdate(dataUrl);
      setIsPhotoModalOpen(false);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({ variant: 'destructive', title: 'Arquivo muito grande', description: 'Selecione uma imagem menor que 5MB.' });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = reader.result as string;
        await handlePhotoUpdate(dataUrl);
      };
      reader.readAsDataURL(file);
    }
  };


  const canManageAnyUsers = Boolean(
    permissions.settings.manageUsers || permissions.dp?.collaborators?.edit
  );

  if (authLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando cadastro do colaborador...
      </div>
    );
  }

  if (!canManageAnyUsers) {
    return (
        <Card className="w-full max-w-2xl mx-auto">
            <CardHeader>
            <CardTitle>Acesso negado</CardTitle>
            </CardHeader>
            <CardContent>
                <p>Você não tem permissão para editar cadastros de colaboradores.</p>
            </CardContent>
        </Card>
    );
  }

  if (editUserId && !editingUser) {
    if (users.some((user) => user.id === editUserId)) {
      return (
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Preparando edição do colaborador...
        </div>
      );
    }
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Colaborador não encontrado</CardTitle>
          <CardDescription>O cadastro solicitado não está disponível ou não pertence ao seu escopo de acesso.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => onClose?.('cancel')}>Voltar para o perfil</Button>
        </CardContent>
      </Card>
    );
  }
  
  const activeCount = users.filter((user) => user.isActive !== false).length;
  const inactiveCount = users.length - activeCount;
  const pendingInvites = users.filter((user) => user.isActive !== false && !(user as any).lastLoginAt).length;
  const blockedCount = users.filter((user) => user.loginRestrictionEnabled).length;

  const statCards = [
    { label: 'Ativos', value: activeCount, total: users.length, color: 'bg-emerald-500', pct: users.length ? Math.round((activeCount / users.length) * 100) : 0 },
    { label: 'Convites pendentes', value: pendingInvites, total: users.length, color: 'bg-amber-500', pct: users.length ? Math.round((pendingInvites / users.length) * 100) : 0 },
    { label: 'Inativos', value: inactiveCount, total: users.length, color: 'bg-slate-400', pct: users.length ? Math.round((inactiveCount / users.length) * 100) : 0, href: '/dashboard/users/inactive' },
    { label: 'Bloqueados', value: blockedCount, total: users.length, color: 'bg-rose-500', pct: users.length ? Math.round((blockedCount / users.length) * 100) : 0 },
  ];

  if (createOnly && !showForm) return null;

  const lastAccessLabel = (value: unknown) => {
    if (!value) return 'Nunca';
    try {
      const date = typeof value === 'object' && value && 'toDate' in value && typeof (value as any).toDate === 'function'
        ? (value as any).toDate()
        : new Date(value as any);
      const diffMs = Date.now() - date.getTime();
      const minutes = Math.floor(diffMs / 60000);
      if (minutes < 60) return `ha ${Math.max(minutes, 1)} min`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `ha ${hours}h`;
      const days = Math.floor(hours / 24);
      if (days === 1) return 'ontem';
      return `ha ${days} dias`;
    } catch {
      return 'Nunca';
    }
  };

  return (
    <>
      {showForm ? (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit, onInvalidSubmit)}
            autoComplete={createOnly ? 'off' : 'on'}
            className={cn(
              createOnly && 'personal-create-user-form space-y-2',
              !createOnly && !isDrawer && 'collaborator-edit-form system-standard-page space-y-5 font-ds',
              isDrawer && 'collaborator-edit-form flex shrink-0 min-h-[calc(100dvh-158px)] flex-col gap-4 font-ds',
            )}
          >
            {/* ── Back nav ── */}
            {!createOnly && !isDrawer && editUserId && editingUser ? (
              <PageHeader
                title="Editar dados"
                description="Atualize a identificação, a atuação, a jornada e o comportamento deste cadastro."
                back={{
                  fallbackHref: `/dashboard/dp/collaborators/${encodeURIComponent(editUserId)}`,
                  parentLabel: editingUser.username,
                  ariaLabel: `Voltar para o perfil de ${editingUser.username}`,
                }}
              />
            ) : !createOnly && !isDrawer ? (
              <div className="flex items-center gap-3 mb-2">
                <Button
                  type="button" variant="ghost" size="icon"
                  className="shrink-0 h-9 w-9 rounded-ds-btn bg-ds-surface text-ds-ink-muted shadow-xs ring-1 ring-ds-border"
                  onClick={() => closeForm('cancel')}
                  aria-label="Voltar"
                >
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                </Button>
                <div>
                  <p className="font-semibold leading-tight">
                    {editingUser ? editingUser.username : 'Novo usuário'}
                  </p>
                  <p className="text-xs text-muted-foreground">{contextLabel}</p>
                </div>
              </div>
            ) : null}

            {isDrawer ? (
              <nav
                aria-label="Seções da edição do colaborador"
                className="sticky top-0 z-20 -mx-1 shrink-0 overflow-x-auto rounded-ds-md bg-ds-seg p-[3px] shadow-xs"
              >
                <div role="tablist" aria-label="Dados do colaborador" className="flex min-w-max gap-1">
                  {visibleEditTabs.map((tab, index) => {
                    const status = editTabStatus(tab.id);
                    return (
                    <button
                      key={tab.id}
                      id={`collaborator-edit-tab-${tab.id}`}
                      type="button"
                      role="tab"
                      tabIndex={activeEditTab === tab.id ? 0 : -1}
                      aria-selected={activeEditTab === tab.id}
                      aria-controls={`collaborator-edit-panel-${tab.id}`}
                      onClick={() => setActiveEditTab(tab.id)}
                      onKeyDown={(event) => handleEditTabKeyDown(event, index)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-ds-sm px-3 py-2 text-xs font-extrabold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink',
                        activeEditTab === tab.id
                          ? 'bg-ds-surface text-ds-ink shadow-xs'
                          : 'text-ds-ink-muted hover:text-ds-ink',
                      )}
                    >
                      {tab.label}
                      {status ? (
                        <>
                          <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', status === 'error' ? 'bg-ds-danger' : 'bg-ds-accent')} />
                          <span className="sr-only">{status === 'error' ? '(com erro)' : '(alterada)'}</span>
                        </>
                      ) : null}
                    </button>
                    );
                  })}
                </div>
              </nav>
            ) : null}

            {(!isDrawer || activeEditTab === 'identity') ? (
            <div id="collaborator-edit-panel-identity" role={isDrawer ? 'tabpanel' : undefined} aria-labelledby={isDrawer ? 'collaborator-edit-tab-identity' : undefined}>
            <UserFormSection
              title="Identificação"
              description="Dados básicos e natureza do vínculo da pessoa."
              help="Reúne a identificação principal do cadastro. O tipo de vínculo define quais fluxos trabalhistas ou societários podem ser aplicados, sem alterar sozinho cargo, função ou permissões."
              compact={createOnly}
            >
              <div className={createOnly ? "grid gap-2" : "flex flex-col gap-5 sm:flex-row sm:items-start"}>
                {/* Avatar + botões */}
                {!createOnly ? (
                <div className="flex flex-col items-center gap-2 shrink-0">
                  <Avatar className="h-20 w-20">
                    {isUploadingPhoto ? (
                      <AvatarFallback><Loader2 className="h-5 w-5 animate-spin" /></AvatarFallback>
                    ) : (
                      <>
                        <AvatarImage src={form.watch('avatarUrl') || undefined} />
                        <AvatarFallback
                          className="text-2xl font-bold text-white"
                          style={{
                            backgroundColor: editingUser
                              ? getUserColor(editingUser.id, editingUser.color)
                              : pickUserColor(users.map(u => u.color)),
                          }}
                        >
                          {form.watch('username')?.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase() || '?'}
                        </AvatarFallback>
                      </>
                    )}
                  </Avatar>
                  <div className="flex gap-1.5">
                    <Button type="button" size="sm" variant="ds-secondary" onClick={() => setIsPhotoModalOpen(true)} disabled={isUploadingPhoto}>
                      <Camera className="h-3 w-3 mr-1" /> Tirar foto
                    </Button>
                    <Button type="button" size="sm" variant="ds-secondary" onClick={() => fileInputRef.current?.click()} disabled={isUploadingPhoto}>
                      <Upload className="h-3 w-3 mr-1" /> Carregar
                    </Button>
                  </div>
                  <Input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
                </div>
                ) : null}

                {/* Nome, e-mail, badges */}
                <div className="flex-1 space-y-3 min-w-0">
                  {!createOnly ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="h-3 w-3 rounded-full ring-1 ring-border shrink-0"
                        style={{
                          backgroundColor: editingUser
                            ? getUserColor(editingUser.id, editingUser.color)
                            : pickUserColor(users.map(u => u.color)),
                        }}
                      />
                      <span className="text-[11px] text-muted-foreground">Cor na escala</span>
                    </div>
                    {editingUser && (
                      <Badge variant={editingUser.isActive !== false ? 'default' : 'secondary'} className="text-[10px]">
                        {editingUser.isActive !== false ? 'Ativo' : 'Inativo'}
                      </Badge>
                    )}
                  </div>
                  ) : null}
                  <div className={createOnly ? "grid grid-cols-1 gap-2 lg:grid-cols-3" : "grid grid-cols-1 md:grid-cols-3 gap-3"}>
                    <FormField control={form.control} name="username" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="ex: Maria Silva"
                            {...field}
                            autoComplete={createOnly ? 'off' : 'name'}
                            onBlur={(event) => {
                              field.onBlur();
                              const formatted = formatPersonName(event.target.value);
                              if (formatted) {
                                form.setValue('username', formatted, { shouldDirty: true, shouldValidate: true });
                              }
                            }}
                          />
                        </FormControl>
                        <FormDescription>Use nome completo com iniciais maiúsculas. Ex.: Maria Joana Barbosa Pereira.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel>E-mail</FormLabel>
                        <FormControl><Input type="email" placeholder="email@dominio.com" {...field} autoComplete={createOnly ? 'off' : 'email'} disabled={!!editingUser} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="employmentRelationshipType" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tipo de vínculo</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione o vínculo" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {EMPLOYMENT_RELATIONSHIP_TYPES.map((item) => (
                              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription className="text-xs">
                          Classifica a natureza do vínculo e habilita somente os fluxos compatíveis.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              </div>
            </UserFormSection>
            </div>
            ) : null}

            {permissions.dp?.view ? (
              <>
                {(!isDrawer || activeEditTab === 'journey') ? (
                <div id="collaborator-edit-panel-journey" role={isDrawer ? 'tabpanel' : undefined} aria-labelledby={isDrawer ? 'collaborator-edit-tab-journey' : undefined} className={isDrawer ? 'flex flex-col gap-4' : createOnly ? 'space-y-2' : 'space-y-5'}>
                <UserFormSection
                  title="Cargo e função"
                  description="O que a pessoa faz na empresa e qual perfil de permissão isso aplica."
                  help="Cargo e função determinam o perfil de permissão aplicado automaticamente. A lista de funções respeita a compatibilidade com o cargo escolhido."
                  compact={createOnly}
                >
                  <div className={createOnly ? "space-y-2 border-t pt-2" : "space-y-4"}>
                    <div className={createOnly ? "grid grid-cols-1 gap-2 md:grid-cols-2" : "grid grid-cols-1 gap-4 md:grid-cols-2"}>
                      <FormField control={form.control} name="jobRoleId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Cargo</FormLabel>
                          <Select
                            value={field.value || '__none__'}
                            onValueChange={(value) => {
                              field.onChange(value === '__none__' ? '' : value);
                            }}
                            disabled={hrLoading}
                          >
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione um cargo" /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="__none__">Sem cargo</SelectItem>
                              {roleOptions.map((role) => (
                                <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {effectiveDefaultProfileName && (
                            <FormDescription className="text-xs">
                              Perfil aplicado automaticamente: {effectiveDefaultProfileName}.
                            </FormDescription>
                          )}
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="jobFunctionIds" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Função</FormLabel>
                          <Select
                            value={(field.value ?? [])[0] ?? '__none__'}
                            onValueChange={(value) => {
                              field.onChange(value === '__none__' ? [] : [value]);
                            }}
                            disabled={hrLoading || !selectedRoleId}
                          >
                            <FormControl>
                              <SelectTrigger className={selectedRoleId ? '' : 'opacity-70'}>
                                <SelectValue placeholder={selectedRoleId ? 'Selecione a função' : 'Selecione primeiro um cargo'} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="__none__">
                                {selectedRoleId ? 'Sem função' : 'Selecione primeiro um cargo'}
                              </SelectItem>
                              {compatibleFunctionOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                              {selectedRoleId && compatibleFunctionOptions.length === 0 && (
                                <SelectItem value="__no_function_options__" disabled>
                                  Nenhuma função para este cargo
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          <FormDescription className="text-xs">
                            A função listada respeita a compatibilidade do cargo.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </div>
                </UserFormSection>
                <UserFormSection
                  title="Jornada e datas"
                  description="Turno de referência, datas contratuais e informações calculadas."
                  help="O turno padrão orienta a montagem da escala dentro da jornada aplicável. As datas alimentam cálculos de tempo de empresa, idade, aniversários e ciclos de férias; integrações podem bloquear campos que são mantidos pelo sistema de origem."
                  compact={createOnly}
                >
                  <div className={createOnly ? "space-y-2" : "space-y-4"}>
                    <div className={createOnly ? "grid grid-cols-1 gap-2 lg:grid-cols-3" : "grid grid-cols-1 gap-4 lg:grid-cols-3"}>
                      <FormField control={form.control} name="shiftDefinitionId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Turno padrão</FormLabel>
                          <Select
                            value={field.value || '__none__'}
                            onValueChange={v => field.onChange(v === '__none__' ? '' : v)}
                            disabled={shiftDefsLoading}
                          >
                            <FormControl><SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="__none__">— Nenhum —</SelectItem>
                              {filteredShiftDefinitions.map(def => (
                                <SelectItem key={def.id} value={def.id}>{def.name} ({def.startTime}–{def.endTime})</SelectItem>
                              ))}
                              {filteredShiftDefinitions.length === 0 && (
                                <SelectItem value="__no_shift_options__" disabled>
                                  Nenhum turno para esta unidade
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          <FormDescription className="text-xs">{shiftDefinitionHint}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="admissionDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Data de admissão</FormLabel>
                          <FormControl><Input type="date" {...field} disabled={hasBizneoLink} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="birthDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Data de nascimento</FormLabel>
                          <FormControl><Input type="date" {...field} disabled={hasBizneoLink} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    {!createOnly ? (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                      <DerivedInfoCard label="Tempo de empresa" value={dpDateSummary.tenure} />
                      <DerivedInfoCard label="Idade" value={dpDateSummary.age} />
                      <DerivedInfoCard label="Aniversário de empresa" value={dpDateSummary.companyAnniversary} />
                      <DerivedInfoCard label="Aniversário de idade" value={dpDateSummary.birthday} />
                      <VacationSummaryCard
                        user={editingUser}
                        admissionDate={parseDateInput(admissionDateValue)}
                        vacations={vacations}
                      />
                    </div>
                    ) : null}
                  </div>
                </UserFormSection>
                </div>
                ) : null}

                {(!isDrawer || activeEditTab === 'units') ? (
                <div id="collaborator-edit-panel-units" role={isDrawer ? 'tabpanel' : undefined} aria-labelledby={isDrawer ? 'collaborator-edit-tab-units' : undefined}>
                <UserFormSection
                  title="Unidades"
                  description="Quatro escolhas diferentes: onde trabalha, qual unidade aparece no financeiro, onde responde e o que consegue consultar."
                  help="São quatro informações diferentes: unidades de escala (onde a pessoa trabalha), unidade principal (referência do financeiro), unidades sob responsabilidade (onde é gestora) e escopo (onde pode visualizar e operar no sistema)."
                  compact={createOnly}
                >
                  <div className={createOnly ? "space-y-2 border-t pt-2" : "space-y-4"}>
                    <div className="rounded-ds-card border border-ds-info/25 bg-ds-info-bg/45 px-4 py-4">
                      <div className="flex items-start gap-2.5">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ds-info" aria-hidden />
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-extrabold text-ds-ink">Como ler esta tela</p>
                          <p className="text-xs leading-5 text-ds-ink-2">
                            A unidade financeira não define sozinha a escala nem o local da batida. Uma cobertura autorizada pode levar a pessoa a trabalhar temporariamente em outra unidade.
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2.5 md:grid-cols-2">
                        <div className="rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2.5">
                          <p className="text-xs font-extrabold text-ds-ink">1. Escala e operação</p>
                          <p className="mt-1 text-xs leading-5 text-ds-ink-muted">Unidades habituais de trabalho. A cobertura em outra unidade é registrada no turno específico, com motivo.</p>
                        </div>
                        <div className="rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2.5">
                          <p className="text-xs font-extrabold text-ds-ink">2. Principal financeira</p>
                          <p className="mt-1 text-xs leading-5 text-ds-ink-muted">Referência de lotação, custos e relatórios financeiros. Não substitui a unidade do turno.</p>
                        </div>
                        <div className="rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2.5">
                          <p className="text-xs font-extrabold text-ds-ink">3. Responsabilidade</p>
                          <p className="mt-1 text-xs leading-5 text-ds-ink-muted">Unidades em que a pessoa aparece como gestora no organograma, metas e documentos.</p>
                        </div>
                        <div className="rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2.5">
                          <p className="text-xs font-extrabold text-ds-ink">4. Visualização por unidade</p>
                          <p className="mt-1 text-xs leading-5 text-ds-ink-muted">Define onde a pessoa pode consultar e operar no sistema, conforme as permissões do perfil.</p>
                        </div>
                      </div>
                      <p className="mt-3 border-t border-ds-info/15 pt-3 text-xs font-semibold leading-5 text-ds-ink-2">
                        Exemplo: alguém pode ter a unidade A como referência financeira e cobrir um turno na B. Visualizar a unidade C não cria um turno nem autoriza a batida lá.
                      </p>
                    </div>
                    <div>
                      <Controller control={form.control} name="assignedKioskIds" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unidades de escala e operação</FormLabel>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <FormControl>
                                <Button variant="ds-secondary" className="relative h-10 w-full justify-start rounded-ds-md bg-ds-input pr-12 text-[13px] font-normal">
                                  {(field.value?.length || 0) > 0 ? `${field.value.length} unidade(s)` : 'Selecione as unidades'}
                                  <span className="pointer-events-none absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-ds-sm border border-ds-border bg-ds-surface text-ds-ink-muted shadow-xs">
                                    <ChevronDown aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
                                  </span>
                                </Button>
                              </FormControl>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                              <DropdownMenuLabel>Unidades disponíveis</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <ScrollArea className="h-48">
                                {kiosks.map(kiosk => (
                                  <DropdownMenuCheckboxItem
                                    key={kiosk.id}
                                    checked={field.value?.includes(kiosk.id)}
                                    onCheckedChange={checked => {
                                      const selected = field.value || [];
                                      field.onChange(checked
                                        ? Array.from(new Set([...selected, kiosk.id]))
                                        : selected.filter(id => id !== kiosk.id));
                                    }}
                                    onSelect={e => e.preventDefault()}
                                  >
                                    {kiosk.name}
                                  </DropdownMenuCheckboxItem>
                                ))}
                              </ScrollArea>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <FormDescription className="text-xs">
                            Onde a pessoa trabalha: entra na escala e opera nessas unidades (aceita várias). É a base do escopo &quot;Somente unidades vinculadas&quot;.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    {form.watch('assignedKioskIds')?.length > 0 && Object.keys(pdvOperatorIds).some(k => pdvOperatorIds[k]) && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">IDs no PDV</p>
                        <div className="flex flex-wrap gap-1.5">
                          {form.watch('assignedKioskIds').map(kioskId => {
                            const id = pdvOperatorIds[kioskId];
                            if (!id) return null;
                            const name = kiosks.find(k => k.id === kioskId)?.name ?? kioskId;
                            return (
                              <span key={kioskId} className="inline-flex items-center gap-1 text-xs bg-muted text-muted-foreground rounded-md px-2 py-1">
                                <span className="font-medium">{name}</span>
                                <span className="text-muted-foreground/60">·</span>
                                {id}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className={createOnly ? "grid grid-cols-1 gap-2 md:grid-cols-2" : "grid grid-cols-1 gap-4 md:grid-cols-2"}>
                      <FormField control={form.control} name="unitId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unidade principal (Financeiro)</FormLabel>
                          <Select value={field.value || undefined} onValueChange={field.onChange} disabled={selectedWorkUnits.length === 0}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione primeiro uma unidade de escala" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {selectedWorkUnits.map((unit) => (
                                <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription className="text-xs">
                            Referência do financeiro (lotação e custos), escolhida entre as unidades de escala. As demais não alteram essa referência.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="responsibleUnitIds" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unidades sob responsabilidade</FormLabel>
                          <FormControl>
                            <MultiSelect
                              options={responsibleUnitOptions}
                              selected={field.value ?? []}
                              onChange={field.onChange}
                              placeholder="Selecione as unidades"
                              className={responsibleUnitOptions.length > 0 ? '' : 'opacity-70'}
                            />
                          </FormControl>
                          <FormDescription className="text-xs">
                            Onde a pessoa é gestora: aparece como responsável no organograma, nas metas e nos documentos. Não libera acesso; isso é o escopo abaixo.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className={selectedUnitAccessScope === 'selected' ? "grid grid-cols-1 gap-4 md:grid-cols-2" : "grid grid-cols-1 gap-4"}>
                      <FormField control={form.control} name="unitAccessScope" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Escopo de visualização por unidade</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="linked">Somente unidades vinculadas</SelectItem>
                              <SelectItem value="selected">Unidades específicas</SelectItem>
                              <SelectItem value="all">Todas as unidades</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription className="text-xs">
                            {UNIT_ACCESS_SCOPE_NOTES[normalizeUnitAccessScope(field.value)]} Isso não altera a unidade financeira, não cria escala e não libera batida por si só; o perfil continua definindo o que ele pode fazer.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                      {selectedUnitAccessScope === 'selected' ? (
                        <FormField control={form.control} name="unitAccessUnitIds" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Unidades liberadas no escopo</FormLabel>
                            <FormControl>
                              <MultiSelect
                                options={responsibleUnitOptions}
                                selected={field.value ?? []}
                                onChange={field.onChange}
                                placeholder="Selecione as unidades"
                              />
                            </FormControl>
                            <FormDescription className="text-xs">
                              Não altera a lotação nem as unidades sob responsabilidade.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )} />
                      ) : null}
                    </div>
                  </div>
                </UserFormSection>
                </div>
                ) : null}
              </>
            ) : null}

            {(!isDrawer || activeEditTab === 'access') ? (
            <div id="collaborator-edit-panel-access" role={isDrawer ? 'tabpanel' : undefined} aria-labelledby={isDrawer ? 'collaborator-edit-tab-access' : undefined} className={isDrawer ? 'flex flex-col gap-4' : createOnly ? 'space-y-2' : 'space-y-5'}>
            {permissions.dp?.view ? (
              <FormField control={form.control} name="profileId" render={() => (
                <FormItem data-ui="profile-summary" className="rounded-ds-card border border-ds-border bg-ds-surface px-5 py-4 shadow-xs">
                  <FormLabel className="text-[11px] font-extrabold uppercase tracking-wide text-ds-ink-faint">Perfil de permissão</FormLabel>
                  <p className="text-base font-extrabold text-ds-ink">
                    {profilesLoading ? 'Carregando perfil...' : selectedProfileName ?? 'Sem perfil definido'}
                  </p>
                  <FormDescription className="text-xs">
                    {effectiveDefaultProfileId && effectiveDefaultProfileId === selectedProfileId
                      ? 'Aplicado pelo cargo e função (aba Cargo e jornada). '
                      : ''}
                    O perfil define o que a pessoa pode fazer; as unidades definem onde.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            ) : null}
            <UserFormSection
              title="Comportamento no sistema"
              description="Recursos operacionais habilitados para esta pessoa."
              help="Estas opções habilitam a participação do cadastro em rotinas específicas. Elas não substituem cargo, função, vínculo, jornada nem perfil de permissão, e não geram efeitos financeiros por conta própria."
              compact={createOnly}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <FormField control={form.control} name="operacional" render={({ field }) => (
                  <FormItem className="flex min-h-[58px] flex-row items-center justify-between gap-3 rounded-ds-md border border-ds-border bg-ds-input px-3 py-2.5">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <FormLabel className="text-sm font-medium">Operacional</FormLabel>
                        <FieldHelpTooltip
                          title="Usuário operacional"
                          description="Inclui o colaborador nas rotinas de operação, como escala de trabalho e relatórios operacionais. Não altera cargo, função ou perfil de permissão."
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn('text-[11px] font-bold', field.value ? 'text-ds-accent-ink' : 'text-ds-ink-muted')}>
                        {field.value ? 'Ativo' : 'Inativo'}
                      </span>
                      <FormControl>
                        <Switch
                          checked={!!field.value}
                          onCheckedChange={field.onChange}
                          className="border border-ds-border-input shadow-inner data-[state=unchecked]:bg-ds-disabled data-[state=checked]:border-ds-accent data-[state=checked]:bg-ds-accent"
                        />
                      </FormControl>
                    </div>
                  </FormItem>
                )} />
                <FormField control={form.control} name="participatesInGoals" render={({ field }) => (
                  <FormItem className="flex min-h-[58px] flex-row items-center justify-between gap-3 rounded-ds-md border border-ds-border bg-ds-input px-3 py-2.5">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <FormLabel className="text-sm font-medium">Metas</FormLabel>
                        <FieldHelpTooltip
                          title="Participa de metas"
                          description="Inclui o colaborador nos acompanhamentos e seleções do módulo de metas. Não cria meta sozinho e não muda remuneração sem as regras do módulo."
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn('text-[11px] font-bold', field.value ? 'text-ds-accent-ink' : 'text-ds-ink-muted')}>
                        {field.value ? 'Ativo' : 'Inativo'}
                      </span>
                      <FormControl>
                        <Switch
                          checked={!!field.value}
                          onCheckedChange={field.onChange}
                          className="border border-ds-border-input shadow-inner data-[state=unchecked]:bg-ds-disabled data-[state=checked]:border-ds-accent data-[state=checked]:bg-ds-accent"
                        />
                      </FormControl>
                    </div>
                  </FormItem>
                )} />
                {showTransportVoucher ? (
                  <FormField control={form.control} name="needsTransportVoucher" render={({ field }) => (
                  <FormItem className="rounded-ds-md border border-ds-border p-3 md:col-span-2">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-[220px] space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <FormLabel className="text-sm font-medium">Vale-transporte</FormLabel>
                          <span className={cn(
                            'rounded-full px-2 py-0.5 text-[11px] font-bold',
                            currentTransportVoucherStatus === 'active' && 'bg-emerald-50 text-emerald-700',
                            currentTransportVoucherStatus === 'suspended' && 'bg-amber-50 text-amber-700',
                            currentTransportVoucherStatus === 'none' && 'bg-slate-100 text-slate-500'
                          )}>
                            {transportVoucherStatusLabel(currentTransportVoucherStatus)}
                          </span>
                        </div>
                        <FormDescription className="text-xs">
                          Próximo ato: {nextTransportVoucherActionLabel(currentTransportVoucherStatus).toLowerCase()} benefício.
                        </FormDescription>
                      </div>

                      <div className="flex flex-1 flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <FormControl><Switch checked={!!field.value} onCheckedChange={openTransportVoucherChangeDialog} /></FormControl>
                          <span className="text-xs font-semibold text-slate-500">
                            {nextTransportVoucherActionLabel(currentTransportVoucherStatus)}
                          </span>
                          {field.value && (
                            <FormField control={form.control} name="transportVoucherValue" render={({ field: valueField }) => (
                              <div className="min-w-[180px]">
                                <FormControl>
                                  <Input type="number" step="0.01" min="0" placeholder="R$ 0,00" {...valueField} value={valueField.value ?? ''} className="h-9" />
                                </FormControl>
                                <FormMessage />
                              </div>
                            )} />
                          )}
                        </div>

                        <div className="rounded-lg border bg-slate-50/70 p-3">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-[11px] font-bold uppercase text-slate-400">Histórico de atos</p>
                            <p className="text-[11px] font-semibold text-slate-400">Solicitar · Suspender · Reativar</p>
                          </div>
                          {transportVoucherHistory.length > 0 ? (
                            <div className="grid gap-2 md:grid-cols-3">
                              {transportVoucherHistory.slice(-6).reverse().map((entry) => (
                                <div key={entry.id} className="rounded-lg border bg-white p-3 text-xs">
                                  <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold', transportVoucherActionClass(entry))}>
                                    {formatTransportVoucherAction(entry)}
                                  </span>
                                  <p className="mt-2 font-semibold text-slate-800">
                                    {format(parseDateInput(entry.effectiveDate) ?? new Date(entry.effectiveDate), 'dd/MM/yyyy')}
                                  </p>
                                  <p className="mt-1 line-clamp-2 text-slate-500">{entry.reason}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="grid gap-2 md:grid-cols-3">
                              {['Solicitar', 'Suspender', 'Reativar'].map((label) => (
                                <div key={label} className="rounded-lg border border-dashed bg-white px-3 py-2 text-xs font-semibold text-slate-400">
                                  {label}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </FormItem>
                  )} />
                ) : null}
              </div>
            </UserFormSection>
            </div>
            ) : null}

            <div className={cn(
              'flex gap-3',
              createOnly
                ? 'justify-end pt-0.5'
                : cn(
                    'sticky z-20 flex-col rounded-ds-card border border-ds-border bg-ds-surface/95 px-4 py-3 shadow-lg backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between',
                    isDrawer ? 'bottom-0 mt-auto' : 'bottom-4',
                  ),
            )}>
              {!createOnly ? (
                <p className={cn('text-sm font-semibold', form.formState.isDirty ? 'text-ds-accent-ink' : 'text-ds-ink-muted')}>
                  {form.formState.isDirty ? 'Alterações pendentes' : 'Nenhuma alteração pendente'}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant={createOnly ? 'outline' : 'ds-secondary'}
                  size={createOnly ? 'default' : 'md'}
                  className={createOnly ? "h-7 px-3 text-[11px]" : undefined}
                  onClick={() => closeForm('cancel')}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant={createOnly ? 'default' : 'primary-page'}
                  size={createOnly ? 'default' : 'md'}
                  className={createOnly ? "h-7 px-3 text-[11px]" : undefined}
                  loading={form.formState.isSubmitting}
                  disabled={isUploadingPhoto || (!!editingUser && !form.formState.isDirty)}
                >
                  {editingUser ? 'Salvar alterações' : 'Criar usuário'}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-black text-slate-950">Usuários</h2>
              <p className="mt-1 text-sm font-medium text-slate-500">
                {users.length} pessoa{users.length === 1 ? '' : 's'} com acesso · gerencie perfis, quiosques e dados complementares do DP.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-10 rounded-xl border-slate-200 bg-white" disabled>
                <Download className="mr-2 h-4 w-4" /> Exportar
              </Button>
              <Button variant="outline" className="h-10 rounded-xl border-slate-200 bg-white" onClick={() => setIsProfilesModalOpen(true)} disabled={!permissions.settings.manageProfiles}>
                <Shield className="mr-2 h-4 w-4" /> Perfis
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            {statCards.map((stat) => {
              const href = (stat as { href?: string }).href;
              const clickable = !!href && stat.value > 0;
              const inner = (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-black uppercase text-slate-500">{stat.label}</p>
                    <span className={`h-8 w-1 rounded-full ${stat.color}`} />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-3">
                    <p className="flex items-baseline gap-1.5 whitespace-nowrap">
                      <span className="text-3xl font-black text-slate-950">{stat.value}</span>
                      <span className="text-xs font-semibold text-slate-400">/ {stat.total}</span>
                    </p>
                    <p className="shrink-0 text-xs font-black text-slate-500">{stat.pct}%</p>
                  </div>
                </>
              );
              const cardClass = "rounded-2xl border border-slate-200 bg-white p-4 shadow-xs";
              return clickable ? (
                <Link
                  key={stat.label}
                  href={href!}
                  className={`${cardClass} block transition-colors hover:border-slate-300 hover:bg-slate-50`}
                >
                  {inner}
                </Link>
              ) : (
                <div key={stat.label} className={cardClass}>
                  {inner}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs sm:flex-row sm:items-center">
            <div className="relative grow w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 w-full rounded-xl border-slate-100 bg-slate-50 pl-10"
              />
            </div>
            <Select value={profileFilter} onValueChange={setProfileFilter}>
              <SelectTrigger className="h-10 w-full rounded-xl border-slate-100 bg-slate-50 sm:w-[210px]">
                <SelectValue placeholder="Perfil" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os perfis</SelectItem>
                {profiles.map(profile => (
                  <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={kioskFilter} onValueChange={setKioskFilter}>
              <SelectTrigger className="h-10 w-full rounded-xl border-slate-100 bg-slate-50 sm:w-[260px]">
                <SelectValue placeholder="Quiosque" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os quiosques</SelectItem>
                {kiosks.map(kiosk => (
                  <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <span className="hidden whitespace-nowrap text-xs font-black text-slate-500 sm:inline">{filteredUsers.length} de {users.length}</span>
              <Button variant="ghost" className="h-10 shrink-0 whitespace-nowrap rounded-xl" onClick={() => { setSearchTerm(''); setProfileFilter('all'); setKioskFilter('all'); }}>
              <Eraser className="mr-2 h-4 w-4" /> Limpar
              </Button>
            </div>
          </div>

          {groupedUsers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              Nenhum usuário encontrado.
            </div>
          ) : (
            <div className="space-y-4">
              {groupedUsers.map(group => (
                <section key={group.profileId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded-lg bg-pink-100 px-2.5 py-1 text-xs font-black text-pink-600">{group.profileName}</span>
                      <span className="text-xs font-semibold text-slate-500">
                        {group.users.length} pessoa{group.users.length === 1 ? '' : 's'} · {group.users.filter((user) => user.isActive !== false).length} ativa{group.users.filter((user) => user.isActive !== false).length === 1 ? '' : 's'}
                      </span>
                      <span className="hidden text-xs font-semibold text-slate-400 md:inline">Acesso total ao sistema</span>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {group.users.map(user => (
                      <div key={user.id} className="grid gap-3 px-4 py-3 transition-colors hover:bg-pink-50/30 lg:grid-cols-[minmax(260px,1.3fr)_minmax(180px,1fr)_110px_132px] lg:items-center">
                        <div className="flex min-w-0 items-center gap-3">
                          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" aria-label={`Selecionar ${user.username}`} />
                          <Avatar className="h-10 w-10 shrink-0">
                            <AvatarImage src={user.avatarUrl} />
                            <AvatarFallback className="text-xs font-black text-white" style={{ backgroundColor: getUserColor(user.id, user.color) }}>
                              {user.username.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleEdit(user)}
                                className="truncate text-left text-sm font-black text-slate-900 underline-offset-4 hover:text-pink-600 hover:underline"
                              >
                                {user.username}
                              </button>
                              {user.operacional && <Badge className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700" variant="outline">Operacional</Badge>}
                              {user.isActive === false && <Badge className="border-slate-200 bg-slate-100 text-[10px] text-slate-500" variant="outline">Inativo</Badge>}
                            </div>
                            <p className="mt-0.5 truncate text-xs font-medium text-slate-500">{user.jobRoleName ?? group.profileName} · {user.email}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {user.assignedKioskIds?.slice(0, 2).map(id => {
                            const name = kiosks.find(k => k.id === id)?.name ?? id;
                            return (
                              <span key={id} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
                                <CircleDot className="h-2.5 w-2.5 text-indigo-500" />
                                {name}
                              </span>
                            );
                          })}
                          {(user.assignedKioskIds?.length ?? 0) > 2 && (
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-500">+{(user.assignedKioskIds?.length ?? 0) - 2}</span>
                          )}
                          {(!user.assignedKioskIds || user.assignedKioskIds.length === 0) && (
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-400">Sem quiosque</span>
                          )}
                        </div>
                        <div className="text-xs font-black text-slate-700">
                          {lastAccessLabel((user as any).lastLoginAt)}
                          <p className="text-[10px] font-semibold text-slate-400">último acesso</p>
                        </div>
                        <div className="flex items-center justify-end gap-1">
                          {permissions.settings.manageUsers && (
                            <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg border-pink-200 text-pink-500" onClick={() => handleEdit(user)}>
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {permissions.settings.manageUsers && (
                            <DeleteConfirmationDialog
                              open={false}
                              onOpenChange={() => {}}
                              onConfirm={() => setUserToResetPassword(user)}
                              title={`Redefinir senha de ${user.username}?`}
                              description={`Um e-mail será enviado para ${user.email} com instruções para redefinir a senha.`}
                              confirmButtonText="Sim, enviar e-mail"
                              confirmButtonVariant="default"
                              triggerButton={<Button variant="outline" size="icon" className="h-8 w-8 rounded-lg border-slate-200"><KeyRound className="h-3.5 w-3.5" /></Button>}
                            />
                          )}
                          {permissions.settings.manageUsers && (
                            <Button
                              variant="outline" size="icon" className="h-8 w-8 rounded-lg border-amber-200 text-amber-600 hover:text-amber-700"
                              onClick={() => handleInactivateClick(user)}
                              disabled={user.id === currentUser?.id || profileIsAdmin(user.profileId) || user.isActive === false}
                              title="Inativar usuário"
                            >
                              <UserX className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
      
      <ProfileManagementModal 
        open={isProfilesModalOpen}
        onOpenChange={setIsProfilesModalOpen}
        canEdit={!!permissions.settings.manageProfiles}
      />

      <PhotoCaptureModal 
        open={isPhotoModalOpen}
        onOpenChange={setIsPhotoModalOpen}
        onPhotoCaptured={handlePhotoCaptured}
      />

      <Dialog
        open={!!createdUserNotice}
        onOpenChange={(open) => {
          if (open) return;
          setCreatedUserNotice(null);
          closeForm();
        }}
      >
        <DialogContent className="sm:max-w-md" hideClose>
          <DialogHeader className="items-center text-center sm:text-center">
            <div className={cn(
              'mb-2 grid h-14 w-14 place-items-center rounded-full',
              createdUserNotice?.emailSent ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            )}>
              {createdUserNotice?.emailSent ? <MailCheck className="h-7 w-7" /> : <CheckCircle2 className="h-7 w-7" />}
            </div>
            <DialogTitle>Cadastro inicial criado</DialogTitle>
            <DialogDescription className="max-w-sm leading-relaxed">
              {createdUserNotice?.emailSent
                ? <>O cadastro de <strong className="text-slate-800">{createdUserNotice.username}</strong> foi criado e o link para definir a senha foi enviado para <strong className="text-slate-800">{createdUserNotice.email}</strong>.</>
                : <>O cadastro de <strong className="text-slate-800">{createdUserNotice?.username}</strong> foi criado, mas o e-mail com o link de definição de senha não pôde ser enviado. Reenvie o acesso pela ação de redefinição de senha.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <Button
              type="button"
              className="min-w-32 bg-pink-600 hover:bg-pink-700"
              onClick={() => {
                setCreatedUserNotice(null);
                closeForm();
              }}
            >
              Entendi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!transportVoucherDialog} onOpenChange={(open) => { if (!open) setTransportVoucherDialog(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {transportVoucherDialog?.toStatus === 'active' ? 'Ativar vale-transporte' : 'Suspender vale-transporte'}
            </DialogTitle>
            <DialogDescription>
              Registre a data efetiva e o motivo para manter o histórico do benefício.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>Data efetiva</Label>
              <Input
                type="date"
                value={transportVoucherEffectiveDate}
                onChange={(event) => setTransportVoucherEffectiveDate(event.target.value)}
              />
            </div>
            {transportVoucherDialog?.toStatus === 'active' && (
              <div>
                <Label>Valor diário (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={transportVoucherValueDraft}
                  onChange={(event) => setTransportVoucherValueDraft(event.target.value)}
                  placeholder="0,00"
                />
              </div>
            )}
            <div>
              <Label>Motivo</Label>
              <Textarea
                value={transportVoucherReason}
                onChange={(event) => setTransportVoucherReason(event.target.value)}
                rows={3}
                placeholder="Ex.: colaborador solicitou adesão ao benefício."
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTransportVoucherDialog(null)}>Cancelar</Button>
            <Button type="button" onClick={confirmTransportVoucherChange}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {userToInactivate && (
        <Dialog open={!!userToInactivate} onOpenChange={(open) => { if (!open) setUserToInactivate(null); }}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Alterar acesso de {userToInactivate.username}</DialogTitle>
              <DialogDescription>
                O usuário será desativado no Firebase Auth, mantendo cadastro e histórico para reativação futura.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setInactivationMode('temporary')}
                className={cn(
                  'rounded-lg border p-4 text-left transition-colors',
                  inactivationMode === 'temporary' ? 'border-pink-300 bg-pink-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                )}
              >
                <p className="text-sm font-semibold text-slate-900">Inativação temporária</p>
                <p className="mt-1 text-xs text-slate-500">Bloqueia o login, sem registrar demissão.</p>
              </button>
              <button
                type="button"
                onClick={() => setInactivationMode('contract_termination')}
                disabled={!contractTerminationAvailable}
                className={cn(
                  'rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55',
                  inactivationMode === 'contract_termination' ? 'border-pink-300 bg-pink-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                )}
              >
                <p className="text-sm font-semibold text-slate-900">{terminationCopy.action}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {contractTerminationAvailable
                    ? `Vínculo: ${employmentRelationshipLabel(selectedTerminationRelationship)}.`
                    : selectedTerminationRelationship === 'internship'
                      ? 'O fluxo específico de estágio será implementado posteriormente.'
                      : selectedTerminationRelationship === 'apprenticeship'
                        ? 'O fluxo específico de aprendiz será implementado posteriormente.'
                        : selectedTerminationRelationship === 'partner'
                          ? 'O fluxo específico societário será implementado posteriormente.'
                          : 'Defina o tipo de vínculo antes de registrar o encerramento.'}
                </p>
              </button>
            </div>

            {inactivationMode === 'contract_termination' && (
              <div className="grid gap-4 rounded-lg border bg-slate-50/70 p-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>{selectedTerminationRelationship === 'pj' ? 'CNPJ da contratante' : 'CNPJ empregador'}</Label>
                  <Select value={terminationEmployerUnitId} onValueChange={setTerminationEmployerUnitId}>
                    <SelectTrigger><SelectValue placeholder="Selecione a empresa responsável pelo vínculo" /></SelectTrigger>
                    <SelectContent>
                      {units.filter((unit) => CnpjValidator.validate(unit.cnpj ?? '').valid).map((unit) => (
                        <SelectItem key={unit.id} value={unit.id}>{unit.name} · {CnpjValidator.format(unit.cnpj ?? '')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-slate-500">{selectedTerminationRelationship === 'pj' ? 'O CNPJ será validado contra o contrato assinado antes da abertura do distrato.' : 'A unidade de trabalho permanece separada da empregadora jurídica.'}</p>
                </div>
                <div>
                  <Label>{terminationCopy.dateLabel}</Label>
                  <Input type="date" value={terminationDate} onChange={(event) => setTerminationDate(event.target.value)} />
                </div>
                <div>
                  <Label>{terminationCopy.reasonLabel}</Label>
                  <Select value={terminationReason} onValueChange={(value) => { setTerminationReason(value); if (!requiresTerminationSubtype(value)) setTerminationCause(''); }}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {availableTerminationReasons.map((reason) => (
                        <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {requiresTerminationSubtype(terminationReason) && (
                  <div className="sm:col-span-2">
                    <Label>Tipo de justa causa</Label>
                    <Select value={terminationCause} onValueChange={setTerminationCause}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {JUST_CAUSE_TYPES.map((cause) => (
                          <SelectItem key={cause} value={cause}>{cause}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            <div>
              <Label>Observação adicional</Label>
              <Textarea
                value={terminationNotes}
                onChange={(event) => setTerminationNotes(event.target.value)}
                placeholder="Opcional"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setUserToInactivate(null)}>Cancelar</Button>
              <Button type="button" variant="destructive" onClick={handleInactivateConfirm}>
                {inactivationMode === 'temporary' ? 'Inativar temporariamente' : 'Registrar término'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      
      {userToResetPassword && (
         <DeleteConfirmationDialog
            open={!!userToResetPassword}
            isDeleting={false}
            onOpenChange={() => setUserToResetPassword(null)}
            onConfirm={handleResetPasswordConfirm}
            title={`Enviar link de redefinição?`}
            description={`Um e-mail será enviado para ${userToResetPassword.email}.`}
            confirmButtonText="Sim, enviar"
          />
      )}
    </>
  );
}
