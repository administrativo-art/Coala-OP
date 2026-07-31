"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronsUpDown,
  CircleAlert,
  Eye,
  ExternalLink,
  FileCheck2,
  FilePlus2,
  FileStack,
  Loader2,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type {
  ManualFieldBinding,
  TemplateFieldMapping,
} from "@/features/hr/documents/field-mapping";
import {
  conditionMatches,
  type DocumentFormField,
  type DocumentFormSchema,
} from "@/features/hr/documents/document-form-schema";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

type Template = {
  id: string;
  name: string;
  category: string;
  status: string;
  version: number;
  description?: string;
  isSystem?: boolean;
  renderer?: "letterhead" | "uniform" | "admission_docx";
  previewUrl?: string;
  fieldMapping?: TemplateFieldMapping;
  formSchema?: DocumentFormSchema;
};

type GeneratedResult = {
  id: string;
  fileName: string;
  status: string;
  pdfAvailable: boolean;
  missingRequired: string[];
};

type PartyOption = {
  id: string;
  partyType: "employee" | "company" | "external_person" | "external_company";
  name: string;
  document: string;
  address: string;
  email: string;
  signatureName: string;
  signatureUserId: string;
};

const SELECT_OPTION_LABELS: Record<string, string> = {
  pix: "Pix",
  transfer: "Transferência bancária",
  cash: "Dinheiro",
};

function optionLabel(value: string) {
  return SELECT_OPTION_LABELS[value] ?? value;
}

function ManualInput(props: {
  binding: ManualFieldBinding;
  value: string;
  onChange: (value: string) => void;
}) {
  if (props.binding.format === "multiline") {
    return <textarea className="min-h-24 w-full rounded-md border bg-white p-2 text-sm" value={props.value} onChange={(event) => props.onChange(event.target.value)} />;
  }
  if (props.binding.format === "boolean_br") {
    return (
      <select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        <option value="">Selecione...</option>
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </select>
    );
  }
  if (props.binding.format === "select") {
    return (
      <select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        <option value="">Selecione...</option>
        {(props.binding.options ?? []).map((option) => <option key={option}>{option}</option>)}
      </select>
    );
  }
  return (
    <Input
      type={props.binding.format === "date_br" ? "date" : "text"}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function valueAt(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => record(value)[key], root);
}

function withValueAt(root: Record<string, unknown>, path: string, value: unknown) {
  const output = structuredClone(root);
  const parts = path.split(".");
  let cursor = output;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value;
    else cursor = cursor[part] = record(cursor[part]);
  });
  return output;
}

