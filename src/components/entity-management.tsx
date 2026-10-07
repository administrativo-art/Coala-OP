

"use client"

import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import Image from 'next/image';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useEntities } from '@/hooks/use-entities';
import { useToast } from '@/hooks/use-toast';
import { CadastrosHero, CardGrid, Chevron, EmptyResults, GridCard, ListHead, ListRow, ListShell, ListSkeleton, ResultsBar, TagChip, type CadastrosTabProps, type Tone } from '@/components/cadastros/cadastros-ui';
import { EntityFichaModal, type EntityFichaEditTarget } from '@/components/entity-ficha-modal';
import { ENTITY_EMAIL_PURPOSES, ENTITY_ICMS_OPTIONS, ENTITY_IE_STATUS_OPTIONS, ENTITY_SIGNATORY_SCOPES, formatEntityDate, isAttentionCadastralStatus, type EntityEmailPurpose } from '@/components/cadastros/entity-form-options';
import { buildChips, countByKey, initialsOf, type CadastrosStatus } from '@/components/cadastros/cadastros-utils';
import { useAuth } from '@/hooks/use-auth';

import { Plus, Trash2, Building, User, Search, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RefreshCw, Loader2, AlertTriangle, X } from 'lucide-react';
import { type Entity } from '@/types';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import type { CompanyLookupResponse, NormalizedCompanyData } from '@/lib/company/company-lookup-types';

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ScrollArea } from './ui/scroll-area';

import { cn } from '@/lib/utils';

import { AsoClinicEntityDialog } from '@/features/hr/aso/aso-clinics-management';
import { hasFormalizationPermission } from '@/lib/hr-formalization-permissions';

const entitySchema = z.object({
  type: z.enum(['pessoa_fisica', 'pessoa_juridica']),
  name: z.string().min(1, 'O nome é obrigatório.'),
  fantasyName: z.string().optional(),
  nickname: z.string().optional(),
  document: z.string().min(1, 'O documento é obrigatório.'),
  address: z.object({
    zipCode: z.string().optional(),
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  }),
  contact: z.object({
    phone: z.string().optional(),
    email: z.string().email('E-mail inválido.').or(z.literal('')).optional(),
    emails: z.array(z.object({
      id: z.string().min(1),
      department: z.string().trim().min(1, 'Informe o setor.'),
      email: z.string().trim().email('E-mail setorial inválido.'),
      purposes: z.array(z.enum(['onboarding', 'termination', 'aso', 'vacation'])).optional(),
    })).optional(),
  }),
  responsible: z.string().optional(),
  documentSignatoryUserId: z.string().optional(),
  documentSignatoryName: z.string().optional(),
  documentSignatoryEmail: z.string().email('E-mail de assinatura inválido.').or(z.literal('')).optional(),
  documentSignatoryScope: z.enum(['entity', 'cnpj_root']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  cadastralStatus: z.string().optional(),
  openingDate: z.string().optional(),
  legalNature: z.string().optional(),
  primaryCnaeCode: z.string().optional(),
  primaryCnaeDescription: z.string().optional(),
  stateRegistration: z.string().optional(),
  icmsTaxpayer: z.enum(['sim', 'nao', 'nao_informado']).optional(),
  stateRegistrationStatus: z.enum(['ativa', 'inativa', 'suspensa', 'baixada', 'nao_consultada', 'nao_informado']).optional(),
  businessType: z.string().optional(),
  dataSource: z.enum(['internal', 'brasilapi', 'viacep', 'cache', 'manual', 'sintegra']).optional(),
  lastCnpjLookupAt: z.string().optional(),
  rg: z.string().optional(),
  birthDate: z.string().optional(),
  notes: z.string().optional(),
  imageUrl: z.string().optional(),
}).superRefine((data, ctx) => {
    if (data.type === 'pessoa_juridica') {
        if (!data.fantasyName || data.fantasyName.trim() === '') {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Nome fantasia é obrigatório.",
                path: ['fantasyName'],
            });
        }
    } else {
       if (data.address.zipCode || data.address.street || data.address.number || data.address.neighborhood || data.address.city || data.address.state) {
            // Se um campo de endereço for preenchido, todos se tornam obrigatórios
            if (!data.address.zipCode) ctx.addIssue({ code: 'custom', message: 'CEP inválido.', path: ['address.zipCode'] });
            if (!data.address.street) ctx.addIssue({ code: 'custom', message: 'A rua é obrigatória.', path: ['address.street'] });
            if (!data.address.number) ctx.addIssue({ code: 'custom', message: 'O número é obrigatório.', path: ['address.number'] });
            if (!data.address.neighborhood) ctx.addIssue({ code: 'custom', message: 'O bairro é obrigatório.', path: ['address.neighborhood'] });
            if (!data.address.city) ctx.addIssue({ code: 'custom', message: 'A cidade é obrigatória.', path: ['address.city'] });
            if (!data.address.state) ctx.addIssue({ code: 'custom', message: 'UF inválido.', path: ['address.state'] });
       }
    }
});

type EntityFormValues = z.infer<typeof entitySchema>;

type DocumentSignatoryOption = {
    id: string;
    name: string;
    email: string;
};

const NO_DOCUMENT_SIGNATORY = '__none__';

const emptyEntityFormValues: EntityFormValues = {
    type: 'pessoa_fisica',
    name: '',
    fantasyName: '',
    nickname: '',
    document: '',
    address: { zipCode: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '' },
    contact: { phone: '', email: '', emails: [] },
    responsible: '',
    documentSignatoryUserId: '',
    documentSignatoryName: '',
    documentSignatoryEmail: '',
    documentSignatoryScope: 'entity',
    status: 'active',
    cadastralStatus: '',
    openingDate: '',
    legalNature: '',
    primaryCnaeCode: '',
    primaryCnaeDescription: '',
    stateRegistration: '',
    icmsTaxpayer: 'nao_informado',
    stateRegistrationStatus: 'nao_consultada',
    businessType: '',
    dataSource: 'manual',
    lastCnpjLookupAt: '',
    rg: '',
    birthDate: '',
    notes: '',
    imageUrl: '',
};

function getEntityFormValues(entity: Entity | null): EntityFormValues {
    if (!entity) return emptyEntityFormValues;

    const legacyEntity = entity as Entity & {
        cpf?: string;
        cnpj?: string;
        zipCode?: string;
        street?: string;
        number?: string;
        complement?: string;
        neighborhood?: string;
        city?: string;
        state?: string;
        phone?: string;
        email?: string;
    };

    return {
        type: entity.type ?? 'pessoa_fisica',
        name: entity.name ?? '',
        fantasyName: entity.fantasyName ?? '',
        nickname: entity.nickname ?? '',
        document: entity.document ?? legacyEntity.cnpj ?? legacyEntity.cpf ?? '',
        address: {
            zipCode: entity.address?.zipCode ?? legacyEntity.zipCode ?? '',
            street: entity.address?.street ?? legacyEntity.street ?? '',
            number: entity.address?.number ?? legacyEntity.number ?? '',
            complement: entity.address?.complement ?? legacyEntity.complement ?? '',
            neighborhood: entity.address?.neighborhood ?? legacyEntity.neighborhood ?? '',
            city: entity.address?.city ?? legacyEntity.city ?? '',
            state: entity.address?.state ?? legacyEntity.state ?? '',
        },
        contact: {
            phone: entity.contact?.phone ?? legacyEntity.phone ?? '',
            email: entity.contact?.email ?? legacyEntity.email ?? '',
            emails: (entity.contact?.emails ?? []).map((entry, index) => ({
                id: entry.id || `department-email-${index + 1}`,
                department: entry.department ?? '',
                email: entry.email ?? '',
                purposes: entry.purposes ?? [],
            })),
        },
        responsible: entity.responsible ?? '',
        documentSignatoryUserId: entity.documentSignatoryUserId ?? '',
        documentSignatoryName: entity.documentSignatoryName ?? '',
        documentSignatoryEmail: entity.documentSignatoryEmail ?? '',
        documentSignatoryScope: entity.documentSignatoryScope ?? 'entity',
        status: entity.status ?? 'active',
        cadastralStatus: entity.situacao_cadastral ?? '',
        openingDate: entity.data_abertura ?? '',
        legalNature: entity.natureza_juridica ?? '',
        primaryCnaeCode: entity.cnae_principal_codigo ?? '',
        primaryCnaeDescription: entity.cnae_principal_descricao ?? '',
        stateRegistration: entity.inscricao_estadual ?? '',
        icmsTaxpayer: entity.contribuinte_icms ?? 'nao_informado',
        stateRegistrationStatus: entity.situacao_inscricao_estadual ?? 'nao_consultada',
        businessType: entity.tipo_empresa ?? '',
        dataSource: entity.origem_dados ?? 'manual',
        lastCnpjLookupAt: entity.data_ultima_consulta_cnpj ?? '',
        rg: entity.rg ?? '',
        birthDate: entity.birthDate ?? '',
        notes: entity.notes ?? '',
        imageUrl: entity.imageUrl ?? '',
    };
}

function maskCnpjInput(value: string) {
    const digits = CnpjValidator.clean(value).slice(0, 14);
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
    if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
    if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
    return CnpjValidator.format(digits);
}

