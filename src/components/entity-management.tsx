

"use client"

import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import Image from 'next/image';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useEntities } from '@/hooks/use-entities';
import { useAuth } from '@/hooks/use-auth';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Plus, Trash2, Edit, Building, User, Phone, Mail, MapPin, Search, Eraser, Upload, Check, ChevronLeft, ChevronRight, MapPinned, MoreHorizontal, Tags, RefreshCw, Loader2, AlertTriangle, Stethoscope } from 'lucide-react';
import { type Entity } from '@/types';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import type { CompanyLookupResponse, NormalizedCompanyData } from '@/lib/company/company-lookup-types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Skeleton } from './ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
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
      purposes: z.array(z.enum(['onboarding', 'termination', 'aso'])).optional(),
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
    { id: 1, label: 'Identificação', icon: User, description: 'Tipo de cadastro, foto e documento. O tipo define os campos.' },
    { id: 2, label: 'Contato e endereço', icon: MapPinned, description: 'Como falar com este cadastro e onde ele está localizado.' },
] as const;

function AddEditEntityModal({ open, onOpenChange, entityToEdit }: { open: boolean, onOpenChange: (open: boolean) => void, entityToEdit: Entity | null }) {
    const { addEntity, updateEntity } = useEntities();
    const { firebaseUser } = useAuth();

    const [currentStep, setCurrentStep] = useState(1);
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const [cnpjLookupLoading, setCnpjLookupLoading] = useState(false);
    const [cnpjLookupMessage, setCnpjLookupMessage] = useState<string | null>(null);
    const [cnpjLookupResult, setCnpjLookupResult] = useState<CompanyLookupResponse | null>(null);
    const [loadedCompanyEntityId, setLoadedCompanyEntityId] = useState<string | null>(null);
    const [documentSignatoryOptions, setDocumentSignatoryOptions] = useState<DocumentSignatoryOption[]>([]);
    const [documentSignatoryLoading, setDocumentSignatoryLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const lastAutoLookupCnpjRef = useRef<string>('');

    const form = useForm<EntityFormValues>({
        resolver: zodResolver(entitySchema),
        defaultValues: emptyEntityFormValues,
    });

    useEffect(() => {
        if (!open) return;
        setCurrentStep(1);
        form.reset(getEntityFormValues(entityToEdit));
        setCnpjLookupMessage(null);
        setCnpjLookupResult(null);
        setLoadedCompanyEntityId(entityToEdit?.id ?? null);
        lastAutoLookupCnpjRef.current = CnpjValidator.clean(entityToEdit?.document ?? '');
    }, [entityToEdit, form, open]);

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
                    setCnpjLookupMessage(error instanceof Error ? error.message : 'Falha ao listar responsáveis.');
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
    const documentWatch = form.watch('document');
    const cleanCnpjWatch = entityType === 'pessoa_juridica' ? CnpjValidator.clean(documentWatch ?? '') : '';
    const imageUrlWatch = form.watch('imageUrl');
    const departmentEmails = form.watch('contact.emails') ?? [];
    const isPF = entityType === 'pessoa_fisica';
    const initials = (nameWatch || '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase() || '—';

    const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) return;
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

    const addDepartmentEmail = () => {
        form.setValue('contact.emails', [
            ...departmentEmails,
            { id: crypto.randomUUID(), department: '', email: '', purposes: [] },
        ], { shouldDirty: true });
    };

    const removeDepartmentEmail = (id: string) => {
        form.setValue('contact.emails', departmentEmails.filter((entry) => entry.id !== id), { shouldDirty: true });
    };

    const toggleDepartmentEmailPurpose = (index: number, purpose: 'onboarding' | 'termination' | 'aso', checked: boolean) => {
        const current = departmentEmails[index];
        if (!current) return;
        const purposes = new Set(current.purposes ?? []);
        if (checked) purposes.add(purpose);
        else purposes.delete(purpose);
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
        setCnpjLookupMessage(null);
        if (!document) {
            if (!options.silentInvalid) setCnpjLookupMessage('Informe o CNPJ antes de buscar.');
            return;
        }

        if (!validation.valid) {
            if (!options.silentInvalid || validation.clean.length === 14) {
                setCnpjLookupMessage(validation.message ?? 'CNPJ inválido. Verifique os números informados.');
            }
            return;
        }

        if (!firebaseUser) {
            setCnpjLookupMessage('Usuário não autenticado.');
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
            setCnpjLookupMessage(lookup.message);
        } catch (error) {
            setCnpjLookupMessage(error instanceof Error ? error.message : 'Falha ao consultar CNPJ.');
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
        setCnpjLookupMessage(null);

        try {
            if (values.type === 'pessoa_juridica') {
                if (!firebaseUser) throw new Error('Usuário não autenticado.');
                if (/baixad|inapt|suspens/i.test(values.cadastralStatus ?? '')) {
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
            } else if (entityToEdit) {
                await updateEntity({ ...entityToEdit, ...payload });
            } else {
                await addEntity(payload);
            }
            onOpenChange(false);
        } catch (error) {
            setCnpjLookupMessage(error instanceof Error ? error.message : 'Falha ao salvar cadastro.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] sm:max-w-5xl p-0 gap-0 overflow-hidden">
                {/* Header */}
                <DialogHeader className="space-y-2 border-b px-6 py-4 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
                            <User className="h-3 w-3" /> {isPF ? 'Pessoa física' : 'Pessoa jurídica'}
                        </span>
                        {documentWatch && (
                            <span className="inline-flex items-center rounded-full border bg-background px-2.5 py-0.5 font-mono text-xs text-muted-foreground">{documentWatch}</span>
                        )}
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', statusWatch === 'active' ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground')}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', statusWatch === 'active' ? 'bg-green-500' : 'bg-muted-foreground')} />
                            {statusWatch === 'active' ? 'Ativo' : 'Inativo'}
                        </span>
                    </div>
                    <DialogTitle className="text-2xl font-bold">{entityToEdit ? 'Editar pessoa' : 'Novo cadastro'}</DialogTitle>
                    <DialogDescription className="text-sm">{nameWatch || 'Diretório de pessoas e empresas. Apenas dados de identidade e contato.'}</DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
                        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr]">
                            {/* Stepper */}
                            <aside className="border-r bg-muted/40 px-5 py-6">
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Etapa {currentStep} de {ENTITY_WIZARD_STEPS.length}</p>
                                <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                    <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${(currentStep / ENTITY_WIZARD_STEPS.length) * 100}%` }} />
                                </div>
                                <nav className="space-y-1">
                                    {ENTITY_WIZARD_STEPS.map((step) => {
                                        const isActive = step.id === currentStep;
                                        const isDone = step.id < currentStep;
                                        return (
                                            <button key={step.id} type="button" onClick={() => setCurrentStep(step.id)}
                                                className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors', isActive ? 'font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted')}>
                                                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', isActive ? 'bg-indigo-500 text-white' : isDone ? 'bg-indigo-100 text-indigo-600' : 'bg-muted text-muted-foreground')}>
                                                    {isDone ? <Check className="h-4 w-4" /> : step.id}
                                                </span>
                                                <span className="truncate">{step.label}</span>
                                            </button>
                                        );
                                    })}
                                </nav>
                                <div className="mt-8 rounded-lg border bg-background/60 p-3">
                                    <p className="flex items-center gap-1.5 text-xs font-semibold"><User className="h-3.5 w-3.5" /> {isPF ? 'Pessoa física' : 'Pessoa jurídica'}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">Diretório de pessoas e empresas. Apenas dados de identidade e contato — sem relação com usuários do sistema.</p>
                                </div>
                            </aside>

                            {/* Content */}
                            <ScrollArea className="h-[62vh]">
                                <div className="px-6 py-6">
                                    <div className="mb-5 flex items-start justify-between gap-4">
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                                                {React.createElement(ENTITY_WIZARD_STEPS[currentStep - 1].icon, { className: 'h-4 w-4' })}
                                            </div>
                                            <div>
                                                <h3 className="font-semibold leading-tight">{ENTITY_WIZARD_STEPS[currentStep - 1].label}</h3>
                                                <p className="text-sm text-muted-foreground">{ENTITY_WIZARD_STEPS[currentStep - 1].description}</p>
                                            </div>
                                        </div>
                                        {currentStep === 1 && (
                                            <FormField control={form.control} name="status" render={({ field }) => (
                                                <div className="flex shrink-0 overflow-hidden rounded-full border text-xs font-medium">
                                                    <button type="button" onClick={() => field.onChange('active')} className={cn('flex items-center gap-1 px-3 py-1', field.value !== 'inactive' ? 'bg-green-100 text-green-700' : 'text-muted-foreground')}>
                                                        <span className={cn('h-1.5 w-1.5 rounded-full', field.value !== 'inactive' ? 'bg-green-500' : 'bg-muted-foreground')} /> Ativo
                                                    </button>
                                                    <button type="button" onClick={() => field.onChange('inactive')} className={cn('px-3 py-1', field.value === 'inactive' ? 'bg-muted text-foreground' : 'text-muted-foreground')}>Inativo</button>
                                                </div>
                                            )}/>
                                        )}
                                    </div>

                                    {/* STEP 1 — Identificação */}
                                    {currentStep === 1 && (
                                        <div className="space-y-5">
                                            <FormField control={form.control} name="type" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Tipo de cadastro <span className="text-rose-500">*</span></FormLabel>
                                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                        {([
                                                            { value: 'pessoa_fisica', icon: User, title: 'Pessoa física', sub: 'Indivíduo · CPF' },
                                                            { value: 'pessoa_juridica', icon: Building, title: 'Pessoa jurídica', sub: 'Empresa · CNPJ' },
                                                        ] as const).map((opt) => {
                                                            const selected = field.value === opt.value;
                                                            return (
                                                                <button key={opt.value} type="button" onClick={() => field.onChange(opt.value)}
                                                                    className={cn('flex items-center gap-3 rounded-xl border p-3 text-left transition-colors', selected ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' : 'hover:border-muted-foreground/40')}>
                                                                    <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', selected ? 'bg-indigo-500 text-white' : 'bg-muted text-muted-foreground')}>
                                                                        {React.createElement(opt.icon, { className: 'h-4 w-4' })}
                                                                    </span>
                                                                    <span>
                                                                        <span className="block text-sm font-semibold">{opt.title}</span>
                                                                        <span className="block text-xs text-muted-foreground">{opt.sub}</span>
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    <FormMessage />
                                                </FormItem>
                                            )}/>

                                            {/* Avatar */}
                                            <div className="space-y-2">
                                                <FormLabel>Foto / avatar</FormLabel>
                                                <div className="flex items-center gap-4">
                                                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-emerald-100 text-lg font-bold text-emerald-700">
                                                        {imageUrlWatch ? <Image src={imageUrlWatch} alt="avatar" width={64} height={64} className="h-full w-full object-cover" /> : initials}
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <Button type="button" variant="outline" size="sm" onClick={() => avatarInputRef.current?.click()}><Upload className="mr-1.5 h-3.5 w-3.5" /> Enviar foto</Button>
                                                        <span className="text-xs text-muted-foreground">JPG ou PNG · até 5MB</span>
                                                        {imageUrlWatch && <button type="button" className="text-left text-xs text-destructive" onClick={() => form.setValue('imageUrl', '', { shouldDirty: true })}>Remover foto</button>}
                                                    </div>
                                                </div>
                                                <input type="file" ref={avatarInputRef} className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                                            </div>

                                            <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>{isPF ? 'Nome completo' : 'Razão social'} <span className="text-rose-500">*</span></FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>

                                            {isPF ? (
                                                <>
                                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                        <FormField control={form.control} name="document" render={({ field }) => (<FormItem><FormLabel>CPF <span className="text-rose-500">*</span></FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                                                        <FormField control={form.control} name="rg" render={({ field }) => (<FormItem><div className="flex items-center justify-between"><FormLabel>RG</FormLabel><span className="text-xs text-muted-foreground">opcional</span></div><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                    </div>
                                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                        <FormField control={form.control} name="birthDate" render={({ field }) => (<FormItem><div className="flex items-center justify-between"><FormLabel>Data de nascimento</FormLabel><span className="text-xs text-muted-foreground">opcional</span></div><FormControl><Input type="date" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                        <FormField control={form.control} name="nickname" render={({ field }) => (<FormItem><div className="flex items-center justify-between"><FormLabel>Apelido</FormLabel><span className="text-xs text-muted-foreground">busca interna</span></div><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                        <FormField control={form.control} name="document" render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>CNPJ <span className="text-rose-500">*</span></FormLabel>
                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
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
                                                                        />
                                                                    </FormControl>
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        className="shrink-0"
                                                                        onClick={() => void handleCnpjLookup()}
                                                                        disabled={cnpjLookupLoading}
                                                                    >
                                                                        {cnpjLookupLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
                                                                        Consultar
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        className="shrink-0"
                                                                        onClick={() => void handleCnpjLookup({ forceRefresh: true })}
                                                                        disabled={cnpjLookupLoading || cleanCnpjWatch.length !== 14}
                                                                    >
                                                                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                                                        Atualizar
                                                                    </Button>
                                                                </div>
                                                                {cnpjLookupLoading ? <p className="text-xs text-muted-foreground">Buscando dados da empresa...</p> : null}
                                                                {cnpjLookupMessage ? <p className="text-xs text-muted-foreground">{cnpjLookupMessage}</p> : null}
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}/>
                                                        <FormField control={form.control} name="fantasyName" render={({ field }) => (<FormItem><FormLabel>Nome fantasia <span className="text-rose-500">*</span></FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                    </div>
                                                    {cnpjLookupResult?.alerts?.length ? (
                                                        <div className="space-y-2">
                                                            {cnpjLookupResult.alerts.map((alert, index) => (
                                                                <Alert key={`${alert.message}-${index}`} variant={alert.type === 'error' ? 'destructive' : 'default'} className={cn(alert.type === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900')}>
                                                                    <AlertTriangle className="h-4 w-4" />
                                                                    <AlertTitle>{alert.type === 'warning' ? 'Atenção' : alert.type === 'error' ? 'Erro' : 'Informação'}</AlertTitle>
                                                                    <AlertDescription>{alert.message}</AlertDescription>
                                                                </Alert>
                                                            ))}
                                                        </div>
                                                    ) : null}
                                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                        <FormField control={form.control} name="responsible" render={({ field }) => (<FormItem><div className="flex items-center justify-between"><FormLabel>Responsável cadastral</FormLabel><span className="text-xs text-muted-foreground">opcional</span></div><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                        <FormField control={form.control} name="nickname" render={({ field }) => (<FormItem><div className="flex items-center justify-between"><FormLabel>Apelido</FormLabel><span className="text-xs text-muted-foreground">busca interna</span></div><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                    </div>
                                                    <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-4">
                                                        <div className="mb-3">
                                                            <p className="text-sm font-bold text-slate-900">Responsável pela assinatura documental</p>
                                                            <p className="text-xs text-slate-500">
                                                                Esta pessoa assina pela empresa nos documentos enviados à Autentique.
                                                            </p>
                                                        </div>
                                                        <div className="grid gap-4 md:grid-cols-2">
                                                            <FormField
                                                                control={form.control}
                                                                name="documentSignatoryUserId"
                                                                render={({ field }) => (
                                                                    <FormItem>
                                                                        <FormLabel>Pessoa responsável</FormLabel>
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
                                                                                <SelectTrigger>
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
                                                                        <FormMessage />
                                                                    </FormItem>
                                                                )}
                                                            />
                                                            <FormField
                                                                control={form.control}
                                                                name="documentSignatoryScope"
                                                                render={({ field }) => (
                                                                    <FormItem>
                                                                        <FormLabel>Abrangência</FormLabel>
                                                                        <Select value={field.value ?? 'entity'} onValueChange={field.onChange}>
                                                                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                                                            <SelectContent>
                                                                                <SelectItem value="entity">Somente este CNPJ</SelectItem>
                                                                                <SelectItem value="cnpj_root">Matriz e filiais do mesmo CNPJ-base</SelectItem>
                                                                            </SelectContent>
                                                                        </Select>
                                                                        <FormMessage />
                                                                    </FormItem>
                                                                )}
                                                            />
                                                        </div>
                                                        {form.watch('documentSignatoryEmail') ? (
                                                            <p className="mt-3 text-xs font-medium text-violet-800">
                                                                Convites de assinatura: {form.watch('documentSignatoryName')} · {form.watch('documentSignatoryEmail')}
                                                            </p>
                                                        ) : null}
                                                    </div>
                                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                                        <FormField control={form.control} name="cadastralStatus" render={({ field }) => (<FormItem><FormLabel>Situação cadastral</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                        <FormField control={form.control} name="openingDate" render={({ field }) => (<FormItem><FormLabel>Data de abertura</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                        <FormField control={form.control} name="businessType" render={({ field }) => (<FormItem><FormLabel>Tipo de fornecedor</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="Fornecedor, cliente, serviço..." /></FormControl><FormMessage /></FormItem>)}/>
                                                    </div>
                                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_2fr]">
                                                        <FormField control={form.control} name="primaryCnaeCode" render={({ field }) => (<FormItem><FormLabel>CNAE principal</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                        <FormField control={form.control} name="primaryCnaeDescription" render={({ field }) => (<FormItem><FormLabel>Descrição do CNAE</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                    </div>
                                                    <FormField control={form.control} name="legalNature" render={({ field }) => (<FormItem><FormLabel>Natureza jurídica</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                                        <FormField control={form.control} name="stateRegistration" render={({ field }) => (<FormItem><div className="flex items-center justify-between"><FormLabel>Inscrição estadual</FormLabel><span className="text-xs text-muted-foreground">opcional</span></div><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                        <FormField control={form.control} name="icmsTaxpayer" render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>Contribuinte ICMS</FormLabel>
                                                                <Select onValueChange={field.onChange} value={field.value ?? 'nao_informado'}>
                                                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                                                    <SelectContent>
                                                                        <SelectItem value="nao_informado">Não informado</SelectItem>
                                                                        <SelectItem value="sim">Sim</SelectItem>
                                                                        <SelectItem value="nao">Não</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}/>
                                                        <FormField control={form.control} name="stateRegistrationStatus" render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>Situação IE</FormLabel>
                                                                <Select onValueChange={field.onChange} value={field.value ?? 'nao_consultada'}>
                                                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                                                    <SelectContent>
                                                                        <SelectItem value="nao_consultada">Não consultada</SelectItem>
                                                                        <SelectItem value="nao_informado">Não informado</SelectItem>
                                                                        <SelectItem value="ativa">Ativa</SelectItem>
                                                                        <SelectItem value="inativa">Inativa</SelectItem>
                                                                        <SelectItem value="suspensa">Suspensa</SelectItem>
                                                                        <SelectItem value="baixada">Baixada</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}/>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}

                                    {/* STEP 2 — Contato e endereço */}
                                    {currentStep === 2 && (
                                        <div className="space-y-5">
                                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                <FormField control={form.control} name="contact.email" render={({ field }) => (<FormItem><FormLabel>E-mail principal</FormLabel><FormControl><Input {...field} value={field.value ?? ''}/></FormControl><FormMessage /></FormItem>)}/>
                                                <FormField control={form.control} name="contact.phone" render={({ field }) => (<FormItem><FormLabel>Telefone / WhatsApp</FormLabel><FormControl><Input {...field} value={field.value ?? ''}/></FormControl><FormMessage /></FormItem>)}/>
                                            </div>

                                            {entityType === 'pessoa_juridica' ? (
                                                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                                        <div>
                                                            <p className="text-sm font-bold text-slate-900">E-mails por setor</p>
                                                            <p className="mt-1 text-xs text-slate-500">Cadastre quantos contatos forem necessários e indique em quais processos cada um será sugerido.</p>
                                                        </div>
                                                        <Button type="button" size="sm" variant="outline" onClick={addDepartmentEmail}>
                                                            <Plus className="mr-1.5 h-3.5 w-3.5" />Adicionar e-mail
                                                        </Button>
                                                    </div>
                                                    <div className="mt-4 space-y-3">
                                                        {departmentEmails.map((entry, index) => (
                                                            <div key={entry.id} className="rounded-xl border border-slate-200 bg-white p-3">
                                                                <div className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_36px]">
                                                                    <label className="space-y-2 text-sm font-medium">
                                                                        <span>Setor</span>
                                                                        <Input {...form.register(`contact.emails.${index}.department` as const)} placeholder="Ex.: Pessoal" />
                                                                        {form.formState.errors.contact?.emails?.[index]?.department?.message ? <span className="block text-sm font-medium text-destructive">{form.formState.errors.contact.emails[index]?.department?.message}</span> : null}
                                                                    </label>
                                                                    <label className="space-y-2 text-sm font-medium">
                                                                        <span>E-mail</span>
                                                                        <Input type="email" {...form.register(`contact.emails.${index}.email` as const)} placeholder="setor@empresa.com.br" />
                                                                        {form.formState.errors.contact?.emails?.[index]?.email?.message ? <span className="block text-sm font-medium text-destructive">{form.formState.errors.contact.emails[index]?.email?.message}</span> : null}
                                                                    </label>
                                                                    <button type="button" onClick={() => removeDepartmentEmail(entry.id)} className="mt-7 grid h-9 w-9 place-items-center rounded-lg text-rose-500 hover:bg-rose-50" aria-label="Remover e-mail setorial">
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </button>
                                                                </div>
                                                                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-slate-600">
                                                                    <span className="text-slate-400">Usar em:</span>
                                                                    {([
                                                                        ['onboarding', 'Integração'],
                                                                        ['termination', 'Desligamento'],
                                                                        ['aso', 'ASO'],
                                                                    ] as const).map(([purpose, label]) => (
                                                                        <label key={purpose} className="flex items-center gap-1.5">
                                                                            <input type="checkbox" checked={(entry.purposes ?? []).includes(purpose)} onChange={(event) => toggleDepartmentEmailPurpose(index, purpose, event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-pink-600" />
                                                                            {label}
                                                                        </label>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {departmentEmails.length === 0 ? <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">Nenhum e-mail setorial cadastrado.</p> : null}
                                                    </div>
                                                </div>
                                            ) : null}

                                            <Separator />

                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr_100px]">
                                                <FormField control={form.control} name="address.zipCode" render={({ field }) => (<FormItem><FormLabel>CEP</FormLabel><FormControl><Input {...field} value={field.value ?? ''} onBlur={e => handleZipCodeBlur(e.target.value)} /></FormControl><FormMessage /></FormItem>)}/>
                                                <FormField control={form.control} name="address.street" render={({ field }) => (<FormItem><FormLabel>Logradouro</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                <FormField control={form.control} name="address.number" render={({ field }) => (<FormItem><FormLabel>Número</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                            </div>
                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_1fr_100px]">
                                                <FormField control={form.control} name="address.complement" render={({ field }) => (<FormItem><FormLabel>Complemento</FormLabel><FormControl><Input {...field} value={field.value ?? ''}/></FormControl><FormMessage /></FormItem>)}/>
                                                <FormField control={form.control} name="address.neighborhood" render={({ field }) => (<FormItem><FormLabel>Bairro</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                <FormField control={form.control} name="address.city" render={({ field }) => (<FormItem><FormLabel>Cidade</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                <FormField control={form.control} name="address.state" render={({ field }) => (<FormItem><FormLabel>UF</FormLabel><FormControl><Input maxLength={2} {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                            </div>

                                            <FormField control={form.control} name="notes" render={({ field }) => (
                                                <FormItem>
                                                    <div className="flex items-center justify-between">
                                                        <FormLabel>Observações</FormLabel>
                                                        <span className="text-xs text-muted-foreground">opcional</span>
                                                    </div>
                                                    <FormControl><Textarea {...field} value={field.value ?? ''} placeholder="Anotações sobre este cadastro..." /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}/>
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                        </div>

                        {/* Footer */}
                        <DialogFooter className="flex flex-row items-center justify-between gap-4 border-t px-6 py-4 sm:justify-between">
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <div className="hidden flex-col items-center text-center sm:flex">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Etapa {currentStep} de {ENTITY_WIZARD_STEPS.length}</span>
                                <span className="text-sm font-medium">{ENTITY_WIZARD_STEPS[currentStep - 1].label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {currentStep > 1 && (<Button type="button" variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" /> Voltar</Button>)}
                                {currentStep < ENTITY_WIZARD_STEPS.length ? (
                                    <Button type="button" className="bg-indigo-500 hover:bg-indigo-600" onClick={handleNext}>Avançar <ChevronRight className="ml-1 h-4 w-4" /></Button>
                                ) : (
                                    <Button type="submit" className="bg-indigo-500 hover:bg-indigo-600" disabled={saving}>
                                        {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                                        {entityToEdit || loadedCompanyEntityId ? 'Salvar alterações' : 'Adicionar'}
                                    </Button>
                                )}
                            </div>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}


export function EntityManagement() {
  const { entities, loading, deleteEntity } = useEntities();
  const { firebaseUser, permissions } = useAuth();
  const [entityToDelete, setEntityToDelete] = useState<Entity | null>(null);
  const [entityToEdit, setEntityToEdit] = useState<Entity | null>(null);
  const [asoEntity, setAsoEntity] = useState<Entity | null>(null);
  const [asoClinicStatuses, setAsoClinicStatuses] = useState<Record<string, { active: boolean }>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
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

  const filteredEntities = useMemo(() => {
    return entities.filter(entity => {
      const search = searchTerm.toLowerCase();
      const typeMatch = typeFilter === 'all' || entity.type === typeFilter;
      const searchMatch = entity.name.toLowerCase().includes(search) ||
                          (entity.fantasyName && entity.fantasyName.toLowerCase().includes(search)) ||
                          (entity.nickname && entity.nickname.toLowerCase().includes(search)) ||
                          (entity.document ?? '').includes(search) ||
                          (entity.contact?.email ?? '').toLowerCase().includes(search) ||
                          (entity.contact?.phone ?? '').includes(search);
      
      return typeMatch && searchMatch;
    });
  }, [entities, searchTerm, typeFilter]);

  const handleDeleteClick = (entity: Entity) => {
    setEntityToDelete(entity);
  };

  const handleDeleteConfirm = async () => {
    if (entityToDelete) {
      await deleteEntity(entityToDelete.id);
      setEntityToDelete(null);
    }
  };

  const handleAddNew = () => {
    setEntityToEdit(null);
    setIsModalOpen(true);
  };

  const handleEdit = (entity: Entity) => {
    setEntityToEdit(entity);
    setIsModalOpen(true);
  };

  return (
    <>
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader className="px-0 pb-3 pt-0">
          <CardTitle className="text-lg font-black tracking-[-0.02em] text-[#181820]">
            Pessoas e empresas
          </CardTitle>
          <CardDescription className="text-[11px] font-medium text-[#777784]">
            Colaboradores, fornecedores, sócios e clientes do sistema.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 rounded-lg border-[#e2e0da] bg-white px-3 text-[11px] font-extrabold text-[#494952]"
                >
                  <Tags className="mr-1.5 h-3.5 w-3.5" /> Categorias de cadastro
                </Button>
                <Button onClick={handleAddNew} className="h-8 rounded-lg bg-[#df2f78] px-3 text-[11px] font-extrabold text-white hover:bg-[#cc2069]">
                  <Plus className="mr-1.5 h-4 w-4" /> Adicionar cadastro
                </Button>
              </div>
              <p className="text-[11px] font-bold text-[#777784]">
                <strong className="text-[#494952]">{filteredEntities.length}</strong> de {entities.length}
              </p>
            </div>

            <div className="relative w-full">
                    <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9d9da9]" />
                    <Input
                        placeholder="Buscar por nome, CPF/CNPJ, e-mail..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="h-8 w-full rounded-md border-0 bg-[#f6f5f2] pl-9 text-xs font-medium shadow-none placeholder:text-[#9d9da9]"
                    />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="h-8 w-full rounded-md border-[#e2e0da] bg-white text-[11px] font-bold text-[#494952] sm:w-[180px]">
                        <SelectValue placeholder="Filtrar por tipo" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos os tipos</SelectItem>
                        <SelectItem value="pessoa_fisica">Pessoa física</SelectItem>
                        <SelectItem value="pessoa_juridica">Pessoa jurídica</SelectItem>
                    </SelectContent>
                </Select>
                <Button className="h-8 rounded-md px-2.5 text-[11px] font-bold text-[#777784]" variant="ghost" onClick={() => { setSearchTerm(''); setTypeFilter('all'); }}>
                    <Eraser className="mr-1.5 h-3.5 w-3.5" />
                    Limpar
                </Button>
            </div>
           
            <div className="overflow-x-auto rounded-xl border border-[#e2e0da] bg-white shadow-[0_2px_8px_rgba(15,23,42,.04)]">
                <Table>
                    <TableHeader>
                        <TableRow className="h-10 border-[#ececf0] bg-[#fbfbfc] hover:bg-[#fbfbfc]">
                            <TableHead className="text-[10px] font-extrabold uppercase tracking-[.07em] text-[#9d9da9]">Nome / Razão social</TableHead>
                            <TableHead className="text-[10px] font-extrabold uppercase tracking-[.07em] text-[#9d9da9]">Tipo</TableHead>
                            <TableHead className="text-[10px] font-extrabold uppercase tracking-[.07em] text-[#9d9da9]">Documento</TableHead>
                            <TableHead className="text-[10px] font-extrabold uppercase tracking-[.07em] text-[#9d9da9]">Contato</TableHead>
                            <TableHead className="text-[10px] font-extrabold uppercase tracking-[.07em] text-[#9d9da9]">Cidade/UF</TableHead>
                            <TableHead className="w-20 text-right text-[10px] font-extrabold uppercase tracking-[.07em] text-[#9d9da9]">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            [...Array(5)].map((_, index) => (
                                <TableRow key={index}>
                                    <TableCell colSpan={6}><Skeleton className="h-10 w-full" /></TableCell>
                                </TableRow>
                            ))
                        ) : filteredEntities.length > 0 ? (
                            filteredEntities.map(entity => (
                                <TableRow key={entity.id} className="h-16 border-[#f2f2f5] hover:bg-[#fbfbfc]">
                                    <TableCell>
                                        <div className="flex items-center gap-2.5">
                                            <div className={cn(
                                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-black text-white',
                                              entity.type === 'pessoa_juridica'
                                                ? 'bg-gradient-to-br from-orange-500 to-amber-500'
                                                : 'bg-gradient-to-br from-violet-500 to-blue-500',
                                            )}>
                                                {(entity.fantasyName || entity.name)
                                                  .split(/\s+/)
                                                  .slice(0, 2)
                                                  .map((part) => part.slice(0, 1))
                                                  .join('')
                                                  .toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="max-w-64 truncate text-sm font-extrabold text-[#1d1d26]">{entity.fantasyName || entity.name}</p>
                                                {entity.fantasyName ? <p className="max-w-64 truncate text-[11px] font-medium text-[#a6a6b0]">{entity.name}</p> : null}
                                                {entity.nickname ? (
                                                    <Badge variant="secondary" className="mt-1 rounded-md px-1.5 py-0 text-[10px] font-medium">
                                                        {entity.nickname}
                                                    </Badge>
                                                ) : null}
                                                {entity.documentSignatoryName ? (
                                                    <p className="mt-1 max-w-72 truncate text-[10px] font-semibold text-violet-700">
                                                        Assina pela empresa: {entity.documentSignatoryName}
                                                        {entity.documentSignatoryScope === 'cnpj_root' ? ' · matriz e filiais' : ''}
                                                    </p>
                                                ) : null}
                                                {entity.status === 'inactive' ? (
                                                  <Badge variant="outline" className="mt-1 rounded-md border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-medium text-amber-800">
                                                    Inativo
                                                  </Badge>
                                                ) : null}
                                                {asoClinicStatuses[entity.id] ? (
                                                  <Badge variant="outline" className={cn(
                                                    'ml-1 mt-1 rounded-md px-1.5 py-0 text-[10px] font-medium',
                                                    asoClinicStatuses[entity.id].active
                                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                                      : 'border-slate-200 bg-slate-50 text-slate-600',
                                                  )}>
                                                    Clínica ASO{asoClinicStatuses[entity.id].active ? '' : ' inativa'}
                                                  </Badge>
                                                ) : null}
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-xs">
                                        <span className={cn(
                                          'inline-flex items-center gap-2 font-medium',
                                          entity.type === 'pessoa_juridica' ? 'text-orange-500' : 'text-indigo-500',
                                        )}>
                                          <span className="h-2 w-2 rounded-full bg-current" />
                                          {entity.type === 'pessoa_juridica' ? 'Empresa' : 'Pessoa física'}
                                        </span>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-[#6f6f7c]">{entity.document}</TableCell>
                                    <TableCell>
                                        <div className="space-y-0.5 text-[11px] text-[#777784]">
                                            {entity.contact?.email ? <p className="flex items-center gap-1"><Mail className="h-3 w-3" />{entity.contact.email}</p> : null}
                                            {(entity.contact?.emails ?? []).slice(0, 2).map((entry) => <p key={entry.id} className="flex items-center gap-1"><Mail className="h-3 w-3" /><span className="font-semibold">{entry.department}:</span> {entry.email}</p>)}
                                            {entity.contact?.phone ? <p className="flex items-center gap-1"><Phone className="h-3 w-3" />{entity.contact.phone}</p> : null}
                                            {!entity.contact?.email && !entity.contact?.phone && !(entity.contact?.emails?.length) ? '-' : null}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {entity.address?.city ? (
                                            <span className="flex items-center gap-1 text-xs text-[#6f6f7c]">
                                                <MapPin className="h-3 w-3 text-muted-foreground" />
                                                {entity.address.city}{entity.address.state ? `/${entity.address.state}` : ''}
                                            </span>
                                        ) : '-'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="text-[#9e938b]">
                                              <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            <DropdownMenuItem onSelect={() => handleEdit(entity)}>
                                              <Edit className="mr-2 h-4 w-4" /> Editar
                                            </DropdownMenuItem>
                                            {canManageAsoClinics ? (
                                              <DropdownMenuItem onSelect={() => setAsoEntity(entity)}>
                                                <Stethoscope className="mr-2 h-4 w-4" /> Serviços de saúde ocupacional
                                              </DropdownMenuItem>
                                            ) : null}
                                            <DropdownMenuSeparator />
                                            {entity.status !== 'inactive' ? (
                                              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => handleDeleteClick(entity)}>
                                                <Trash2 className="mr-2 h-4 w-4" /> Inativar
                                              </DropdownMenuItem>
                                            ) : null}
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                    Nenhum cadastro encontrado.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </CardContent>
      </Card>

      <AddEditEntityModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        entityToEdit={entityToEdit}
      />

      <AsoClinicEntityDialog
        entity={asoEntity}
        open={Boolean(asoEntity)}
        onOpenChange={(nextOpen) => { if (!nextOpen) setAsoEntity(null); }}
        onSaved={(clinic) => {
          setAsoClinicStatuses((current) => ({ ...current, [clinic.entityId]: { active: clinic.active } }));
        }}
      />

      {entityToDelete && (
        <DeleteConfirmationDialog
          open={!!entityToDelete}
          onOpenChange={() => setEntityToDelete(null)}
          onConfirm={handleDeleteConfirm}
          itemName={`o cadastro de "${entityToDelete.name}" (ele será inativado e o histórico será preservado)`}
        />
      )}
    </>
  );
}