function PartySearchSelect(props: {
  availableParties: PartyOption[];
  allowedPartyTypes: DocumentFormField["allowedPartyTypes"];
  selection: string;
  onSelect: (selection: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const registeredPeople = props.availableParties.filter((option) =>
    option.partyType === "employee" || option.partyType === "external_person"
  );
  const registeredCompanies = props.availableParties.filter((option) =>
    option.partyType === "company" || option.partyType === "external_company"
  );
  const selected = props.availableParties.find((option) =>
    `registered:${option.partyType}:${option.id}` === props.selection
  );
  const selectedLabel = selected?.name
    ?? (props.selection === "manual:external_person"
      ? "Pessoa avulsa"
      : props.selection === "manual:external_company"
        ? "Empresa avulsa"
        : "Buscar pessoa ou empresa...");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between bg-white font-normal sm:col-span-2"
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[min(92vw,560px)] p-0"
      >
        <Command>
          <CommandInput placeholder="Buscar por nome, CPF, CNPJ ou e-mail..." />
          <CommandList>
            <CommandEmpty>Nenhum cadastro encontrado.</CommandEmpty>
            {registeredPeople.length ? (
              <CommandGroup heading="Pessoas cadastradas">
                {registeredPeople.map((option) => {
                  const value = `registered:${option.partyType}:${option.id}`;
                  return (
                    <CommandItem
                      key={value}
                      value={`${option.name} ${option.document} ${option.email} ${option.id}`}
                      onSelect={() => {
                        props.onSelect(value);
                        setOpen(false);
                      }}
                    >
                      <Check className={`mr-2 h-4 w-4 ${props.selection === value ? "opacity-100" : "opacity-0"}`} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{option.name}</span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {[option.document, option.email].filter(Boolean).join(" · ") || "Sem documento ou e-mail"}
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
            {registeredCompanies.length ? (
              <CommandGroup heading="Empresas cadastradas">
                {registeredCompanies.map((option) => {
                  const value = `registered:${option.partyType}:${option.id}`;
                  return (
                    <CommandItem
                      key={value}
                      value={`${option.name} ${option.document} ${option.email} ${option.id}`}
                      onSelect={() => {
                        props.onSelect(value);
                        setOpen(false);
                      }}
                    >
                      <Check className={`mr-2 h-4 w-4 ${props.selection === value ? "opacity-100" : "opacity-0"}`} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{option.name}</span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {[option.document, option.email].filter(Boolean).join(" · ") || "Sem documento ou e-mail"}
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
            <CommandGroup heading="Cadastro avulso">
              {props.allowedPartyTypes?.includes("external_person") ? (
                <CommandItem
                  value="Pessoa avulsa"
                  onSelect={() => {
                    props.onSelect("manual:external_person");
                    setOpen(false);
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${props.selection === "manual:external_person" ? "opacity-100" : "opacity-0"}`} />
                  Pessoa avulsa
                </CommandItem>
              ) : null}
              {props.allowedPartyTypes?.includes("external_company") ? (
                <CommandItem
                  value="Empresa avulsa"
                  onSelect={() => {
                    props.onSelect("manual:external_company");
                    setOpen(false);
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${props.selection === "manual:external_company" ? "opacity-100" : "opacity-0"}`} />
                  Empresa avulsa
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SchemaFieldInput(props: {
  field: DocumentFormField;
  formValues: Record<string, unknown>;
  partyOptions: PartyOption[];
  onChange: (values: Record<string, unknown>) => void;
}) {
  const { field, formValues, partyOptions, onChange } = props;
  if (!conditionMatches(field.condition, formValues) || field.kind === "calculated") return null;
  const current = valueAt(formValues, field.key);
  const set = (value: unknown) => onChange(withValueAt(formValues, field.key, value));
  const label = (
    <span className="text-xs font-bold text-slate-700">
      {field.label}{field.required ? " *" : ""}
    </span>
  );

  if (field.kind === "party") {
    const party = record(current);
    const snapshot = record(party.snapshot);
    const partyType = String(party.partyType ?? "");
    const allowedPartyTypes = field.allowedPartyTypes ?? [];
    const availableParties = partyOptions.filter((option) => allowedPartyTypes.includes(option.partyType));
    const registeredSelection = typeof party.ref === "string" && party.ref
      ? `registered:${partyType}:${party.ref}`
      : "";
    const manualSelection = !party.ref && (partyType === "external_person" || partyType === "external_company")
      ? `manual:${partyType}`
      : "";
    const selection = registeredSelection || manualSelection;
    const isManual = manualSelection !== "";
    const updateParty = (patch: Record<string, unknown>, snapshotPatch?: Record<string, unknown>) => {
      set({
        ...party,
        partyType,
        ...patch,
        snapshot: { ...snapshot, ...snapshotPatch },
      });
    };
    return (
      <div className="space-y-2 rounded-lg border bg-slate-50 p-3">
        {label}
        <p className="text-[11px] text-slate-500">
          Selecione uma pessoa ou empresa cadastrada, ou informe uma parte avulsa.
        </p>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(200px,1fr)]">
          <PartySearchSelect
            availableParties={availableParties}
            allowedPartyTypes={field.allowedPartyTypes}
            selection={selection}
            onSelect={(nextSelection) => {
              const selected = availableParties.find((option) =>
                `registered:${option.partyType}:${option.id}` === nextSelection
              );
              if (selected) {
                set({
                  partyType: selected.partyType,
                  ref: selected.id,
                  snapshot: {
                    name: selected.name,
                    document: selected.document,
                    address: selected.address,
                    email: selected.email,
                    signatureName: selected.signatureName,
                    signatureUserId: selected.signatureUserId,
                  },
                });
                return;
              }
              if (nextSelection === "manual:external_person") {
                set({ partyType: "external_person", ref: null, snapshot: {} });
                return;
              }
              if (nextSelection === "manual:external_company") {
                set({ partyType: "external_company", ref: null, snapshot: {} });
                return;
              }
              set(undefined);
            }}
          />
          {selection ? (
            <>
              <Input
                placeholder="Nome / razão social"
                readOnly={!isManual}
                value={String(snapshot.name ?? "")}
                onChange={(event) => updateParty({ ref: null }, { name: event.target.value })}
              />
              <Input
                placeholder="CPF / CNPJ"
                readOnly={!isManual}
                value={String(snapshot.document ?? "")}
                onChange={(event) => updateParty({ ref: null }, { document: event.target.value })}
              />
              <Input
                type="email"
                placeholder="E-mail para assinatura"
                readOnly={!isManual}
                value={String(snapshot.email ?? "")}
                onChange={(event) => updateParty({}, { email: event.target.value })}
              />
              <Input
                placeholder="Endereço"
                readOnly={!isManual}
                value={String(snapshot.address ?? "")}
                onChange={(event) => updateParty({ ref: null }, { address: event.target.value })}
              />
              {!isManual
              && ["company", "external_company"].includes(partyType)
              && snapshot.signatureName ? (
                <p className="text-[11px] font-medium text-violet-700 sm:col-span-2">
                  Assinatura pela empresa: {String(snapshot.signatureName)}
                  {snapshot.email ? ` · ${String(snapshot.email)}` : ""}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    );
  }

  if (field.kind === "repeatable") {
    const rows = Array.isArray(current) ? current.map(record) : [];
    return (
      <div className="space-y-2 rounded-lg border bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-2">
          {label}
          <Button type="button" size="sm" variant="outline" onClick={() => set([...rows, {}])}>Adicionar item</Button>
        </div>
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="grid gap-2 rounded-md border bg-white p-2 sm:grid-cols-[1fr_1fr_auto]">
            {(field.itemFields ?? []).map((itemField) => (
              <label key={itemField.key} className="space-y-1">
                <span className="text-[10px] font-bold text-slate-600">{itemField.label}</span>
                <Input
                  type={itemField.kind === "number" || itemField.kind === "currency" ? "number" : itemField.kind === "date" ? "date" : "text"}
                  step={itemField.kind === "currency" ? "0.01" : undefined}
                  value={String(row[itemField.key] ?? "")}
                  onChange={(event) => {
                    const next = [...rows];
                    next[rowIndex] = {
                      ...row,
                      [itemField.key]: itemField.kind === "number" || itemField.kind === "currency"
                        ? Number(event.target.value)
                        : event.target.value,
                    };
                    set(next);
                  }}
                />
              </label>
            ))}
            <Button type="button" size="sm" variant="ghost" className="self-end text-rose-600" onClick={() => set(rows.filter((_, index) => index !== rowIndex))}>Remover</Button>
          </div>
        ))}
      </div>
    );
  }

  if (field.kind === "select" || field.kind === "boolean") {
    return (
      <label className="block space-y-1.5">
        {label}
        <select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={String(current ?? "")} onChange={(event) => set(field.kind === "boolean" ? event.target.value === "true" : event.target.value)}>
          <option value="">Selecione...</option>
          {field.kind === "boolean"
            ? <><option value="true">Sim</option><option value="false">Não</option></>
            : (field.options ?? []).map((option) => <option key={option} value={option}>{optionLabel(option)}</option>)}
        </select>
      </label>
    );
  }

  return (
    <label className="block space-y-1.5">
      {label}
      {field.helpText ? <span className="block text-[11px] text-slate-500">{field.helpText}</span> : null}
      {field.kind === "multiline" ? (
        <textarea className="min-h-24 w-full rounded-md border bg-white p-2 text-sm" value={String(current ?? "")} onChange={(event) => set(event.target.value)} />
      ) : (
        <Input
          type={field.kind === "date" ? "date" : field.kind === "number" || field.kind === "currency" ? "number" : "text"}
          step={field.kind === "currency" ? "0.01" : undefined}
          value={String(current ?? "")}
          onChange={(event) => set(field.kind === "number" || field.kind === "currency" ? Number(event.target.value) : event.target.value)}
        />
      )}
    </label>
  );
}

export function DocumentGeneratorWorkspace(props: {
  embedded?: boolean;
  initialTemplateId?: string;
  onBack?: () => void;
  onGenerated?: (document: GeneratedResult) => void;
} = {}) {
  const { firebaseUser, permissions, activeUsers } = useAuth();
  const canGenerate = hasFormalizationPermission(permissions, "documents.generate");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [partyOptions, setPartyOptions] = useState<PartyOption[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [schemaStep, setSchemaStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<GeneratedResult | null>(null);

  const token = useCallback(async () => {
    if (!firebaseUser) throw new Error("Sessão expirada.");
    return firebaseUser.getIdToken();
  }, [firebaseUser]);

  useEffect(() => {
    if (!firebaseUser || !canGenerate) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const authorization = `Bearer ${await token()}`;
        const [templatesResponse, partiesResponse] = await Promise.all([
          fetch("/api/documents/generator/templates", {
            headers: { Authorization: authorization },
            cache: "no-store",
          }),
          fetch("/api/documents/generator/parties", {
            headers: { Authorization: authorization },
            cache: "no-store",
          }),
        ]);
        const [templatesPayload, partiesPayload] = await Promise.all([
          templatesResponse.json(),
          partiesResponse.json(),
        ]);
        if (!templatesResponse.ok) {
          throw new Error(templatesPayload.error || "Falha ao carregar modelos.");
        }
        if (!partiesResponse.ok) {
          throw new Error(partiesPayload.error || "Falha ao carregar cadastros.");
        }
        if (active) {
          const availableTemplates = (templatesPayload.templates ?? []).filter((template: Template) => template.status === "published");
          setTemplates(availableTemplates);
          if (props.initialTemplateId && availableTemplates.some((template: Template) => template.id === props.initialTemplateId)) {
            setTemplateId((current) => current || props.initialTemplateId!);
          }
          setPartyOptions(partiesPayload.parties ?? []);
        }
      } catch (cause) {
        if (active) setMessage(cause instanceof Error ? cause.message : "Falha ao carregar modelos.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canGenerate, firebaseUser, props.initialTemplateId, token]);

  const selected = templates.find((template) => template.id === templateId) ?? null;
  const manualFields = useMemo(
    () => Object.entries(selected?.fieldMapping ?? {}).filter(
      (entry): entry is [string, ManualFieldBinding] => entry[1].kind === "manual",
    ),
    [selected],
  );
  const filteredTemplates = useMemo(() => {
    const term = templateSearch.trim().toLocaleLowerCase("pt-BR");
    return term
      ? templates.filter((template) => `${template.name} ${template.category}`.toLocaleLowerCase("pt-BR").includes(term))
      : templates;
  }, [templateSearch, templates]);
  const filteredEmployees = useMemo(() => {
    const term = employeeSearch.trim().toLocaleLowerCase("pt-BR");
    return activeUsers
      .filter((user) => !term || `${user.username} ${user.email}`.toLocaleLowerCase("pt-BR").includes(term))
      .sort((left, right) => left.username.localeCompare(right.username, "pt-BR"));
  }, [activeUsers, employeeSearch]);

  async function openSystemTemplate() {
    if (!selected) return;
    if (selected.renderer === "uniform") {
      window.location.href = "/dashboard/stock/uniforms";
      return;
    }
    if (!selected.previewUrl) return;
    const response = await fetch(selected.previewUrl, {
      headers: { Authorization: `Bearer ${await token()}` },
      cache: "no-store",
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Falha ao abrir o modelo.");
    }
    const url = URL.createObjectURL(await response.blob());
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function generate() {
    if (!selected) return;
    const needsEmployee = !selected.formSchema || selected.formSchema.anchor === "employee";
    if (needsEmployee && !employeeId) return;
    setGenerating(true);
    setMessage("");
    setNotice("");
    setResult(null);
    try {
      const response = await fetch("/api/documents/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await token()}`,
        },
        body: JSON.stringify({
          templateId: selected.id,
          employeeId,
          manualValues,
          formValues,
          lifecycle: "draft",
          output: "json",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao gerar documento.");
      setResult(payload.document);
      props.onGenerated?.(payload.document);
      setNotice(
        payload.document.pdfAvailable
          ? "Prévia gerada. Confira o PDF antes de finalizar."
          : "O DOCX foi gerado, mas o conversor PDF está indisponível. A finalização foi bloqueada.",
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao gerar documento.");
    } finally {
      setGenerating(false);
    }
  }

  async function openGeneratedPdf() {
    if (!result?.pdfAvailable) return;
    const previewWindow = window.open("about:blank", "_blank");
    if (previewWindow) previewWindow.opener = null;
    try {
      const response = await fetch(`/api/documents/generated/${encodeURIComponent(result.id)}/file?format=pdf`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      if (!response.ok) throw new Error("Falha ao abrir o PDF.");
      const url = URL.createObjectURL(await response.blob());
      if (previewWindow) previewWindow.location.href = url;
      else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.target = "_blank";
        anchor.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      previewWindow?.close();
      setMessage(cause instanceof Error ? cause.message : "Falha ao abrir o PDF.");
    }
  }

  if (!canGenerate) return <p className="p-6 text-sm text-slate-500">Sem permissão para gerar documentos.</p>;

  return (
    <div className={props.embedded ? "h-full" : "space-y-4"}>
      {!props.embedded ? <header>
        <p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">Documentos</p>
        <h1 className="text-xl font-black text-slate-950">Gerador de documentos</h1>
        <p className="text-xs text-slate-500">Escolha um modelo publicado, confira os dados e gere uma prévia oficial.</p>
      </header> : null}

      {message ? <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{message}</div> : null}
      {notice ? <div className="rounded-lg border border-teal-100 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800">{notice}</div> : null}

      <div className={props.embedded
        ? "grid min-h-[680px] lg:grid-cols-[280px_minmax(0,1fr)]"
        : "grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]"
      }>
        <section className={props.embedded ? "border-r bg-white" : "rounded-lg border bg-white shadow-sm"}>
          <header className="border-b px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-slate-900">Modelos</h2>
              {props.embedded && props.onBack ? (
                <button type="button" className="text-[11px] font-bold text-teal-700" onClick={props.onBack}>
                  Voltar à fila
                </button>
              ) : null}
            </div>
          </header>
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder="Buscar modelo..." value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} />
            </div>
            {loading ? <div className="grid min-h-32 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-teal-700" /></div> : (
              <div className={props.embedded ? "mt-3 grid gap-2" : "mt-3 grid gap-2 md:grid-cols-2"}>
                {filteredTemplates.map((template) => (
                  <button
                    key={template.id}
                    className={`rounded-lg border p-3 text-left transition ${templateId === template.id ? "border-teal-500 bg-teal-50 ring-1 ring-teal-500" : "hover:border-teal-200"}`}
                    onClick={() => {
                      setTemplateId(template.id);
                      setManualValues({});
                      setFormValues({});
                      setSchemaStep(0);
                      setResult(null);
                    }}
                  >
                    <span className="flex items-start gap-2">
                      <FileStack className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                      <span>
                        <span className="block text-xs font-black text-slate-900">{template.name}</span>
                        <span className="mt-1 block text-[11px] text-slate-500">{template.category} · versão {template.version}</span>
                        {template.isSystem ? <span className="mt-2 inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-bold uppercase text-violet-700">Modelo do sistema</span> : null}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={props.embedded ? "bg-[#fbfaf8]" : "rounded-lg border bg-white shadow-sm"}>
          <header className="border-b px-4 py-3">
            <h2 className="text-sm font-black text-slate-900">2. Dados e geração</h2>
          </header>
          {!selected ? (
            <div className="grid min-h-64 place-items-center p-6 text-center text-xs text-slate-500">
              <div><FilePlus2 className="mx-auto mb-2 h-8 w-8 text-slate-300" />Selecione um modelo para continuar.</div>
            </div>
          ) : selected.formSchema ? (
            <div className="space-y-4 p-4">
              <div className="flex flex-wrap gap-2">
                {selected.formSchema.steps.map((step, index) => (
                  <button key={step.id} type="button" onClick={() => setSchemaStep(index)} className={`rounded-full px-3 py-1 text-[10px] font-bold ${schemaStep === index ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-600"}`}>
                    {index + 1}. {step.title}
                  </button>
                ))}
              </div>
              {selected.formSchema.anchor !== "none" ? (
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold text-slate-700">Colaborador{selected.formSchema.anchor === "employee" ? " *" : ""}</span>
                  <Input placeholder="Buscar colaborador..." value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} />
                  <select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                    <option value="">Selecione...</option>
                    {filteredEmployees.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}
                  </select>
                </label>
              ) : null}
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-black text-slate-900">{selected.formSchema.steps[schemaStep]?.title}</h3>
                  {selected.formSchema.steps[schemaStep]?.description ? <p className="text-xs text-slate-500">{selected.formSchema.steps[schemaStep].description}</p> : null}
                </div>
                {(selected.formSchema.steps[schemaStep]?.fields ?? []).map((field) => (
                  <SchemaFieldInput
                    key={field.key}
                    field={field}
                    formValues={formValues}
                    partyOptions={partyOptions}
                    onChange={setFormValues}
                  />
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" className="h-9 min-w-24 px-4" disabled={schemaStep === 0} onClick={() => setSchemaStep((current) => Math.max(0, current - 1))}>Anterior</Button>
                {schemaStep < selected.formSchema.steps.length - 1 ? (
                  <Button type="button" className="h-9 min-w-24 px-4" onClick={() => setSchemaStep((current) => Math.min(selected.formSchema!.steps.length - 1, current + 1))}>Próximo</Button>
                ) : (
                  <Button className="h-9 min-w-32 gap-2 px-4" disabled={(selected.formSchema.anchor === "employee" && !employeeId) || generating} onClick={() => void generate()}>
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
                    Gerar prévia
                  </Button>
                )}
              </div>
              {result ? (
                <div className={`rounded-lg border p-3 ${result.pdfAvailable ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                  <p className="flex items-center gap-2 text-xs font-black text-slate-900">
                    {result.pdfAvailable ? <FileCheck2 className="h-4 w-4 text-emerald-600" /> : <CircleAlert className="h-4 w-4 text-amber-600" />}
                    {result.pdfAvailable ? "Prévia em PDF pronta para conferência" : "DOCX gerado; PDF ainda indisponível"}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-600">
                    {result.pdfAvailable
                      ? "Abra o PDF, confira o conteúdo e depois volte à fila para aprovar."
                      : "A conversão não foi concluída. O documento não poderá ser aprovado até o PDF existir."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {result.pdfAvailable ? (
                      <Button size="sm" variant="outline" onClick={() => void openGeneratedPdf()}>
                        <Eye className="mr-2 h-4 w-4" />Conferir PDF
                      </Button>
                    ) : null}
                    {props.onBack ? (
                      <Button size="sm" variant="outline" onClick={props.onBack}>Voltar à fila</Button>
                    ) : (
                      <Button size="sm" variant="outline" asChild>
                        <Link href="/dashboard/documents/generated">Abrir documentos gerados</Link>
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : selected.isSystem ? (
            <div className="space-y-4 p-4">
              <div className="rounded-lg border border-violet-100 bg-violet-50 p-3 text-xs text-violet-900">
                {selected.renderer === "uniform"
                  ? "Este termo é gerado pela própria movimentação de uniformes, usando o mesmo padrão documental."
                  : "Este é um modelo institucional protegido e não possui campos de colaborador."}
              </div>
              <Button className="w-full gap-2" onClick={() => void openSystemTemplate()}>
                <ExternalLink className="h-4 w-4" />
                {selected.renderer === "uniform" ? "Abrir movimentação de uniformes" : "Abrir modelo"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-700">Colaborador</span>
                <Input placeholder="Buscar colaborador..." value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} />
                <select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                  <option value="">Selecione...</option>
                  {filteredEmployees.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}
                </select>
              </label>

              {manualFields.map(([placeholder, binding]) => (
                <label key={placeholder} className="block space-y-1.5">
                  <span className="text-xs font-bold text-slate-700">{binding.label}{binding.required ? " *" : ""}</span>
                  {binding.helpText ? <span className="block text-[11px] text-slate-500">{binding.helpText}</span> : null}
                  <ManualInput binding={binding} value={manualValues[placeholder] ?? ""} onChange={(value) => setManualValues((current) => ({ ...current, [placeholder]: value }))} />
                </label>
              ))}

              <Button className="w-full gap-2" disabled={!employeeId || generating} onClick={() => void generate()}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
                Gerar prévia
              </Button>

              {result ? (
                <div className={`rounded-lg border p-3 ${result.pdfAvailable ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                  <p className="flex items-center gap-2 text-xs font-black text-slate-900">
                    {result.pdfAvailable ? <FileCheck2 className="h-4 w-4 text-emerald-600" /> : <CircleAlert className="h-4 w-4 text-amber-600" />}
                    Prévia registrada
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {result.pdfAvailable ? <Button size="sm" variant="outline" onClick={() => void openGeneratedPdf()}>Conferir PDF</Button> : null}
                    <Button size="sm" variant="outline" asChild><Link href="/dashboard/documents/generated">Abrir documentos gerados</Link></Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