function companyFromForm(values: EntityFormValues, fallbackSource: NormalizedCompanyData['origem_dados'] = 'manual'): NormalizedCompanyData {
    const cnpj = CnpjValidator.clean(values.document ?? '');
    return {
        cnpj,
        razao_social: values.name ?? '',
        nome_fantasia: values.fantasyName ?? '',
        situacao_cadastral: values.cadastralStatus ?? '',
        data_abertura: values.openingDate ?? '',
        natureza_juridica: values.legalNature ?? '',
        cnae_principal_codigo: values.primaryCnaeCode ?? '',
        cnae_principal_descricao: values.primaryCnaeDescription ?? '',
        cnaes_secundarios: [],
        inscricao_estadual: values.stateRegistration ?? '',
        contribuinte_icms: values.icmsTaxpayer ?? 'nao_informado',
        situacao_inscricao_estadual: values.stateRegistrationStatus ?? 'nao_consultada',
        cep: values.address?.zipCode ?? '',
        logradouro: values.address?.street ?? '',
        numero: values.address?.number ?? '',
        complemento: values.address?.complement ?? '',
        bairro: values.address?.neighborhood ?? '',
        cidade: values.address?.city ?? '',
        uf: values.address?.state ?? '',
        telefone: values.contact?.phone ?? '',
        email: values.contact?.email ?? '',
        tipo_empresa: values.businessType ?? '',
        origem_dados: values.dataSource ?? fallbackSource,
        data_ultima_consulta: values.lastCnpjLookupAt || new Date().toISOString(),
        observacoes: values.notes ?? '',
    };
}

function entityPayloadFromForm(values: EntityFormValues): Omit<Entity, 'id'> & Record<string, unknown> {
    const cnpj = CnpjValidator.clean(values.document ?? '');
    const document = values.type === 'pessoa_juridica' && cnpj.length === 14 ? CnpjValidator.format(cnpj) : values.document;

    return {
        type: values.type,
        name: values.name,
        fantasyName: values.fantasyName,
        nickname: values.nickname,
        document,
        address: {
            street: values.address?.street ?? '',
            number: values.address?.number ?? '',
            complement: values.address?.complement ?? '',
            neighborhood: values.address?.neighborhood ?? '',
            city: values.address?.city ?? '',
            state: values.address?.state ?? '',
            zipCode: values.address?.zipCode ?? '',
        },
        contact: {
            phone: values.contact?.phone,
            email: values.contact?.email,
            emails: (values.contact?.emails ?? []).map((entry) => ({
                id: entry.id,
                department: entry.department.trim(),
                email: entry.email.trim().toLowerCase(),
                purposes: entry.purposes ?? [],
            })),
        },
        responsible: values.responsible,
        documentSignatoryUserId: values.type === 'pessoa_juridica'
            ? values.documentSignatoryUserId
            : undefined,
        documentSignatoryName: values.type === 'pessoa_juridica'
            ? values.documentSignatoryName
            : undefined,
        documentSignatoryEmail: values.type === 'pessoa_juridica'
            ? values.documentSignatoryEmail
            : undefined,
        documentSignatoryScope: values.type === 'pessoa_juridica'
            ? values.documentSignatoryScope
            : undefined,
        cnpjRoot: values.type === 'pessoa_juridica' && cnpj.length === 14
            ? cnpj.slice(0, 8)
            : undefined,
        status: values.status ?? 'active',
        rg: values.type === 'pessoa_fisica' ? values.rg : undefined,
        birthDate: values.type === 'pessoa_fisica' ? values.birthDate : undefined,
        notes: values.notes,
        imageUrl: values.imageUrl,
        cnpj: values.type === 'pessoa_juridica' ? cnpj : undefined,
        razao_social: values.type === 'pessoa_juridica' ? values.name : undefined,
        nome_fantasia: values.type === 'pessoa_juridica' ? values.fantasyName : undefined,
        situacao_cadastral: values.cadastralStatus,
        data_abertura: values.openingDate,
        natureza_juridica: values.legalNature,
        cnae_principal_codigo: values.primaryCnaeCode,
        cnae_principal_descricao: values.primaryCnaeDescription,
        cnaes_secundarios_json: [],
        inscricao_estadual: values.stateRegistration,
        contribuinte_icms: values.icmsTaxpayer ?? 'nao_informado',
        situacao_inscricao_estadual: values.stateRegistrationStatus ?? 'nao_consultada',
        cep: values.address?.zipCode ?? '',
        logradouro: values.address?.street ?? '',
        numero: values.address?.number ?? '',
        complemento: values.address?.complement ?? '',
        bairro: values.address?.neighborhood ?? '',
        cidade: values.address?.city ?? '',
        uf: values.address?.state ?? '',
        telefone: values.contact?.phone ?? '',
        email: values.contact?.email ?? '',
        tipo_empresa: values.businessType,
        origem_dados: values.dataSource ?? 'manual',
        data_ultima_consulta_cnpj: values.lastCnpjLookupAt,
        observacoes: values.notes,
    };
}

/** Redimensiona/comprime um data URL para caber no Firestore (avatar). */
function compressDataUrl(dataUrl: string, maxSide = 400, quality = 0.82): Promise<string> {
    return new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () => {
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = dataUrl;
    });
}

const ENTITY_WIZARD_STEPS = [
    { id: 1, label: 'Identificação', description: 'Tipo de cadastro, foto e documento. O tipo define os campos.' },
    { id: 2, label: 'Contato e endereço', description: 'Como falar com este cadastro e onde ele está localizado.' },
] as const;

const FIELD_INPUT = 'h-11 min-w-0 rounded-xl border-[#dcd9d1] bg-white px-3.5 text-sm shadow-none focus-visible:ring-[#5b5bd6]';
const FIELD_LABEL = 'text-xs font-bold text-[#4a4f57]';
const FIELD_ERROR = 'text-[11.5px] font-semibold text-[#b4232f]';

function OptionalHint({ children = 'opcional' }: { children?: React.ReactNode }) {
    return <span className="text-[11.5px] font-medium text-[#8a8f99]">{children}</span>;
}

function Segmented<T extends string>({ label, value, options, onChange, className }: {
    label: string;
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    onChange: (value: T) => void;
    className?: string;
}) {
    return (
        <div role="radiogroup" aria-label={label} className={cn('flex gap-[3px] rounded-[10px] bg-[#efede7] p-[3px]', className)}>
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onChange(option.value)}
                        className={cn('flex-1 whitespace-nowrap rounded-lg px-1.5 text-xs font-bold', selected ? 'bg-white text-[#15151c] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-[#70757d]')}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

function AddEditEntityModal({ open, onOpenChange, entityToEdit, initialStep = 1, initialFiscalOpen = false }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    entityToEdit: Entity | null;
    initialStep?: 1 | 2;
    initialFiscalOpen?: boolean;
}) {
    const { addEntity, updateEntity } = useEntities();
    const { firebaseUser, permissions } = useAuth();

    const [currentStep, setCurrentStep] = useState<number>(1);
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const [cnpjLookupLoading, setCnpjLookupLoading] = useState(false);
    const [lookupFeedback, setLookupFeedback] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [cnpjLookupResult, setCnpjLookupResult] = useState<CompanyLookupResponse | null>(null);
    const [loadedCompanyEntityId, setLoadedCompanyEntityId] = useState<string | null>(null);
    const [documentSignatoryOptions, setDocumentSignatoryOptions] = useState<DocumentSignatoryOption[]>([]);
    const [documentSignatoryLoading, setDocumentSignatoryLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [fiscalOpen, setFiscalOpen] = useState(false);
    const [pixKey, setPixKey] = useState('');
    const [initialPixKey, setInitialPixKey] = useState('');
    const [pixLoading, setPixLoading] = useState(false);
    const lastAutoLookupCnpjRef = useRef<string>('');

    const form = useForm<EntityFormValues>({
        resolver: zodResolver(entitySchema),
        defaultValues: emptyEntityFormValues,
    });

    useEffect(() => {
        if (!open) return;
        setCurrentStep(entityToEdit ? initialStep : 1);
        setFiscalOpen(entityToEdit ? initialFiscalOpen : false);
        form.reset(getEntityFormValues(entityToEdit));
        setLookupFeedback(null);
        setFormError(null);
        setCnpjLookupResult(null);
        setLoadedCompanyEntityId(entityToEdit?.id ?? null);
        setPixKey('');
        setInitialPixKey('');
        lastAutoLookupCnpjRef.current = CnpjValidator.clean(entityToEdit?.document ?? '');
    }, [entityToEdit, form, initialFiscalOpen, initialStep, open]);

    const paymentProfileEntityId = entityToEdit?.id ?? loadedCompanyEntityId;
    const canManagePix = Boolean(
        permissions.registration?.entities?.edit ||
        (!paymentProfileEntityId && permissions.registration?.entities?.add)
    );

    useEffect(() => {
        if (!open || !firebaseUser || !paymentProfileEntityId || !permissions.registration?.entities?.edit) return;
        let cancelled = false;
        setPixLoading(true);
        void (async () => {
            try {
                const response = await fetch(`/api/financial/beneficiaries/entities/${encodeURIComponent(paymentProfileEntityId)}`, {
                    headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
                    cache: 'no-store',
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(payload.error || 'Falha ao carregar a chave Pix.');
                if (!cancelled) {
                    const currentPixKey = String(payload.pixKey ?? '');
                    setPixKey(currentPixKey);
                    setInitialPixKey(currentPixKey);
                }
            } catch (error) {
                if (!cancelled) setFormError(error instanceof Error ? error.message : 'Falha ao carregar a chave Pix.');
            } finally {
                if (!cancelled) setPixLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [firebaseUser, open, paymentProfileEntityId, permissions.registration?.entities?.edit]);

    useEffect(() => {
        if (!open || !firebaseUser) return;
        let cancelled = false;
        setDocumentSignatoryLoading(true);
        void (async () => {
            try {
                const response = await fetch('/api/companies/document-signatories', {
                    headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
                    cache: 'no-store',
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(payload.error || 'Falha ao listar responsáveis.');
                if (!cancelled) setDocumentSignatoryOptions(payload.options ?? []);
            } catch (error) {
                if (!cancelled) {
                    setFormError(error instanceof Error ? error.message : 'Falha ao listar responsáveis.');
                    setDocumentSignatoryOptions([]);
                }
            } finally {
                if (!cancelled) setDocumentSignatoryLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [firebaseUser, open]);

    const entityType = form.watch('type');
    const statusWatch = form.watch('status') ?? 'active';
    const nameWatch = form.watch('name');
    const fantasyWatch = form.watch('fantasyName');
    const documentWatch = form.watch('document');
    const cleanCnpjWatch = entityType === 'pessoa_juridica' ? CnpjValidator.clean(documentWatch ?? '') : '';
    const imageUrlWatch = form.watch('imageUrl');
    const departmentEmails = form.watch('contact.emails') ?? [];
    const cadastralStatusWatch = form.watch('cadastralStatus') ?? '';
    const cnaeWatch = form.watch('primaryCnaeCode') ?? '';
    const stateRegistrationWatch = form.watch('stateRegistration') ?? '';
    const dataSourceWatch = form.watch('dataSource');
    const signatoryNameWatch = form.watch('documentSignatoryName') ?? '';
    const signatoryEmailWatch = form.watch('documentSignatoryEmail') ?? '';
    const phoneWatch = form.watch('contact.phone') ?? '';
    const birthDateWatch = form.watch('birthDate') ?? '';
    const cityWatch = form.watch('address.city') ?? '';
    const stateWatch = form.watch('address.state') ?? '';
    const isPF = entityType === 'pessoa_fisica';
    const isEdit = Boolean(entityToEdit);
    const active = statusWatch !== 'inactive';
    const attentionStatus = isAttentionCadastralStatus(cadastralStatusWatch);
    const fiscalFromLookup = Boolean(cnpjLookupResult) || ['brasilapi', 'cache', 'sintegra'].includes(dataSourceWatch ?? '');
    const initials = initialsOf(nameWatch || '') || '—';
    const heroName = (nameWatch || '').trim() || (isPF ? 'Nova pessoa' : 'Nova empresa');
    const cityState = cityWatch ? `${cityWatch}${stateWatch ? `/${stateWatch}` : ''}` : '';
    const hasPix = pixKey.trim().length > 0;

    const avatarClass = cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden font-extrabold tracking-[-.02em]',
        isPF ? 'rounded-full bg-[#dcfce7] text-[#166534]' : 'rounded-[18px] bg-[#dbeafe] text-[#1e40af]',
    );

    const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            setFormError('A foto precisa ter até 5MB.');
            return;
        }
        const reader = new FileReader();
        reader.onloadend = async () => {
            const compressed = await compressDataUrl(reader.result as string);
            form.setValue('imageUrl', compressed, { shouldDirty: true });
        };
        reader.readAsDataURL(file);
    };

    const handleNext = async () => {
        const fields: (keyof EntityFormValues)[] = ['name', 'document', ...(entityType === 'pessoa_juridica' ? (['fantasyName'] as (keyof EntityFormValues)[]) : [])];
        const valid = await form.trigger(fields);
        if (valid) setCurrentStep((s) => Math.min(ENTITY_WIZARD_STEPS.length, s + 1));
    };
    const handleBack = () => setCurrentStep((s) => Math.max(1, s - 1));
    const onInvalid = () => setCurrentStep(1);
    // Na edição as etapas são livres; no cadastro novo avançar valida nome e documento.
    const goToStep = (step: number) => {
        if (step > currentStep && !isEdit) void handleNext();
        else setCurrentStep(step);
    };

    const addDepartmentEmail = () => {
        form.setValue('contact.emails', [
            ...departmentEmails,
            { id: crypto.randomUUID(), department: '', email: '', purposes: [] },
        ], { shouldDirty: true });
    };

    const removeDepartmentEmail = (id: string) => {
        form.setValue('contact.emails', departmentEmails.filter((entry) => entry.id !== id), { shouldDirty: true });
    };

    const toggleDepartmentEmailPurpose = (index: number, purpose: EntityEmailPurpose) => {
        const current = departmentEmails[index];
        if (!current) return;
        const purposes = new Set(current.purposes ?? []);
        if (purposes.has(purpose)) purposes.delete(purpose);
        else purposes.add(purpose);
        form.setValue(`contact.emails.${index}.purposes`, [...purposes], { shouldDirty: true });
    };

    const handleZipCodeBlur = async (zipCode: string) => {
        const numericZipCode = zipCode.replace(/\D/g, '');
        if(numericZipCode.length !== 8) return;
        try {
            const res = await fetch(`https://viacep.com.br/ws/${numericZipCode}/json/`);
            if (!res.ok) {
                throw new Error('Falha ao buscar CEP');
            }
            const data = await res.json();
            if(!data.erro) {
                form.setValue('address.street', data.logradouro ?? '');
                form.setValue('address.neighborhood', data.bairro ?? '');
                form.setValue('address.city', data.localidade ?? '');
                form.setValue('address.state', data.uf ?? '');
            }
        } catch (error) {
            console.error("Failed to fetch address from CEP", error);
        }
    };

    const applyCompanyLookup = useCallback((payload: CompanyLookupResponse) => {
        const company = payload.company;
        if (!company) return;

        form.setValue('type', 'pessoa_juridica', { shouldDirty: true });
        form.setValue('document', CnpjValidator.format(company.cnpj), { shouldDirty: true });
        form.setValue('name', company.razao_social, { shouldDirty: true });
        form.setValue('fantasyName', company.nome_fantasia || company.razao_social, { shouldDirty: true });
        form.setValue('nickname', company.nome_fantasia || company.razao_social, { shouldDirty: true });
        form.setValue('cadastralStatus', company.situacao_cadastral, { shouldDirty: true });
        form.setValue('openingDate', company.data_abertura, { shouldDirty: true });
        form.setValue('legalNature', company.natureza_juridica, { shouldDirty: true });
        form.setValue('primaryCnaeCode', company.cnae_principal_codigo, { shouldDirty: true });
        form.setValue('primaryCnaeDescription', company.cnae_principal_descricao, { shouldDirty: true });
        form.setValue('stateRegistration', company.inscricao_estadual, { shouldDirty: true });
        form.setValue('icmsTaxpayer', company.contribuinte_icms, { shouldDirty: true });
        form.setValue('stateRegistrationStatus', company.situacao_inscricao_estadual, { shouldDirty: true });
        form.setValue('businessType', company.tipo_empresa, { shouldDirty: true });
        form.setValue('dataSource', company.origem_dados, { shouldDirty: true });
        form.setValue('lastCnpjLookupAt', company.data_ultima_consulta, { shouldDirty: true });
        form.setValue('address.zipCode', company.cep, { shouldDirty: true });
        form.setValue('address.street', company.logradouro, { shouldDirty: true });
        form.setValue('address.number', company.numero, { shouldDirty: true });
        form.setValue('address.complement', company.complemento, { shouldDirty: true });
        form.setValue('address.neighborhood', company.bairro, { shouldDirty: true });
        form.setValue('address.city', company.cidade, { shouldDirty: true });
        form.setValue('address.state', company.uf, { shouldDirty: true });
        form.setValue('contact.phone', company.telefone, { shouldDirty: true });
        form.setValue('contact.email', company.email, { shouldDirty: true });
        form.setValue('status', /baixad|inapt|suspens|inativa/i.test(company.situacao_cadastral) ? 'inactive' : 'active', { shouldDirty: true });
        if (company.observacoes) form.setValue('notes', company.observacoes, { shouldDirty: true });

        setLoadedCompanyEntityId(payload.entity?.id ?? company.id ?? null);
    }, [form]);

    const handleCnpjLookup = useCallback(async (options: { forceRefresh?: boolean; silentInvalid?: boolean } = {}) => {
        const document = form.getValues('document')?.trim();
        const validation = CnpjValidator.validate(document ?? '');
        setLookupFeedback(null);
        if (!document) {
            if (!options.silentInvalid) setLookupFeedback({ text: 'Informe o CNPJ antes de buscar.', tone: 'error' });
            return;
        }

        if (!validation.valid) {
            if (!options.silentInvalid || validation.clean.length === 14) {
                setLookupFeedback({ text: validation.message ?? 'CNPJ inválido. Verifique os números informados.', tone: 'error' });
            }
            return;
        }

        if (!firebaseUser) {
            setLookupFeedback({ text: 'Usuário não autenticado.', tone: 'error' });
            return;
        }

        setCnpjLookupLoading(true);
        try {
            const token = await firebaseUser.getIdToken();
            const endpoint = options.forceRefresh
                ? `/api/companies/cnpj/${encodeURIComponent(validation.clean)}/refresh`
                : `/api/companies/cnpj/${encodeURIComponent(validation.clean)}`;
            const response = await fetch(endpoint, {
                method: options.forceRefresh ? 'POST' : 'GET',
                headers: { Authorization: `Bearer ${token}` },
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || payload.error || 'Falha ao consultar CNPJ.');

            const lookup = payload as CompanyLookupResponse;
            setCnpjLookupResult(lookup);
            applyCompanyLookup(lookup);
            lastAutoLookupCnpjRef.current = validation.clean;
            setLookupFeedback({ text: lookup.message, tone: 'ok' });
        } catch (error) {
            setLookupFeedback({ text: error instanceof Error ? error.message : 'Falha ao consultar CNPJ.', tone: 'error' });
        } finally {
            setCnpjLookupLoading(false);
        }
    }, [applyCompanyLookup, firebaseUser, form]);

    useEffect(() => {
        if (!open || entityType !== 'pessoa_juridica') return;
        if (cleanCnpjWatch.length !== 14) return;
        if (cleanCnpjWatch === lastAutoLookupCnpjRef.current) return;

        const timeout = window.setTimeout(() => {
            void handleCnpjLookup({ silentInvalid: true });
        }, 650);

        return () => window.clearTimeout(timeout);
    }, [cleanCnpjWatch, entityType, handleCnpjLookup, open]);

    const onSubmit = async (values: EntityFormValues) => {
        const payload = entityPayloadFromForm(values);
        setSaving(true);
        setFormError(null);

        try {
            let savedEntityId = entityToEdit?.id ?? loadedCompanyEntityId ?? null;
            if (values.type === 'pessoa_juridica') {
                if (!firebaseUser) throw new Error('Usuário não autenticado.');
                if (isAttentionCadastralStatus(values.cadastralStatus)) {
                    const confirmed = window.confirm('A situação cadastral desta empresa exige atenção antes do cadastro. Deseja salvar mesmo assim?');
                    if (!confirmed) return;
                }
                const token = await firebaseUser.getIdToken();
                const targetId = entityToEdit?.id ?? loadedCompanyEntityId;
                const company = companyFromForm(values, cnpjLookupResult?.company?.origem_dados ?? cnpjLookupResult?.source ?? 'manual');
                const response = await fetch(targetId ? `/api/companies/${targetId}` : '/api/companies', {
                    method: targetId ? 'PUT' : 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(
                        targetId
                            ? { entity: payload }
                            : {
                                company,
                                entity: payload,
                                sourceResults: cnpjLookupResult?.sources ?? [],
                            },
                    ),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || 'Falha ao salvar empresa.');
                savedEntityId = String(result.id ?? targetId ?? '');
            } else if (entityToEdit) {
                await updateEntity({ ...entityToEdit, ...payload });
                savedEntityId = entityToEdit.id;
            } else {
                savedEntityId = await addEntity(payload);
            }
            if (savedEntityId && firebaseUser && canManagePix && pixKey.trim() !== initialPixKey.trim()) {
                const token = await firebaseUser.getIdToken();
                const response = await fetch(`/api/financial/beneficiaries/entities/${encodeURIComponent(savedEntityId)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ pixKey: pixKey.trim() }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || 'O cadastro foi salvo, mas não foi possível salvar a chave Pix.');
            }
            onOpenChange(false);
        } catch (error) {
            setFormError(error instanceof Error ? error.message : 'Falha ao salvar cadastro.');
        } finally {
            setSaving(false);
        }
    };

    // Avançar nunca envia o formulário: Enter nas etapas anteriores à última só avança.
    const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        if (currentStep < ENTITY_WIZARD_STEPS.length) {
            event.preventDefault();
            void handleNext();
            return;
        }
        void form.handleSubmit(onSubmit, onInvalid)(event);
    };

    const heroFacts: Array<{ label: string; value: string; tone?: string }> = [
        ...(isPF
            ? [
                { label: 'Nascimento', value: formatEntityDate(birthDateWatch) || '—' },
                { label: 'Telefone', value: phoneWatch || '—' },
            ]
            : [
                { label: 'Receita', value: cadastralStatusWatch || '—', tone: !cadastralStatusWatch ? 'text-[#8e8d99]' : attentionStatus ? 'text-[#fbbf24]' : 'text-[#6ee7b7]' },
                { label: 'Assinatura', value: signatoryNameWatch || '—' },
                { label: 'E-mails por setor', value: String(departmentEmails.length) },
            ]),
        ...(canManagePix ? [{ label: 'Pix', value: hasPix ? 'cadastrado' : '—', tone: hasPix ? 'text-[#6ee7b7]' : 'text-[#8e8d99]' }] : []),
    ];

    const stepSummary = (id: number) => {
        if (id === 1) return `${isPF ? 'Pessoa física' : 'Pessoa jurídica'} · ${documentWatch || 'sem documento'}`;
        const emailsPart = !isPF ? `${departmentEmails.length} e-mails por setor` : '';
        return [emailsPart, cityState].filter(Boolean).join(' · ') || 'Contato e endereço';
    };

    const fieldError = (message?: string) => (message ? <span className={FIELD_ERROR}>{message}</span> : null);
    const errors = form.formState.errors;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent hideClose className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] gap-0 overflow-y-auto overflow-x-hidden rounded-[26px] border-0 bg-[#faf9f6] p-0 sm:w-[calc(100vw-2rem)] sm:max-w-[1080px] sm:rounded-[26px]">
                <DialogDescription className="sr-only">Diretório de pessoas e empresas. Apenas dados de identidade e contato.</DialogDescription>
                <Form {...form}>
                    <form onSubmit={handleFormSubmit} className="grid min-h-0 grid-cols-1 lg:h-[800px] lg:grid-cols-[340px_minmax(0,1fr)]">
                        {/* Painel lateral com o resumo ao vivo */}
                        <aside className="flex min-h-0 flex-col gap-[22px] overflow-hidden bg-[#15151c] px-6 py-7 text-[#f3f2ee] sm:px-[26px] sm:py-[30px]">
                            <div className="flex flex-col gap-3.5">
                                <span className="text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#8e8d99]">
                                    {isEdit ? (isPF ? 'Editar pessoa' : 'Editar empresa') : 'Novo cadastro'}
                                </span>
                                <div className="flex items-center gap-3.5">
                                    <div className={cn(avatarClass, 'h-16 w-16 text-[22px]')}>
                                        {imageUrlWatch ? <Image src={imageUrlWatch} alt="" fill sizes="64px" className="object-cover" unoptimized /> : initials}
                                    </div>
                                    <div className="flex min-w-0 flex-col gap-1.5">
                                        <span className={cn('inline-flex items-center gap-1.5 self-start rounded-full px-[9px] py-[3px] text-[11px] font-extrabold', active ? 'bg-[rgba(52,211,153,.14)] text-[#6ee7b7]' : 'bg-white/10 text-[#a3a2ad]')}>
                                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                                            {active ? 'Ativo' : 'Inativo'}
                                        </span>
                                        <span className="truncate font-mono text-xs text-[#c8c7d0]">{documentWatch || (isPF ? 'CPF não informado' : 'CNPJ não informado')}</span>
                                    </div>
                                </div>
                                <h2 className="break-words text-[26px] font-extrabold leading-[1.08] tracking-[-.03em]">{heroName}</h2>
                                {!isPF && fantasyWatch ? <span className="-mt-1.5 break-words text-[12.5px] text-[#a3a2ad]">{fantasyWatch}</span> : null}
                            </div>

                            <div className="flex flex-col rounded-2xl border border-white/10 bg-white/5">
                                {heroFacts.map((fact) => (
                                    <div key={fact.label} className="flex items-center justify-between gap-2.5 border-t border-white/5 px-3.5 py-[11px] text-[12.5px] first:border-t-0">
                                        <span className="whitespace-nowrap text-[#8e8d99]">{fact.label}</span>
                                        <span className={cn('min-w-0 truncate text-right font-bold', fact.tone ?? 'text-white')}>{fact.value}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="flex flex-col gap-0.5">
                                <span className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#8e8d99]">Etapa {currentStep} de {ENTITY_WIZARD_STEPS.length}</span>
                                {ENTITY_WIZARD_STEPS.map((step) => {
                                    const isActive = step.id === currentStep;
                                    const isDone = step.id < currentStep;
                                    return (
                                        <button
                                            key={step.id}
                                            type="button"
                                            aria-current={isActive ? 'step' : undefined}
                                            onClick={() => goToStep(step.id)}
                                            className={cn('flex items-center gap-3 rounded-xl px-2.5 py-[9px] text-left', isActive ? 'bg-white/[.08] text-white' : 'text-[#c8c7d0] hover:bg-white/5')}
                                        >
                                            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-xs font-extrabold', isActive ? 'bg-[#b9b9ff] text-[#15151c]' : 'bg-white/[.08] text-[#c8c7d0]')}>
                                                {isDone ? <Check className="h-3.5 w-3.5" /> : step.id}
                                            </span>
                                            <span className="flex min-w-0 flex-col gap-px">
                                                <span className="text-[13.5px] font-bold">{step.label}</span>
                                                <span className="truncate text-[11.5px] text-[#8e8d99]">{stepSummary(step.id)}</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>

                            <span className="mt-auto text-[11.5px] leading-normal text-[#77768a]">Diretório de pessoas e empresas. Apenas dados de identidade e contato — sem relação com usuários do sistema.</span>
                        </aside>

                        <div className="flex min-h-0 flex-col">
                            <header className="flex items-start justify-between gap-4 border-b border-[#e6e2da] px-5 pb-4 pt-[22px] sm:px-7">
                                <div className="flex min-w-0 flex-col gap-1">
                                    <DialogTitle className="text-[21px] font-extrabold leading-tight tracking-[-.02em]">{ENTITY_WIZARD_STEPS[currentStep - 1].label}</DialogTitle>
                                    <span className="text-[13px] leading-normal text-[#70757d]">{ENTITY_WIZARD_STEPS[currentStep - 1].description}</span>
                                </div>
                                <div className="flex shrink-0 items-center gap-2.5">
                                    {currentStep === 1 ? (
                                        <FormField control={form.control} name="status" render={({ field }) => (
                                            <div role="radiogroup" aria-label="Status do cadastro" className="flex gap-0.5 rounded-full bg-[#efede7] p-[3px]">
                                                <button type="button" role="radio" aria-checked={field.value !== 'inactive'} onClick={() => field.onChange('active')} className={cn('h-[30px] rounded-full px-3 text-xs font-bold', field.value !== 'inactive' ? 'bg-[#dcfce7] text-[#15803d]' : 'text-[#70757d]')}>● Ativo</button>
                                                <button type="button" role="radio" aria-checked={field.value === 'inactive'} onClick={() => field.onChange('inactive')} className={cn('h-[30px] rounded-full px-3 text-xs font-bold', field.value === 'inactive' ? 'bg-white text-[#1a1b1f]' : 'text-[#70757d]')}>Inativo</button>
                                            </div>
                                        )}/>
                                    ) : null}
                                    <button type="button" aria-label="Fechar" onClick={() => onOpenChange(false)} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#efede7] text-[#4a4f57]"><X className="h-4 w-4" /></button>
                                </div>
                            </header>

                            <ScrollArea className="min-h-0 flex-1">
                                <div className="px-5 py-5 sm:px-7">
                                    {/* ETAPA 1 — Identificação */}
                                    {currentStep === 1 && (
                                        <div className="flex flex-col gap-[18px]">
                                            <div className="grid grid-cols-1 items-stretch gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                                                <FormField control={form.control} name="type" render={({ field }) => (
                                                    <>
                                                        {([
                                                            { value: 'pessoa_fisica', icon: User, title: 'Pessoa física', sub: 'Indivíduo · CPF' },
                                                            { value: 'pessoa_juridica', icon: Building, title: 'Pessoa jurídica', sub: 'Empresa · CNPJ' },
                                                        ] as const).map((opt) => {
                                                            const selected = field.value === opt.value;
                                                            return (
                                                                <button key={opt.value} type="button" role="radio" aria-checked={selected} onClick={() => field.onChange(opt.value)}
                                                                    className={cn('flex items-center gap-3 rounded-[14px] bg-white px-3.5 py-3 text-left text-[#15151c]', selected ? 'border-2 border-[#15151c]' : 'border border-[#dcd9d1]')}>
                                                                    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]', selected ? 'bg-[#15151c] text-white' : 'bg-[#efede7] text-[#70757d]')}>
                                                                        <opt.icon className="h-4 w-4" />
                                                                    </span>
                                                                    <span className="flex flex-col gap-px">
                                                                        <span className="text-sm font-extrabold">{opt.title}</span>
                                                                        <span className="text-[11.5px] text-[#8a8f99]">{opt.sub}</span>
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}
                                                    </>
                                                )}/>
                                                <div className="flex items-center gap-2.5 rounded-[14px] border border-dashed border-[#d6d2c8] bg-[#faf9f6] px-3 py-2">
                                                    <div className={cn(avatarClass, 'h-10 w-10 text-sm', isPF ? '' : 'rounded-[11px]')}>
                                                        {imageUrlWatch ? <Image src={imageUrlWatch} alt="" fill sizes="40px" className="object-cover" unoptimized /> : initials}
                                                    </div>
                                                    <div className="flex flex-col gap-0.5">
                                                        <button type="button" onClick={() => imageUrlWatch ? form.setValue('imageUrl', '', { shouldDirty: true }) : avatarInputRef.current?.click()} className="whitespace-nowrap text-left text-[12.5px] font-bold text-[#1a1b1f]">
                                                            {imageUrlWatch ? 'Remover foto' : 'Enviar foto'}
                                                        </button>
                                                        <span className="whitespace-nowrap text-[10.5px] text-[#8a8f99]">JPG ou PNG · até 5MB</span>
                                                    </div>
                                                </div>
                                                <input type="file" ref={avatarInputRef} className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                                            </div>

                                            {isPF ? (
                                                <div className="flex flex-col gap-3.5">
                                                    <FormField control={form.control} name="name" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FIELD_LABEL}>Nome completo <span className="text-[#e11d48]">*</span></FormLabel><FormControl><Input {...field} className={cn(FIELD_INPUT, 'font-bold')} /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                                        <FormField control={form.control} name="document" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FIELD_LABEL}>CPF <span className="text-[#e11d48]">*</span></FormLabel><FormControl><Input {...field} placeholder="000.000.000-00" className={cn(FIELD_INPUT, 'font-mono font-bold')} /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                        <FormField control={form.control} name="rg" render={({ field }) => (<FormItem className="space-y-1.5"><div className="flex items-center justify-between"><FormLabel className={FIELD_LABEL}>RG</FormLabel><OptionalHint /></div><FormControl><Input {...field} value={field.value ?? ''} className={cn(FIELD_INPUT, 'font-mono')} /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                        <FormField control={form.control} name="birthDate" render={({ field }) => (<FormItem className="space-y-1.5"><div className="flex items-center justify-between"><FormLabel className={FIELD_LABEL}>Data de nascimento</FormLabel><OptionalHint /></div><FormControl><Input type="date" {...field} value={field.value ?? ''} className={FIELD_INPUT} /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                        <FormField control={form.control} name="nickname" render={({ field }) => (<FormItem className="space-y-1.5"><div className="flex items-center justify-between"><FormLabel className={FIELD_LABEL}>Apelido</FormLabel><OptionalHint>busca interna</OptionalHint></div><FormControl><Input {...field} value={field.value ?? ''} className={FIELD_INPUT} /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-4">
                                                    {/* CNPJ primeiro: a consulta preenche o restante do cadastro */}
                                                    <FormField control={form.control} name="document" render={({ field }) => (
                                                        <FormItem className="flex flex-col gap-2.5 space-y-0 rounded-[18px] bg-[#15151c] p-4 text-[#f3f2ee]">
                                                            <div className="flex items-baseline justify-between gap-2.5">
                                                                <FormLabel className="text-xs font-bold text-[#c8c7d0]">CNPJ <span className="text-[#f08bb1]">*</span></FormLabel>
                                                                <span className="text-[11px] text-[#8e8d99]">consulta automática ao completar 14 dígitos</span>
                                                            </div>
                                                            <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                                                                <FormControl>
                                                                    <Input
                                                                        {...field}
                                                                        inputMode="numeric"
                                                                        placeholder="00.000.000/0000-00"
                                                                        value={field.value ?? ''}
                                                                        onChange={(event) => field.onChange(maskCnpjInput(event.target.value))}
                                                                        onBlur={(event) => {
                                                                            field.onBlur();
                                                                            if (CnpjValidator.clean(event.target.value).length === 14) {
                                                                                void handleCnpjLookup({ silentInvalid: true });
                                                                            }
                                                                        }}
                                                                        className="h-12 min-w-0 flex-1 rounded-xl border-white/10 bg-white/[.07] px-4 font-mono text-[17px] font-bold tracking-[.02em] text-white shadow-none placeholder:text-white/30 focus-visible:ring-[#b9b9ff]"
                                                                    />
                                                                </FormControl>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleCnpjLookup()}
                                                                    disabled={cnpjLookupLoading}
                                                                    className="flex h-12 items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#f3f2ee] px-4 text-[13px] font-extrabold text-[#15151c] disabled:opacity-60"
                                                                >
                                                                    {cnpjLookupLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                                                                    Consultar
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleCnpjLookup({ forceRefresh: true })}
                                                                    disabled={cnpjLookupLoading || cleanCnpjWatch.length !== 14}
                                                                    className="flex h-12 items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/15 px-3.5 text-[13px] font-bold text-[#f3f2ee] disabled:opacity-40"
                                                                >
                                                                    <RefreshCw className="h-3.5 w-3.5" />
                                                                    Atualizar
                                                                </button>
                                                            </div>
                                                            {cnpjLookupLoading ? <p className="text-xs text-[#c8c7d0]">Buscando dados da empresa...</p> : null}
                                                            {lookupFeedback ? (
                                                                <p className={cn('flex items-center gap-2 text-xs', lookupFeedback.tone === 'ok' ? 'text-[#6ee7b7]' : 'text-[#fda4af]')}>
                                                                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', lookupFeedback.tone === 'ok' ? 'bg-[#34d399]' : 'bg-[#fb7185]')} />
                                                                    {lookupFeedback.text}
                                                                </p>
                                                            ) : null}
                                                            <FormMessage className="text-xs font-semibold text-[#fda4af]" />
                                                        </FormItem>
                                                    )}/>

                                                    {cnpjLookupResult?.alerts?.length ? (
                                                        <div className="flex flex-col gap-2">
                                                            {cnpjLookupResult.alerts.map((alert, index) => (
                                                                <div
                                                                    key={`${alert.message}-${index}`}
                                                                    role="alert"
                                                                    className={cn(
                                                                        'flex gap-2.5 rounded-[14px] border px-3.5 py-3',
                                                                        alert.type === 'error' ? 'border-[#f3c2c8] bg-[#fdecee] text-[#8f1d28]' : alert.type === 'warning' ? 'border-[#f5d9a3] bg-[#fff7e6] text-[#6b4500]' : 'border-[#e6e2da] bg-white text-[#4a4f57]',
                                                                    )}
                                                                >
                                                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                                                    <div className="flex flex-col gap-0.5">
                                                                        <b className="text-[13px]">{alert.type === 'warning' ? 'Atenção' : alert.type === 'error' ? 'Erro' : 'Informação'}</b>
                                                                        <span className="text-[12.5px] leading-snug">{alert.message}</span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : null}

                                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                                                        <FormField control={form.control} name="name" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FIELD_LABEL}>Razão social <span className="text-[#e11d48]">*</span></FormLabel><FormControl><Input {...field} className={cn(FIELD_INPUT, 'font-bold')} /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                        <FormField control={form.control} name="fantasyName" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FIELD_LABEL}>Nome fantasia <span className="text-[#e11d48]">*</span></FormLabel><FormControl><Input {...field} value={field.value ?? ''} className={FIELD_INPUT} /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                    </div>
                                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                                        <FormField control={form.control} name="responsible" render={({ field }) => (<FormItem className="space-y-1.5"><div className="flex items-center justify-between"><FormLabel className={FIELD_LABEL}>Responsável cadastral</FormLabel><OptionalHint /></div><FormControl><Input {...field} value={field.value ?? ''} className={FIELD_INPUT} /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                        <FormField control={form.control} name="nickname" render={({ field }) => (<FormItem className="space-y-1.5"><div className="flex items-center justify-between"><FormLabel className={FIELD_LABEL}>Apelido</FormLabel><OptionalHint>busca interna</OptionalHint></div><FormControl><Input {...field} value={field.value ?? ''} className={FIELD_INPUT} /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                    </div>

                                                    <div className="flex flex-col gap-3 rounded-[18px] border border-[#e3dcf7] bg-[#f8f6ff] p-4">
                                                        <div className="flex flex-col gap-0.5">
                                                            <span className="text-sm font-extrabold">Responsável pela assinatura documental</span>
                                                            <span className="text-xs text-[#70757d]">Esta pessoa assina pela empresa nos documentos enviados à Autentique.</span>
                                                        </div>
                                                        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                                                            <FormField control={form.control} name="documentSignatoryUserId" render={({ field }) => (
                                                                <FormItem className="space-y-1.5">
                                                                    <FormLabel className={FIELD_LABEL}>Pessoa responsável</FormLabel>
                                                                    <Select
                                                                        value={field.value || NO_DOCUMENT_SIGNATORY}
                                                                        disabled={documentSignatoryLoading}
                                                                        onValueChange={(value) => {
                                                                            if (value === NO_DOCUMENT_SIGNATORY) {
                                                                                field.onChange('');
                                                                                form.setValue('documentSignatoryName', '');
                                                                                form.setValue('documentSignatoryEmail', '');
                                                                                return;
                                                                            }
                                                                            const option = documentSignatoryOptions.find((item) => item.id === value);
                                                                            field.onChange(value);
                                                                            form.setValue('documentSignatoryName', option?.name ?? '');
                                                                            form.setValue('documentSignatoryEmail', option?.email ?? '');
                                                                        }}
                                                                    >
                                                                        <FormControl>
                                                                            <SelectTrigger className={cn(FIELD_INPUT, 'shadow-none')}>
                                                                                <SelectValue placeholder="Selecione..." />
                                                                            </SelectTrigger>
                                                                        </FormControl>
                                                                        <SelectContent>
                                                                            <SelectItem value={NO_DOCUMENT_SIGNATORY}>Sem responsável definido</SelectItem>
                                                                            {documentSignatoryOptions.map((option) => (
                                                                                <SelectItem key={option.id} value={option.id}>
                                                                                    {option.name} · {option.email}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <FormMessage className={FIELD_ERROR} />
                                                                </FormItem>
                                                            )}/>
                                                            <FormField control={form.control} name="documentSignatoryScope" render={({ field }) => (
                                                                <FormItem className="space-y-1.5">
                                                                    <FormLabel className={FIELD_LABEL}>Abrangência</FormLabel>
                                                                    <Segmented
                                                                        label="Abrangência da assinatura"
                                                                        value={(field.value ?? 'entity') as 'entity' | 'cnpj_root'}
                                                                        options={ENTITY_SIGNATORY_SCOPES}
                                                                        onChange={field.onChange}
                                                                        className="h-11 rounded-xl bg-[#ece8f8] p-1"
                                                                    />
                                                                    <FormMessage className={FIELD_ERROR} />
                                                                </FormItem>
                                                            )}/>
                                                        </div>
                                                        {signatoryEmailWatch ? (
                                                            <span className="text-xs font-semibold text-[#5b21b6]">Convites de assinatura: {signatoryNameWatch} · {signatoryEmailWatch}</span>
                                                        ) : null}
                                                    </div>

                                                    {/* Dados fiscais recolhidos: a consulta já os preenche */}
                                                    <div className="overflow-hidden rounded-[18px] border border-[#e6e2da] bg-white">
                                                        <button type="button" aria-expanded={fiscalOpen} onClick={() => setFiscalOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                                                            <span className="flex min-w-0 flex-col gap-0.5">
                                                                <span className="text-sm font-extrabold">Dados fiscais e da Receita</span>
                                                                <span className="truncate text-xs text-[#8a8f99]">{cadastralStatusWatch || '—'} · CNAE {cnaeWatch || '—'} · IE {stateRegistrationWatch || '—'}</span>
                                                            </span>
                                                            <span className="flex shrink-0 items-center gap-2">
                                                                {fiscalFromLookup ? <span className="whitespace-nowrap rounded-full bg-[#dcf5e8] px-[9px] py-[3px] text-[11px] font-bold text-[#0f6b46]">preenchido pela consulta</span> : null}
                                                                {fiscalOpen ? <ChevronUp className="h-3.5 w-3.5 text-[#8a8f99]" /> : <ChevronDown className="h-3.5 w-3.5 text-[#8a8f99]" />}
                                                            </span>
                                                        </button>
                                                        {fiscalOpen ? (
                                                            <div className="grid grid-cols-1 gap-3 border-t border-[#f0ede7] px-4 pb-4 pt-3.5 md:grid-cols-3">
                                                                <FormField control={form.control} name="cadastralStatus" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">Situação cadastral</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 text-[13px] shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                                <FormField control={form.control} name="openingDate" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">Data de abertura</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 text-[13px] shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                                <FormField control={form.control} name="businessType" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">Tipo de fornecedor</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="Fornecedor, cliente, serviço..." className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 text-[13px] shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                                <FormField control={form.control} name="primaryCnaeCode" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">CNAE principal</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 font-mono text-[13px] shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                                <FormField control={form.control} name="primaryCnaeDescription" render={({ field }) => (<FormItem className="space-y-1.5 md:col-span-2"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">Descrição do CNAE</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 text-[13px] shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                                <FormField control={form.control} name="legalNature" render={({ field }) => (<FormItem className="space-y-1.5 md:col-span-2"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">Natureza jurídica</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 text-[13px] shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                                <FormField control={form.control} name="stateRegistration" render={({ field }) => (<FormItem className="space-y-1.5"><div className="flex items-center justify-between"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">Inscrição estadual</FormLabel><OptionalHint /></div><FormControl><Input {...field} value={field.value ?? ''} className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 font-mono text-[13px] shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                                <FormField control={form.control} name="icmsTaxpayer" render={({ field }) => (
                                                                    <FormItem className="space-y-1.5">
                                                                        <FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">Contribuinte ICMS</FormLabel>
                                                                        <Segmented label="Contribuinte ICMS" value={field.value ?? 'nao_informado'} options={ENTITY_ICMS_OPTIONS} onChange={field.onChange} className="h-10" />
                                                                        <FormMessage className={FIELD_ERROR} />
                                                                    </FormItem>
                                                                )}/>
                                                                <FormField control={form.control} name="stateRegistrationStatus" render={({ field }) => (
                                                                    <FormItem className="space-y-1.5 md:col-span-2">
                                                                        <FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">Situação IE</FormLabel>
                                                                        <Segmented label="Situação da inscrição estadual" value={field.value ?? 'nao_consultada'} options={ENTITY_IE_STATUS_OPTIONS} onChange={field.onChange} className="h-10 overflow-x-auto" />
                                                                        <FormMessage className={FIELD_ERROR} />
                                                                    </FormItem>
                                                                )}/>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ETAPA 2 — Contato e endereço */}
                                    {currentStep === 2 && (
                                        <div className="flex flex-col gap-4">
                                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                                <FormField control={form.control} name="contact.email" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FIELD_LABEL}>E-mail principal</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className={FIELD_INPUT} /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                <FormField control={form.control} name="contact.phone" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FIELD_LABEL}>Telefone / WhatsApp</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className={cn(FIELD_INPUT, 'font-mono')} /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                            </div>

                                            {!isPF ? (
                                                <div className="flex flex-col gap-3 rounded-[18px] border border-[#e6e2da] bg-white p-4">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex flex-col gap-0.5">
                                                            <span className="text-sm font-extrabold">E-mails por setor</span>
                                                            <span className="text-xs text-[#70757d]">Usados nos envios automáticos de Integração, Desligamento, ASO e Férias.</span>
                                                        </div>
                                                        <button type="button" onClick={addDepartmentEmail} className="flex h-[34px] items-center gap-1 whitespace-nowrap rounded-[10px] border border-[#dcd9d1] bg-white px-3 text-[12.5px] font-bold">
                                                            <Plus className="h-3.5 w-3.5" /> Adicionar e-mail
                                                        </button>
                                                    </div>
                                                    {departmentEmails.map((entry, index) => (
                                                        <div key={entry.id} className="flex flex-col gap-2 rounded-xl border border-[#efece5] bg-[#faf9f6] p-2.5">
                                                            <div className="grid grid-cols-1 items-start gap-2.5 sm:grid-cols-[150px_minmax(0,1fr)_28px]">
                                                                <div className="flex flex-col gap-1">
                                                                    <Input {...form.register(`contact.emails.${index}.department` as const)} aria-label="Setor" placeholder="Ex.: Pessoal" className="h-[38px] rounded-[9px] border-[#dcd9d1] bg-white px-2.5 text-[13px] font-bold shadow-none" />
                                                                    {fieldError(errors.contact?.emails?.[index]?.department?.message)}
                                                                </div>
                                                                <div className="flex flex-col gap-1">
                                                                    <Input type="email" {...form.register(`contact.emails.${index}.email` as const)} aria-label="E-mail do setor" placeholder="setor@empresa.com.br" className="h-[38px] rounded-[9px] border-[#dcd9d1] bg-white px-2.5 text-[13px] shadow-none" />
                                                                    {fieldError(errors.contact?.emails?.[index]?.email?.message)}
                                                                </div>
                                                                <button type="button" onClick={() => removeDepartmentEmail(entry.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[#b4232f] hover:bg-[#fdecee]" aria-label="Remover e-mail setorial">
                                                                    <Trash2 className="h-4 w-4" />
                                                                </button>
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Usar em">
                                                                <span className="mr-1 text-[11px] font-semibold text-[#8a8f99]">Usar em:</span>
                                                                {ENTITY_EMAIL_PURPOSES.map(([purpose, label]) => {
                                                                    const on = (entry.purposes ?? []).includes(purpose);
                                                                    return (
                                                                        <button key={purpose} type="button" aria-pressed={on} onClick={() => toggleDepartmentEmailPurpose(index, purpose)} className={cn('h-7 whitespace-nowrap rounded-full border px-[9px] text-[11px] font-bold', on ? 'border-[#15151c] bg-[#15151c] text-white' : 'border-[#dcd9d1] bg-white text-[#70757d]')}>
                                                                            {label}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {departmentEmails.length === 0 ? <p className="rounded-xl border border-dashed border-[#d6d2c8] px-3 py-4 text-center text-xs text-[#70757d]">Nenhum e-mail setorial cadastrado.</p> : null}
                                                </div>
                                            ) : null}

                                            {canManagePix ? (
                                                <div className="flex flex-col gap-2.5 rounded-[18px] border border-[#c9e9d9] bg-[#f0faf5] p-4">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex flex-col gap-0.5">
                                                            <span className="text-sm font-extrabold">Dados para pagamento</span>
                                                            <span className="text-xs text-[#3f7d63]">Cadastros ativos com chave Pix preenchida ficam disponíveis para pagamento.</span>
                                                        </div>
                                                        {hasPix && active ? <span className="whitespace-nowrap rounded-full border border-[#b7e4cd] bg-[#dcf5e8] px-[9px] py-0.5 text-[11px] font-bold text-[#0f6b46]">disponível p/ pagamento</span> : null}
                                                    </div>
                                                    <label className="flex flex-col gap-1.5">
                                                        <span className="text-xs font-bold text-[#0f4a33]">Chave Pix <span className="font-medium text-[#3f7d63]">(opcional)</span></span>
                                                        <Input
                                                            value={pixKey}
                                                            onChange={(event) => setPixKey(event.target.value)}
                                                            disabled={pixLoading}
                                                            placeholder={pixLoading ? 'Carregando chave Pix...' : 'CPF, CNPJ, e-mail, telefone ou chave aleatória'}
                                                            autoComplete="off"
                                                            className="h-11 min-w-0 rounded-xl border-[#b7e4cd] bg-white px-3.5 font-mono text-[13.5px] shadow-none"
                                                        />
                                                        <span className="text-xs text-[#3f7d63]">A chave é exibida sem máscara somente nesta edição e permanece criptografada no armazenamento.</span>
                                                    </label>
                                                </div>
                                            ) : null}

                                            <div className="flex flex-col gap-3 rounded-[18px] border border-[#e6e2da] bg-white p-4">
                                                <div className="flex items-baseline justify-between gap-2.5">
                                                    <span className="text-sm font-extrabold">Endereço</span>
                                                    <span className="text-[11.5px] text-[#8a8f99]">CEP preenche o restante (ViaCEP)</span>
                                                </div>
                                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[150px_minmax(0,1fr)_110px]">
                                                    <FormField control={form.control} name="address.zipCode" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">CEP</FormLabel><FormControl><Input {...field} value={field.value ?? ''} onBlur={(e) => { field.onBlur(); void handleZipCodeBlur(e.target.value); }} className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 font-mono text-[13px] shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                    <FormField control={form.control} name="address.street" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">Logradouro</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 text-[13px] shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                    <FormField control={form.control} name="address.number" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">Número</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 text-[13px] shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                </div>
                                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_70px]">
                                                    <FormField control={form.control} name="address.complement" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">Complemento</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 text-[13px] shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                    <FormField control={form.control} name="address.neighborhood" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">Bairro</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 text-[13px] shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                    <FormField control={form.control} name="address.city" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">Cidade</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 text-[13px] shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                    <FormField control={form.control} name="address.state" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className="text-[11.5px] font-bold text-[#4a4f57]">UF</FormLabel><FormControl><Input maxLength={2} {...field} value={field.value ?? ''} className="h-10 rounded-[10px] border-[#dcd9d1] bg-[#faf9f6] px-3 text-[13px] uppercase shadow-none" /></FormControl><FormMessage className={FIELD_ERROR} /></FormItem>)}/>
                                                </div>
                                            </div>

                                            <FormField control={form.control} name="notes" render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={FIELD_LABEL}>Observações</FormLabel>
                                                    <FormControl><Textarea {...field} value={field.value ?? ''} placeholder="Anotações sobre este cadastro..." className="min-h-[72px] resize-y rounded-xl border-[#dcd9d1] bg-white px-3 py-2.5 text-[13px] shadow-none" /></FormControl>
                                                    <FormMessage className={FIELD_ERROR} />
                                                </FormItem>
                                            )}/>
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>

                            {formError ? (
                                <div role="alert" className="flex items-start gap-2 border-t border-[#f3c2c8] bg-[#fdecee] px-5 py-2.5 text-[12.5px] font-semibold text-[#8f1d28] sm:px-7">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span className="min-w-0 break-words">{formError}</span>
                                </div>
                            ) : null}
                            <footer className="flex items-center justify-between gap-3 border-t border-[#e6e2da] bg-[#faf9f6] px-5 py-4 sm:px-7">
                                <button type="button" onClick={() => onOpenChange(false)} className="h-11 whitespace-nowrap rounded-xl px-3.5 text-[13.5px] font-bold text-[#70757d] hover:bg-[#efede7]">Cancelar</button>
                                <div className="flex items-center gap-2.5">
                                    {currentStep > 1 ? (
                                        <button type="button" onClick={handleBack} className="flex h-11 items-center gap-1 whitespace-nowrap rounded-xl border border-[#dcd9d1] bg-white px-4 text-[13.5px] font-bold">
                                            <ChevronLeft className="h-4 w-4" /> Voltar
                                        </button>
                                    ) : null}
                                    {currentStep < ENTITY_WIZARD_STEPS.length ? (
                                        <button type="button" onClick={() => void handleNext()} className="flex h-11 items-center gap-1 whitespace-nowrap rounded-xl bg-[#15151c] px-[22px] text-sm font-extrabold text-white">
                                            Avançar <ChevronRight className="h-4 w-4" />
                                        </button>
                                    ) : (
                                        <button type="submit" disabled={saving} className="flex h-11 items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#15151c] px-[22px] text-sm font-extrabold text-white disabled:opacity-60">
                                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                            {isEdit || loadedCompanyEntityId ? 'Salvar alterações' : 'Adicionar'}
                                        </button>
                                    )}
                                </div>
                            </footer>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

const LIST_TEMPLATE = 'minmax(0,2.2fr) 110px 170px minmax(0,1.6fr) 130px 20px';

type EntityTag = { label: string; tone: Tone };

function entityTags(entity: Entity, aso: { active: boolean } | undefined): EntityTag[] {
  const tags: EntityTag[] = [];
  if (entity.nickname) tags.push({ label: entity.nickname, tone: 'neutral' });
  if (entity.documentSignatoryName) {
    tags.push({
      label: `Assina: ${entity.documentSignatoryName}${entity.documentSignatoryScope === 'cnpj_root' ? ' · matriz e filiais' : ''}`,
      tone: 'violet',
    });
  }
  if (aso) tags.push({ label: aso.active ? 'Clínica ASO' : 'Clínica ASO inativa', tone: aso.active ? 'ok' : 'neutral' });
  if (entity.status === 'inactive') tags.push({ label: 'Inativo', tone: 'warn' });
  return tags;
}

function entityContacts(entity: Entity): string[] {
  return [
    entity.contact?.email,
    ...(entity.contact?.emails ?? []).map((entry) => `${entry.department}: ${entry.email}`),
    entity.contact?.phone,
  ].filter((value): value is string => Boolean(value));
}

const entityCity = (entity: Entity) =>
  entity.address?.city ? `${entity.address.city}${entity.address.state ? `/${entity.address.state}` : ''}` : '—';

export function EntityManagement({ tabs, view, onViewChange }: CadastrosTabProps) {
  const { entities, loading, deleteEntity } = useEntities();
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [entityToEdit, setEntityToEdit] = useState<Entity | null>(null);
  const [asoEntity, setAsoEntity] = useState<Entity | null>(null);
  const [asoClinicStatuses, setAsoClinicStatuses] = useState<Record<string, { active: boolean }>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [status, setStatus] = useState<CadastrosStatus>('active');
  const [chip, setChip] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EntityFichaEditTarget>({ step: 1 });
  const [pendingInactivate, setPendingInactivate] = useState<Entity | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const canViewAsoClinics = hasFormalizationPermission(permissions, 'aso.view');
  const canManageAsoClinics = hasFormalizationPermission(permissions, 'aso.manage');

  const loadAsoClinicStatuses = useCallback(async () => {
    if (!firebaseUser || !canViewAsoClinics) {
      setAsoClinicStatuses({});
      return;
    }
    try {
      const response = await fetch('/api/hr/aso-clinics', {
        headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = await response.json();
      setAsoClinicStatuses(Object.fromEntries(
        (payload.clinics ?? []).map((clinic: { entityId: string; active: boolean }) => [clinic.entityId, { active: clinic.active }]),
      ));
    } catch {
      // O diretório principal continua disponível mesmo se a extensão de ASO falhar.
    }
  }, [canViewAsoClinics, firebaseUser]);

  useEffect(() => { void loadAsoClinicStatuses(); }, [loadAsoClinicStatuses]);

  const isInactive = (entity: Entity) => entity.status === 'inactive';
  const inStatus = useMemo(
    () => entities.filter((entity) => (status === 'inactive' ? isInactive(entity) : !isInactive(entity))),
    [entities, status],
  );
  const searchLower = searchTerm.trim().toLowerCase();
  const searched = useMemo(() => {
    if (!searchLower) return inStatus;
    return inStatus.filter((entity) =>
      entity.name.toLowerCase().includes(searchLower) ||
      (entity.fantasyName ?? '').toLowerCase().includes(searchLower) ||
      (entity.nickname ?? '').toLowerCase().includes(searchLower) ||
      (entity.document ?? '').includes(searchLower) ||
      (entity.contact?.email ?? '').toLowerCase().includes(searchLower) ||
      (entity.contact?.phone ?? '').includes(searchLower),
    );
  }, [inStatus, searchLower]);
  const shown = useMemo(() => searched.filter((entity) => chip === 'all' || entity.type === chip), [searched, chip]);

  const chips = useMemo(() => {
    const counts = countByKey(searched, (entity) => entity.type);
    return buildChips(searched.length, [
      { id: 'pessoa_juridica', label: 'Empresa', count: counts.get('pessoa_juridica') ?? 0 },
      { id: 'pessoa_fisica', label: 'Pessoa física', count: counts.get('pessoa_fisica') ?? 0 },
    ], chip);
  }, [searched, chip]);

  const activeCount = entities.filter((entity) => !isInactive(entity)).length;
  const inactiveCount = entities.length - activeCount;
  const opened = openId ? entities.find((entity) => entity.id === openId) ?? null : null;
  const displayName = (entity: Entity) => entity.fantasyName || entity.name;

  const closeFicha = () => { setOpenId(null); setPendingInactivate(null); };
  const changeStatus = (next: CadastrosStatus) => { setStatus(next); setChip('all'); closeFicha(); };
  const handleAddNew = () => { setEntityToEdit(null); setEditTarget({ step: 1 }); setIsModalOpen(true); };
  const handleEdit = (entity: Entity, target: EntityFichaEditTarget = { step: 1 }) => {
    closeFicha();
    setEntityToEdit(entity);
    setEditTarget(target);
    setIsModalOpen(true);
  };

  const confirmInactivate = async () => {
    const entity = pendingInactivate;
    if (!entity) return;
    setIsBusy(true);
    try {
      await deleteEntity(entity.id);
      closeFicha();
      toast({ title: `${displayName(entity)} inativado.` });
    } catch (error) {
      toast({ title: 'Não foi possível inativar.', description: error instanceof Error ? error.message : 'Tente novamente.', variant: 'destructive' });
    } finally {
      setIsBusy(false);
      setPendingInactivate(null);
    }
  };

  const typeLabel = (entity: Entity) => (entity.type === 'pessoa_juridica' ? 'Empresa' : 'Pessoa física');
  const typeTone = (entity: Entity) => (entity.type === 'pessoa_juridica' ? 'text-[#a6325b]' : 'text-[#4646b8]');
  const avatarTone = (entity: Entity) =>
    entity.type === 'pessoa_juridica' ? 'bg-[#fbe7ef] text-[#a6325b]' : 'bg-[#e8e8fb] text-[#4646b8]';

  return (
    <>
      <div className="flex flex-col gap-4">
        <CadastrosHero
          kicker="Cadastros operacionais"
          tabs={tabs}
          search={{ value: searchTerm, onChange: setSearchTerm, placeholder: 'Buscar por nome, CPF/CNPJ, e-mail ou telefone' }}
          status={{ value: status, onChange: changeStatus, activeCount, inactiveCount, inactiveLabel: 'Inativos' }}
          primary={{ label: 'Adicionar cadastro', onClick: handleAddNew }}
          chips={chips}
          activeChip={chip}
          onChip={setChip}
        />

        <ResultsBar shown={shown.length} total={inStatus.length} noun="cadastros" view={view} onView={onViewChange} />

        {loading ? (
          <ListShell><ListSkeleton /></ListShell>
        ) : shown.length === 0 ? (
          <EmptyResults
            title={searchTerm ? `Nada encontrado para “${searchTerm}”.` : 'Nenhum item neste filtro.'}
            onClear={() => { setSearchTerm(''); setChip('all'); }}
          />
        ) : view === 'grid' ? (
          <CardGrid>
            {shown.map((entity) => {
              const tags = entityTags(entity, asoClinicStatuses[entity.id]);
              const contacts = entityContacts(entity);
              return (
                <GridCard
                  key={entity.id}
                  label={`Abrir ${displayName(entity)}`}
                  minHeight={220}
                  isOpen={openId === entity.id}
                  isSelected={false}
                  isMuted={isInactive(entity)}
                  onOpen={() => { setOpenId(entity.id); setPendingInactivate(null); }}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className={cn('flex h-[52px] w-[52px] items-center justify-center rounded-2xl text-[17px] font-extrabold', avatarTone(entity))}>
                      {initialsOf(displayName(entity))}
                    </div>
                    <span className={cn('inline-flex items-center gap-[7px] whitespace-nowrap text-[12.5px] font-semibold', typeTone(entity))}>
                      <span className="h-[7px] w-[7px] rounded-full bg-current" />
                      {typeLabel(entity)}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-[3px]">
                    <span className="break-words text-[18px] font-extrabold leading-[1.15] tracking-[-0.02em]">{displayName(entity)}</span>
                    {entity.fantasyName ? <span className="truncate text-[11.5px] text-[#8a8f99]">{entity.name}</span> : null}
                  </div>
                  {tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {tags.map((tag) => <TagChip key={tag.label} tone={tag.tone}>{tag.label}</TagChip>)}
                    </div>
                  ) : null}
                  <div className="mt-auto flex min-w-0 flex-col gap-1 border-t border-[#f0ede7] pt-3 text-xs text-[#4a4f57]">
                    <span className="font-mono text-[11.5px]">{entity.document}</span>
                    <span className="truncate">{contacts[0] ?? '—'}</span>
                    <span className="text-[#8a8f99]">{entityCity(entity)}</span>
                  </div>
                </GridCard>
              );
            })}
          </CardGrid>
        ) : (
          <ListShell>
            <ListHead template={LIST_TEMPLATE}>
              <span>Nome / Razão social</span><span>Tipo</span><span>Documento</span><span>Contato</span><span>Cidade/UF</span><span />
            </ListHead>
            {shown.map((entity, index) => {
              const tags = entityTags(entity, asoClinicStatuses[entity.id]);
              const contacts = entityContacts(entity);
              return (
                <ListRow
                  key={entity.id}
                  template={LIST_TEMPLATE}
                  isFirst={index === 0}
                  isOpen={openId === entity.id}
                  isSelected={false}
                  isMuted={isInactive(entity)}
                  label={`Abrir ${displayName(entity)}`}
                  onOpen={() => { setOpenId(entity.id); setPendingInactivate(null); }}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-xs font-extrabold', avatarTone(entity))}>
                      {initialsOf(displayName(entity))}
                    </div>
                    <div className="flex min-w-0 flex-col gap-[3px]">
                      <span className="truncate text-[13.5px] font-bold">{displayName(entity)}</span>
                      {entity.fantasyName ? <span className="truncate text-[11.5px] text-[#8a8f99]">{entity.name}</span> : null}
                      {tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {tags.map((tag) => <TagChip key={tag.label} tone={tag.tone}>{tag.label}</TagChip>)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <span className={cn('inline-flex items-center gap-[7px] whitespace-nowrap text-[12.5px] font-semibold', typeTone(entity))}>
                    <span className="h-[7px] w-[7px] rounded-full bg-current" />
                    {typeLabel(entity)}
                  </span>
                  <span className="whitespace-nowrap font-mono text-[11.5px] text-[#4a4f57]">{entity.document}</span>
                  <div className="flex min-w-0 flex-col gap-0.5 text-xs text-[#4a4f57]">
                    <span className="truncate">{contacts[0] ?? '—'}</span>
                    {contacts[1] ? <span className="truncate text-[#8a8f99]">{contacts[1]}</span> : null}
                  </div>
                  <span className="text-[12.5px] text-[#4a4f57]">{entityCity(entity)}</span>
                  <Chevron />
                </ListRow>
              );
            })}
          </ListShell>
        )}
      </div>

      <EntityFichaModal
        open={!!opened}
        onOpenChange={(nextOpen) => { if (!nextOpen) closeFicha(); }}
        entity={opened}
        asoClinic={opened ? asoClinicStatuses[opened.id] : undefined}
        onEdit={(target) => { if (opened) handleEdit(opened, target); }}
        actions={opened ? [
          ...(canManageAsoClinics ? [{ label: 'Serviços de saúde ocupacional', onClick: () => { const entity = opened; closeFicha(); setAsoEntity(entity); } }] : []),
          ...(!isInactive(opened) ? [{ label: 'Inativar', tone: 'danger' as const, onClick: () => setPendingInactivate(opened) }] : []),
        ] : []}
      />

      <AlertDialog open={Boolean(pendingInactivate)} onOpenChange={(nextOpen) => { if (!nextOpen && !isBusy) setPendingInactivate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Inativar “{pendingInactivate ? displayName(pendingInactivate) : ''}”?</AlertDialogTitle>
            <AlertDialogDescription>O cadastro continua no histórico e pode ser consultado no filtro Inativos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={isBusy} onClick={(event) => { event.preventDefault(); void confirmInactivate(); }}>
              {isBusy ? 'Inativando…' : 'Inativar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddEditEntityModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        entityToEdit={entityToEdit}
        initialStep={editTarget.step}
        initialFiscalOpen={editTarget.fiscal}
      />

      <AsoClinicEntityDialog
        entity={asoEntity}
        open={Boolean(asoEntity)}
        onOpenChange={(nextOpen) => { if (!nextOpen) setAsoEntity(null); }}
        onSaved={(clinic) => {
          setAsoClinicStatuses((current) => ({ ...current, [clinic.entityId]: { active: clinic.active } }));
        }}
      />
    </>
  );
}
