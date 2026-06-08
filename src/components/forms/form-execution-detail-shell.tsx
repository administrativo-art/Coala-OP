"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  GalleryVerticalEnd,
  History,
  List,
  Loader2,
  MapPin,
  Paperclip,
  Save,
  UploadCloud,
  UserCheck,
  XCircle,
} from "lucide-react";

import type {
  FormConditionalRule,
  FormExecution,
  FormExecutionEvent,
  FormExecutionItem,
  FormExecutionSection,
} from "@/types/forms";
import { useAuth } from "@/hooks/use-auth";
import {
  claimFormExecution,
  deleteFormAsset,
  fetchFormExecution,
  updateFormExecution,
  uploadFormAsset,
} from "@/features/forms/lib/client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PhotoCaptureModal } from "@/components/photo-capture-modal";
import { SignatureCaptureModal } from "@/components/forms/signature-capture-modal";

type DraftItem = Record<string, unknown> & {
  template_item_id: string;
  section_id: string;
};

type DraftSection = {
  section_id: string;
  photo_url: string;
  signature_url: string;
};

type EvidenceTarget =
  | { scope: "item"; itemId: string; kind: "photo" | "signature" | "file" }
  | { scope: "section"; sectionId: string; kind: "photo" | "signature" };

const STATUS_META: Record<
  FormExecution["status"],
  { label: string; className: string }
> = {
  pending: {
    label: "Pendente",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  in_progress: {
    label: "Em andamento",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  completed: {
    label: "Concluída",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  overdue: {
    label: "Atrasada",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  canceled: {
    label: "Cancelada",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  },
};

function normalizeDraftItem(item: FormExecutionItem): DraftItem {
  return {
    template_item_id: item.template_item_id,
    section_id: item.section_id,
    checked: item.checked ?? null,
    yes_no_value: item.yes_no_value ?? null,
    text_value: item.text_value ?? "",
    number_value: item.number_value,
    multi_values: item.multi_values ?? [],
    date_value: item.date_value ?? "",
    photo_urls: item.photo_urls ?? [],
    file_urls: item.file_urls ?? [],
    signature_url: item.signature_url ?? "",
    location: item.location ?? null,
  };
}

function normalizeDraftSection(section: FormExecutionSection): DraftSection {
  return {
    section_id: section.id,
    photo_url: section.photo_url ?? "",
    signature_url: section.signature_url ?? "",
  };
}

function getStatusLabel(status: string) {
  return STATUS_META[status as FormExecution["status"]]?.label ?? status;
}

function getAnswer(item: DraftItem | FormExecutionItem) {
  if (typeof item.checked === "boolean") return item.checked;
  if (typeof item.yes_no_value === "boolean") return item.yes_no_value;
  if (typeof item.text_value === "string" && item.text_value.trim()) return item.text_value.trim();
  if (typeof item.number_value === "number") return item.number_value;
  if (Array.isArray(item.multi_values) && item.multi_values.length > 0) return item.multi_values;
  if (typeof item.date_value === "string" && item.date_value.trim()) return item.date_value.trim();
  if (Array.isArray(item.photo_urls) && item.photo_urls.length > 0) return item.photo_urls;
  if (typeof item.signature_url === "string" && item.signature_url.trim()) return item.signature_url.trim();
  if (Array.isArray(item.file_urls) && item.file_urls.length > 0) return item.file_urls;
  if (item.location) return item.location;
  return null;
}

function evaluateCondition(
  rule: FormConditionalRule | undefined,
  itemsByTemplateId: Map<string, DraftItem>
): boolean {
  if (!rule) return true;
  const item = itemsByTemplateId.get(rule.item_id);
  if (!item) return false;
  const answer = getAnswer(item);
  const expected = rule.value;

  switch (rule.operator) {
    case "equals":
      return answer === expected;
    case "not_equals":
      return answer !== expected;
    case "gt":
      return typeof answer === "number" && typeof expected === "number" && answer > expected;
    case "lt":
      return typeof answer === "number" && typeof expected === "number" && answer < expected;
    case "gte":
      return typeof answer === "number" && typeof expected === "number" && answer >= expected;
    case "lte":
      return typeof answer === "number" && typeof expected === "number" && answer <= expected;
    case "contains":
      if (Array.isArray(answer)) return answer.includes(expected as never);
      if (typeof answer === "string" && typeof expected === "string") {
        return answer.includes(expected);
      }
      return false;
    case "is_empty":
      return answer === null || answer === undefined || answer === "";
    case "is_not_empty":
      return !(answer === null || answer === undefined || answer === "");
    default:
      return false;
  }
}

function isItemCompleted(item: DraftItem | FormExecutionItem) {
  if (item.type === "checkbox") return typeof item.checked === "boolean";
  if (item.type === "yes_no") return typeof item.yes_no_value === "boolean";
  if (item.type === "text" || item.type === "select") {
    return typeof item.text_value === "string" && item.text_value.trim().length > 0;
  }
  if (item.type === "number" || item.type === "temperature") {
    return typeof item.number_value === "number";
  }
  if (item.type === "photo") return Array.isArray(item.photo_urls) && item.photo_urls.length > 0;
  if (item.type === "signature") {
    return typeof item.signature_url === "string" && item.signature_url.trim().length > 0;
  }
  if (item.type === "multi_select") {
    return Array.isArray(item.multi_values) && item.multi_values.length > 0;
  }
  if (item.type === "date") return typeof item.date_value === "string" && item.date_value.trim().length > 0;
  if (item.type === "file_upload") return Array.isArray(item.file_urls) && item.file_urls.length > 0;
  if (item.type === "location") return !!item.location;
  return false;
}

function formatDateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatRelative(value: unknown) {
  if (!value) return "Nunca";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const diffMs = Date.now() - date.getTime();
  const absMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
  if (absMinutes < 60) return `${absMinutes} min atrás`;
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return `${absHours} h atrás`;
  const absDays = Math.round(absHours / 24);
  return `${absDays} dia(s) atrás`;
}

function extractAssetPathFromUrl(value: unknown) {
  if (typeof value !== "string" || !value) return null;

  try {
    const parsed = new URL(value);
    const marker = "/o/";
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return null;
    return decodeURIComponent(parsed.pathname.slice(index + marker.length));
  } catch {
    return null;
  }
}

function dataUrlToFile(dataUrl: string, fallbackName: string) {
  const [meta, content] = dataUrl.split(",");
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] ?? "image/png";
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], fallbackName, { type: mime });
}

function buildExecutionView(
  execution: FormExecution,
  drafts: Record<string, DraftItem>,
  sectionDrafts: Record<string, DraftSection>
) {
  const executionItems = execution.items ?? [];
  const itemsByTemplateId = new Map<string, DraftItem>();
  for (const item of executionItems) {
    itemsByTemplateId.set(item.template_item_id, {
      ...item,
      ...(drafts[item.id] ?? normalizeDraftItem(item)),
    });
  }

  const visibleSectionIds = new Set(
    execution.sections
      .filter((section) => evaluateCondition(section.show_if, itemsByTemplateId))
      .map((section) => section.id)
  );

  const visibleItems = executionItems.filter((item) => {
    if (!visibleSectionIds.has(item.section_id)) return false;
    return evaluateCondition(item.show_if, itemsByTemplateId);
  });

  const requiredItems = visibleItems.filter((item) => item.required);
  const completedItems = visibleItems.filter((item) =>
    isItemCompleted({ ...item, ...(drafts[item.id] ?? normalizeDraftItem(item)) })
  );
  const completedRequiredItems = requiredItems.filter((item) =>
    isItemCompleted({ ...item, ...(drafts[item.id] ?? normalizeDraftItem(item)) })
  );
  const criticalAlerts = visibleItems.filter((item) => {
    const draft = { ...item, ...(drafts[item.id] ?? normalizeDraftItem(item)) };
    if (draft.criticality !== "critical" && draft.criticality !== "high") return false;
    if (draft.type === "yes_no") return draft.yes_no_value === false;
    if (draft.type === "checkbox") return draft.checked === false;
    return draft.is_out_of_range === true;
  }).length;

  const sectionBlockedAt = execution.sections.reduce((blockedAt, section, index) => {
    if (blockedAt !== execution.sections.length) return blockedAt;
    const sectionItems = visibleItems
      .filter((item) => item.section_id === section.id)
      .sort((left, right) => left.order - right.order);
    for (const item of sectionItems) {
      const draft = { ...item, ...(drafts[item.id] ?? normalizeDraftItem(item)) };
      if (draft.block_next && !isItemCompleted(draft)) {
        return index;
      }
    }
    return blockedAt;
  }, execution.sections.length);

  const missingSectionEvidence = execution.sections
    .filter((section) => visibleSectionIds.has(section.id))
    .some((section) => {
      const draft = sectionDrafts[section.id] ?? normalizeDraftSection(section);
      return (
        (section.require_photo && !draft.photo_url.trim()) ||
        (section.require_signature && !draft.signature_url.trim())
      );
    });

  return {
    visibleSectionIds,
    visibleItems,
    completedItems: completedItems.length,
    activeItems: visibleItems.length,
    requiredItems: requiredItems.length,
    completedRequiredItems: completedRequiredItems.length,
    completionPercent:
      visibleItems.length > 0 ? Math.round((completedItems.length / visibleItems.length) * 100) : 100,
    criticalAlerts,
    sectionBlockedAt,
    missingSectionEvidence,
  };
}

function SectionEvidenceCard({
  section,
  draft,
  canEdit,
  uploadingKey,
  onCapturePhoto,
  onCaptureSignature,
  onUpload,
  onRemove,
}: {
  section: FormExecutionSection;
  draft: DraftSection;
  canEdit: boolean;
  uploadingKey: string | null;
  onCapturePhoto: () => void;
  onCaptureSignature: () => void;
  onUpload: (kind: "photo" | "signature", file: File) => void;
  onRemove: (kind: "photo" | "signature", url: string) => void;
}) {
  if (!section.require_photo && !section.require_signature) {
    return null;
  }

  return (
    <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
      <div>
        <p className="text-sm font-medium">Evidências da seção</p>
        <p className="text-xs text-muted-foreground">
          Esta seção exige anexos antes da conclusão.
        </p>
      </div>

      {section.require_photo ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Foto da seção</span>
            {draft.photo_url ? (
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">OK</Badge>
            ) : (
              <Badge className="border-amber-200 bg-amber-50 text-amber-700">Pendente</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={onCapturePhoto}>
              <Camera className="mr-2 h-4 w-4" />
              Tirar foto
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <UploadCloud className="h-4 w-4" />
              {uploadingKey === `${section.id}:section:photo` ? "Enviando..." : "Enviar foto"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={!canEdit || uploadingKey === `${section.id}:section:photo`}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload("photo", file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          {draft.photo_url ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="truncate">{draft.photo_url}</span>
              <Button type="button" variant="ghost" size="sm" disabled={!canEdit} onClick={() => onRemove("photo", draft.photo_url)}>
                Remover
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {section.require_signature ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Assinatura da seção</span>
            {draft.signature_url ? (
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">OK</Badge>
            ) : (
              <Badge className="border-amber-200 bg-amber-50 text-amber-700">Pendente</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={onCaptureSignature}>
              <Paperclip className="mr-2 h-4 w-4" />
              Assinar
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <UploadCloud className="h-4 w-4" />
              {uploadingKey === `${section.id}:section:signature` ? "Enviando..." : "Enviar assinatura"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={!canEdit || uploadingKey === `${section.id}:section:signature`}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload("signature", file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          {draft.signature_url ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="truncate">{draft.signature_url}</span>
              <Button type="button" variant="ghost" size="sm" disabled={!canEdit} onClick={() => onRemove("signature", draft.signature_url)}>
                Remover
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FormExecutionDetailShell({ executionId }: { executionId: string }) {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [execution, setExecution] = useState<FormExecution | null>(null);
  const [events, setEvents] = useState<FormExecutionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftItem>>({});
  const [sectionDrafts, setSectionDrafts] = useState<Record<string, DraftSection>>({});
  const [submitting, setSubmitting] = useState<null | "claim" | "save" | "complete" | "reopen" | "cancel">(null);
  const [autosaveState, setAutosaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [evidenceTarget, setEvidenceTarget] = useState<EvidenceTarget | null>(null);
  const [sectionsMode, setSectionsMode] = useState(false);
  const [sectionIdx, setSectionIdx] = useState(0);
  const initializedRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDraftRef = useRef<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSectionsMode(localStorage.getItem("forms-sections-mode") === "true");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!firebaseUser) return;

      try {
        const payload = await fetchFormExecution(firebaseUser, executionId);
        if (!cancelled) {
          const nextDrafts = Object.fromEntries(
            (payload.execution.items ?? []).map((item) => [item.id, normalizeDraftItem(item)])
          );
          const nextSections = Object.fromEntries(
            (payload.execution.sections ?? []).map((section) => [section.id, normalizeDraftSection(section)])
          );
          setExecution(payload.execution);
          setEvents(payload.events);
          setDrafts(nextDrafts);
          setSectionDrafts(nextSections);
          lastSavedDraftRef.current = JSON.stringify({ items: nextDrafts, sections: nextSections });
          initializedRef.current = true;
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Falha ao carregar execução."
          );
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, executionId]);

  const canEdit = execution?.status === "in_progress" || execution?.status === "pending";

  const executionView = useMemo(() => {
    if (!execution) return null;
    return buildExecutionView(execution, drafts, sectionDrafts);
  }, [drafts, execution, sectionDrafts]);

  useEffect(() => {
    if (sectionsMode && execution) {
      setSectionIdx((current) => Math.min(current, Math.max(0, execution.sections.length - 1)));
    }
  }, [execution, sectionsMode]);

  async function refreshExecution() {
    if (!firebaseUser) return;
    const payload = await fetchFormExecution(firebaseUser, executionId);
    const nextDrafts = Object.fromEntries(
      (payload.execution.items ?? []).map((item) => [item.id, normalizeDraftItem(item)])
    );
    const nextSections = Object.fromEntries(
      (payload.execution.sections ?? []).map((section) => [section.id, normalizeDraftSection(section)])
    );
    setExecution(payload.execution);
    setEvents(payload.events);
    setDrafts(nextDrafts);
    setSectionDrafts(nextSections);
    lastSavedDraftRef.current = JSON.stringify({ items: nextDrafts, sections: nextSections });
    setAutosaveState("idle");
  }

  function updateDraft(itemId: string, patch: Partial<DraftItem>) {
    setDrafts((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] ?? {}),
        ...patch,
      },
    }));
  }

  function updateSectionDraft(sectionId: string, patch: Partial<DraftSection>) {
    setSectionDrafts((current) => ({
      ...current,
      [sectionId]: {
        ...(current[sectionId] ?? { section_id: sectionId, photo_url: "", signature_url: "" }),
        ...patch,
      },
    }));
  }

  async function handleAssetUpload(
    target: EvidenceTarget,
    file: File
  ) {
    if (!firebaseUser || !execution) return;

    try {
      setUploadingKey(
        target.scope === "item"
          ? `${target.itemId}:${target.kind}`
          : `${target.sectionId}:section:${target.kind}`
      );
      const uploaded = await uploadFormAsset(firebaseUser, { file, kind: target.kind });

      if (target.scope === "item") {
        const item = (execution.items ?? []).find((entry) => entry.id === target.itemId);
        if (!item) return;
        if (target.kind === "photo") {
          const currentUrls = Array.isArray(drafts[item.id]?.photo_urls)
            ? (drafts[item.id]?.photo_urls as string[])
            : [];
          updateDraft(item.id, { photo_urls: [...currentUrls, uploaded.assetUrl] });
        } else if (target.kind === "signature") {
          updateDraft(item.id, { signature_url: uploaded.assetUrl });
        } else {
          const currentFiles = Array.isArray(drafts[item.id]?.file_urls)
            ? (drafts[item.id]?.file_urls as Array<Record<string, unknown>>)
            : [];
          updateDraft(item.id, {
            file_urls: [
              ...currentFiles,
              {
                url: uploaded.assetUrl,
                name: uploaded.fileName,
                mime: uploaded.mime,
              },
            ],
          });
        }
      } else if (target.kind === "photo") {
        updateSectionDraft(target.sectionId, { photo_url: uploaded.assetUrl });
      } else {
        updateSectionDraft(target.sectionId, { signature_url: uploaded.assetUrl });
      }

      toast({ title: "Arquivo enviado" });
    } catch (uploadError) {
      toast({
        variant: "destructive",
        title: uploadError instanceof Error ? uploadError.message : "Falha ao enviar arquivo.",
      });
    } finally {
      setUploadingKey(null);
      setEvidenceTarget(null);
    }
  }

  async function handleAssetDelete(target: EvidenceTarget, targetUrl: string) {
    if (!firebaseUser || !execution || !canEdit) return;

    try {
      setUploadingKey(
        target.scope === "item"
          ? `${target.itemId}:${target.kind}:delete`
          : `${target.sectionId}:section:${target.kind}:delete`
      );
      const assetPath = extractAssetPathFromUrl(targetUrl);
      if (assetPath) {
        await deleteFormAsset(firebaseUser, assetPath);
      }

      if (target.scope === "item") {
        if (target.kind === "photo") {
          const currentUrls = Array.isArray(drafts[target.itemId]?.photo_urls)
            ? (drafts[target.itemId]?.photo_urls as string[])
            : [];
          updateDraft(target.itemId, {
            photo_urls: currentUrls.filter((url) => url !== targetUrl),
          });
        } else if (target.kind === "signature") {
          updateDraft(target.itemId, { signature_url: "" });
        } else {
          const currentFiles = Array.isArray(drafts[target.itemId]?.file_urls)
            ? (drafts[target.itemId]?.file_urls as Array<Record<string, unknown>>)
            : [];
          updateDraft(target.itemId, {
            file_urls: currentFiles.filter(
              (entry) =>
                !entry ||
                typeof entry !== "object" ||
                String((entry as Record<string, unknown>).url ?? "") !== targetUrl
            ),
          });
        }
      } else if (target.kind === "photo") {
        updateSectionDraft(target.sectionId, { photo_url: "" });
      } else {
        updateSectionDraft(target.sectionId, { signature_url: "" });
      }

      toast({ title: "Arquivo removido" });
    } catch (deleteError) {
      toast({
        variant: "destructive",
        title: deleteError instanceof Error ? deleteError.message : "Falha ao remover arquivo.",
      });
    } finally {
      setUploadingKey(null);
    }
  }

  async function autosaveDrafts() {
    if (!firebaseUser || !canEdit || submitting !== null || !execution) return;

    try {
      setAutosaveState("saving");
      await updateFormExecution(firebaseUser, executionId, {
        action: "save",
        items: Object.values(drafts),
        sections: Object.values(sectionDrafts),
      });
      lastSavedDraftRef.current = JSON.stringify({ items: drafts, sections: sectionDrafts });
      setAutosaveState("saved");
    } catch {
      setAutosaveState("error");
    }
  }

  async function runAction(action: "claim" | "save" | "complete" | "reopen" | "cancel") {
    if (!firebaseUser) return;

    try {
      setSubmitting(action);

      if (action === "claim") {
        await claimFormExecution(firebaseUser, executionId);
      } else {
        await updateFormExecution(firebaseUser, executionId, {
          action,
          items: Object.values(drafts),
          sections: Object.values(sectionDrafts),
        });
      }

      await refreshExecution();
      toast({
        title:
          action === "claim"
            ? "Execução assumida"
            : action === "save"
              ? "Respostas salvas"
              : action === "complete"
                ? "Execução concluída"
                : action === "reopen"
                  ? "Execução reaberta"
                  : "Execução cancelada",
      });
    } catch (actionError) {
      setAutosaveState("error");
      toast({
        variant: "destructive",
        title: actionError instanceof Error ? actionError.message : "Falha ao atualizar execução.",
      });
    } finally {
      setSubmitting(null);
    }
  }

  useEffect(() => {
    if (!initializedRef.current || !canEdit) return;

    const serialized = JSON.stringify({ items: drafts, sections: sectionDrafts });
    if (serialized === lastSavedDraftRef.current) return;

    setAutosaveState("dirty");

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      void autosaveDrafts();
    }, 900);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [canEdit, drafts, executionId, firebaseUser, sectionDrafts, submitting]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  function toggleSectionsMode() {
    setSectionsMode((current) => {
      const next = !current;
      localStorage.setItem("forms-sections-mode", String(next));
      return next;
    });
    setSectionIdx(0);
  }

  function renderAutosaveLabel() {
    if (autosaveState === "dirty") return "Alterações pendentes";
    if (autosaveState === "saving") return "Salvando automaticamente";
    if (autosaveState === "saved") return "Salvo automaticamente";
    if (autosaveState === "error") return "Falha no autosave";
    return "Sem alterações pendentes";
  }

  if (!execution && !error) {
    return <Skeleton className="h-80 w-full" />;
  }

  if (error || !execution || !executionView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Preenchimento</CardTitle>
          <CardDescription>{error ?? "Preenchimento não encontrado."}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const currentSection = sectionsMode ? execution.sections[sectionIdx] : null;
  const sectionIdsToRender = sectionsMode && currentSection ? [currentSection.id] : execution.sections.map((section) => section.id);
  const remainingRequired = Math.max(executionView.requiredItems - executionView.completedRequiredItems, 0);

  return (
    <div className="-m-4 flex min-h-screen flex-col md:-m-8">
      <div className="sticky top-0 z-10 flex h-[52px] shrink-0 items-center gap-3 border-b bg-background px-5">
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/dashboard/forms" className="transition-colors hover:text-foreground">
            Formulários
          </Link>
          <span className="text-border">›</span>
          <span className="font-medium text-foreground">{execution.template_name}</span>
        </nav>
        <div className="flex-1" />
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href="/dashboard/forms">Voltar à lista</Link>
        </Button>
        {execution.status === "pending" ? (
          <Button onClick={() => void runAction("claim")} disabled={submitting !== null} size="sm">
            {submitting === "claim" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
            Assumir
          </Button>
        ) : null}
      </div>

      <div className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-6 pb-28 lg:px-6">
        <div className="overflow-hidden rounded-2xl border">
          <div className="flex flex-col gap-3 border-b bg-slate-50 px-5 py-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={STATUS_META[execution.status].className}>
                  {getStatusLabel(execution.status)}
                </Badge>
                <Badge variant="outline">{execution.occurrence_type ?? "manual"}</Badge>
                {executionView.criticalAlerts > 0 ? (
                  <Badge variant="destructive">{executionView.criticalAlerts} alerta(s)</Badge>
                ) : null}
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Preenchimento
                </p>
                <p className="text-base font-semibold">
                  {execution.unit_name ?? execution.unit_id} • {execution.assigned_username}
                </p>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Status: {getStatusLabel(execution.status)}</span>
                <span>Atualizado {formatRelative(execution.updated_at)}</span>
                <span>{formatDateTime(execution.updated_at)}</span>
              </div>
              <p className="flex items-center gap-2 text-xs text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {renderAutosaveLabel()}
              </p>
            </div>

            <div className="min-w-[180px] space-y-1 text-right">
              <div className="mb-1 flex justify-end">
                <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={toggleSectionsMode}>
                  {sectionsMode ? (
                    <>
                      <List className="h-3.5 w-3.5" />
                      Lista
                    </>
                  ) : (
                    <>
                      <GalleryVerticalEnd className="h-3.5 w-3.5" />
                      Seções
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Progresso
              </p>
              <p className="text-2xl font-semibold tracking-tight">
                {executionView.completedItems}
                <span className="text-sm font-medium text-muted-foreground">
                  {" "}
                  / {executionView.activeItems}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">{executionView.completionPercent}% respondido</p>
            </div>
          </div>

          <div className="space-y-3 px-5 py-4">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">Progresso atual</span>
              <span className="font-semibold text-emerald-700">
                {executionView.completionPercent}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  execution.status === "overdue" ? "bg-red-500" : "bg-emerald-500"
                )}
                style={{ width: `${Math.max(executionView.completionPercent, 4)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Obrigatórios</p>
              <p className="mt-2 text-2xl font-semibold">{executionView.completedRequiredItems}/{executionView.requiredItems}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Score</p>
              <p className="mt-2 text-2xl font-semibold">{execution.score ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Seções</p>
              <p className="mt-2 text-2xl font-semibold">{execution.sections.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Evidência</p>
              <p className="mt-2 text-sm font-medium">
                {executionView.missingSectionEvidence ? "Pendente" : "Em dia"}
              </p>
            </CardContent>
          </Card>
        </div>

        {sectionIdsToRender.map((sectionId, sectionRenderIndex) => {
          const section = execution.sections.find((entry) => entry.id === sectionId);
          if (!section || !executionView.visibleSectionIds.has(section.id)) return null;
          const visibleItems = (execution.items ?? [])
            .filter((item) => item.section_id === section.id)
            .filter((item) => executionView.visibleItems.some((visibleItem) => visibleItem.id === item.id))
            .sort((left, right) => left.order - right.order);

          let blockReached = false;

          return (
            <div key={section.id} className="space-y-3 rounded-2xl border p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Seção {sectionsMode ? sectionIdx + 1 : sectionRenderIndex + 1}
                  </p>
                  <h3 className="font-semibold">{section.title}</h3>
                </div>
                <div className="flex gap-2">
                  {section.require_photo ? <Badge variant="outline">Foto obrigatória</Badge> : null}
                  {section.require_signature ? <Badge variant="outline">Assinatura obrigatória</Badge> : null}
                </div>
              </div>

              <SectionEvidenceCard
                section={section}
                draft={sectionDrafts[section.id] ?? normalizeDraftSection(section)}
                canEdit={canEdit}
                uploadingKey={uploadingKey}
                onCapturePhoto={() => setEvidenceTarget({ scope: "section", sectionId: section.id, kind: "photo" })}
                onCaptureSignature={() => setEvidenceTarget({ scope: "section", sectionId: section.id, kind: "signature" })}
                onUpload={(kind, file) => void handleAssetUpload({ scope: "section", sectionId: section.id, kind }, file)}
                onRemove={(kind, url) => void handleAssetDelete({ scope: "section", sectionId: section.id, kind }, url)}
              />

              <div className="space-y-3">
                {visibleItems.map((item) => {
                  const draft = drafts[item.id] ?? normalizeDraftItem(item);
                  const disabled = !canEdit || (blockReached && !isItemCompleted(draft));
                  if (item.block_next && !isItemCompleted(draft)) {
                    blockReached = true;
                  }

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "rounded-xl border p-4 space-y-3",
                        item.is_out_of_range ? "border-red-200 bg-red-50/40" : "bg-background"
                      )}
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium">{item.title}</div>
                          {item.required ? <Badge variant="outline">Obrigatório</Badge> : null}
                          {item.block_next ? <Badge variant="outline">Bloqueia avanço</Badge> : null}
                          {item.is_out_of_range ? <Badge variant="destructive">Fora do intervalo</Badge> : null}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {item.type} • criticidade {item.criticality}
                        </div>
                        {item.description ? (
                          <div className="mt-1 text-sm text-muted-foreground">{item.description}</div>
                        ) : null}
                      </div>

                      {item.type === "checkbox" ? (
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={draft.checked === true}
                            disabled={disabled}
                            onCheckedChange={(checked) => updateDraft(item.id, { checked: checked === true })}
                          />
                          Item verificado
                        </label>
                      ) : null}

                      {item.type === "yes_no" ? (
                        <div className="flex gap-2">
                          <Button type="button" variant={draft.yes_no_value === true ? "default" : "outline"} disabled={disabled} onClick={() => updateDraft(item.id, { yes_no_value: true })}>
                            Sim
                          </Button>
                          <Button type="button" variant={draft.yes_no_value === false ? "destructive" : "outline"} disabled={disabled} onClick={() => updateDraft(item.id, { yes_no_value: false })}>
                            Não
                          </Button>
                        </div>
                      ) : null}

                      {(item.type === "text" || item.type === "select") ? (
                        <Textarea
                          value={String(draft.text_value ?? "")}
                          disabled={disabled}
                          onChange={(event) => updateDraft(item.id, { text_value: event.target.value })}
                          placeholder="Digite a resposta"
                        />
                      ) : null}

                      {(item.type === "number" || item.type === "temperature") ? (
                        <Input
                          type="number"
                          value={draft.number_value === undefined ? "" : String(draft.number_value)}
                          disabled={disabled}
                          onChange={(event) =>
                            updateDraft(item.id, {
                              number_value: event.target.value === "" ? undefined : Number(event.target.value),
                            })
                          }
                          placeholder="Informe um valor"
                        />
                      ) : null}

                      {item.type === "date" ? (
                        <Input
                          type="date"
                          value={String(draft.date_value ?? "")}
                          disabled={disabled}
                          onChange={(event) => updateDraft(item.id, { date_value: event.target.value })}
                        />
                      ) : null}

                      {item.type === "multi_select" ? (
                        <Textarea
                          value={Array.isArray(draft.multi_values) ? draft.multi_values.join(", ") : ""}
                          disabled={disabled}
                          onChange={(event) =>
                            updateDraft(item.id, {
                              multi_values: event.target.value
                                .split(",")
                                .map((value) => value.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="Separe os valores por vírgula"
                        />
                      ) : null}

                      {item.type === "photo" ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" disabled={disabled} onClick={() => setEvidenceTarget({ scope: "item", itemId: item.id, kind: "photo" })}>
                              <Camera className="mr-2 h-4 w-4" />
                              Tirar foto
                            </Button>
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                              <UploadCloud className="h-4 w-4" />
                              {uploadingKey === `${item.id}:photo` ? "Enviando..." : "Enviar foto"}
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="hidden"
                                disabled={disabled || uploadingKey === `${item.id}:photo`}
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  if (file) {
                                    void handleAssetUpload({ scope: "item", itemId: item.id, kind: "photo" }, file);
                                  }
                                  event.currentTarget.value = "";
                                }}
                              />
                            </label>
                          </div>
                          {Array.isArray(draft.photo_urls) && draft.photo_urls.length > 0 ? (
                            <div className="space-y-2">
                              {draft.photo_urls.map((url) => (
                                <div key={url} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                                  <span className="truncate">{url}</span>
                                  <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => void handleAssetDelete({ scope: "item", itemId: item.id, kind: "photo" }, url)}>
                                    Remover
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {item.type === "signature" ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" disabled={disabled} onClick={() => setEvidenceTarget({ scope: "item", itemId: item.id, kind: "signature" })}>
                              <Paperclip className="mr-2 h-4 w-4" />
                              Assinar
                            </Button>
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                              <UploadCloud className="h-4 w-4" />
                              {uploadingKey === `${item.id}:signature` ? "Enviando..." : "Enviar assinatura"}
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="hidden"
                                disabled={disabled || uploadingKey === `${item.id}:signature`}
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  if (file) {
                                    void handleAssetUpload({ scope: "item", itemId: item.id, kind: "signature" }, file);
                                  }
                                  event.currentTarget.value = "";
                                }}
                              />
                            </label>
                          </div>
                          {String(draft.signature_url ?? "") ? (
                            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                              <span className="truncate">{String(draft.signature_url ?? "")}</span>
                              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => void handleAssetDelete({ scope: "item", itemId: item.id, kind: "signature" }, String(draft.signature_url ?? ""))}>
                                Remover
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {item.type === "file_upload" ? (
                        <div className="space-y-3">
                          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                            <UploadCloud className="h-4 w-4" />
                            {uploadingKey === `${item.id}:file` ? "Enviando..." : "Enviar arquivo"}
                            <input
                              type="file"
                              className="hidden"
                              disabled={disabled || uploadingKey === `${item.id}:file`}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) {
                                  void handleAssetUpload({ scope: "item", itemId: item.id, kind: "file" }, file);
                                }
                                event.currentTarget.value = "";
                              }}
                            />
                          </label>
                          <Textarea
                            value={
                              Array.isArray(draft.file_urls)
                                ? draft.file_urls
                                    .map((entry) =>
                                      typeof entry === "object" && entry
                                        ? `${String((entry as Record<string, unknown>).name ?? "")}|${String((entry as Record<string, unknown>).mime ?? "")}|${String((entry as Record<string, unknown>).url ?? "")}`
                                        : ""
                                    )
                                    .filter(Boolean)
                                    .join("\n")
                                : ""
                            }
                            disabled={disabled}
                            onChange={(event) =>
                              updateDraft(item.id, {
                                file_urls: event.target.value
                                  .split("\n")
                                  .map((value) => value.trim())
                                  .filter(Boolean)
                                  .map((row, index) => {
                                    const [name, mime, url] = row.split("|");
                                    return {
                                      name: name?.trim() || `arquivo-${index + 1}`,
                                      mime: mime?.trim() || "application/octet-stream",
                                      url: url?.trim() || "",
                                    };
                                  })
                                  .filter((entry) => entry.url),
                              })
                            }
                            placeholder="nome|mime|url"
                          />
                        </div>
                      ) : null}

                      {item.type === "location" ? (
                        <div className="grid gap-2 md:grid-cols-3">
                          <Input
                            type="number"
                            value={String((draft.location as { lat?: number } | null)?.lat ?? "")}
                            disabled={disabled}
                            onChange={(event) =>
                              updateDraft(item.id, {
                                location: {
                                  lat: Number(event.target.value),
                                  lng: Number((draft.location as { lng?: number } | null)?.lng ?? 0),
                                  address: String((draft.location as { address?: string } | null)?.address ?? ""),
                                },
                              })
                            }
                            placeholder="Latitude"
                          />
                          <Input
                            type="number"
                            value={String((draft.location as { lng?: number } | null)?.lng ?? "")}
                            disabled={disabled}
                            onChange={(event) =>
                              updateDraft(item.id, {
                                location: {
                                  lat: Number((draft.location as { lat?: number } | null)?.lat ?? 0),
                                  lng: Number(event.target.value),
                                  address: String((draft.location as { address?: string } | null)?.address ?? ""),
                                },
                              })
                            }
                            placeholder="Longitude"
                          />
                          <Input
                            value={String((draft.location as { address?: string } | null)?.address ?? "")}
                            disabled={disabled}
                            onChange={(event) =>
                              updateDraft(item.id, {
                                location: {
                                  lat: Number((draft.location as { lat?: number } | null)?.lat ?? 0),
                                  lng: Number((draft.location as { lng?: number } | null)?.lng ?? 0),
                                  address: event.target.value,
                                },
                              })
                            }
                            placeholder="Endereço"
                          />
                        </div>
                      ) : null}

                      {(item.type === "photo" || item.type === "signature" || item.type === "location") ? (
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {item.type === "photo" ? <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" /> Evidência visual</span> : null}
                          {item.type === "signature" ? <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" /> Assinatura digital</span> : null}
                          {item.type === "location" ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> Coordenadas manuais</span> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {visibleItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum item visível nesta seção.
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="h-4 w-4" />
              Eventos recentes
            </CardTitle>
            <CardDescription>
              Histórico de criação, salvamento, conclusão e evidências do preenchimento.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {events.length === 0 ? (
              <div className="text-sm text-muted-foreground">Sem eventos registrados.</div>
            ) : (
              events.map((event) => (
                <div key={event.id} className="rounded-lg border p-3 text-sm">
                  <div className="font-medium">{event.type}</div>
                  <div className="text-muted-foreground">
                    {event.username} • {formatDateTime(event.timestamp)}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-10 border-t bg-background/95 px-6 py-4 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3">
          {sectionsMode && execution.sections.length > 0 ? (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={sectionIdx === 0} onClick={() => setSectionIdx((current) => Math.max(0, current - 1))}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                Anterior
              </Button>
              <span className="text-xs text-muted-foreground">
                Seção {sectionIdx + 1} / {execution.sections.length}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sectionIdx >= execution.sections.length - 1 || sectionIdx >= executionView.sectionBlockedAt}
                onClick={() => setSectionIdx((current) => Math.min(execution.sections.length - 1, current + 1))}
              >
                Próxima
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          ) : null}

          <div className="mr-auto text-sm text-muted-foreground">
            {remainingRequired > 0
              ? `Faltam ${remainingRequired} pergunta(s) obrigatória(s) para concluir.`
              : executionView.missingSectionEvidence
                ? "Ainda faltam evidências obrigatórias em pelo menos uma seção."
                : `${executionView.completedItems} de ${executionView.activeItems} pergunta(s) respondida(s).`}
          </div>

          {canEdit ? (
            <>
              <Button type="button" variant="outline" onClick={() => void runAction("save")} disabled={submitting !== null}>
                {submitting === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar progresso
              </Button>
              <Button
                type="button"
                onClick={() => void runAction("complete")}
                disabled={submitting !== null || remainingRequired > 0 || executionView.missingSectionEvidence}
              >
                {submitting === "complete" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Concluir preenchimento
              </Button>
              <Button type="button" variant="destructive" onClick={() => void runAction("cancel")} disabled={submitting !== null}>
                {submitting === "cancel" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                Cancelar
              </Button>
            </>
          ) : null}

          {(execution.status === "completed" || execution.status === "canceled") ? (
            <Button type="button" variant="outline" onClick={() => void runAction("reopen")} disabled={submitting !== null}>
              {submitting === "reopen" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
              Reabrir
            </Button>
          ) : null}
        </div>
      </div>

      <PhotoCaptureModal
        open={evidenceTarget?.kind === "photo"}
        onOpenChange={(open) => {
          if (!open) setEvidenceTarget(null);
        }}
        onPhotoCaptured={(dataUrl) => {
          if (!evidenceTarget) return;
          void handleAssetUpload(
            evidenceTarget,
            dataUrlToFile(
              dataUrl,
              evidenceTarget.scope === "item"
                ? `photo-${evidenceTarget.itemId}.jpg`
                : `section-photo-${evidenceTarget.sectionId}.jpg`
            )
          );
        }}
      />

      <SignatureCaptureModal
        open={evidenceTarget?.kind === "signature"}
        onOpenChange={(open) => {
          if (!open) setEvidenceTarget(null);
        }}
        onSignatureCaptured={(dataUrl) => {
          if (!evidenceTarget) return;
          void handleAssetUpload(
            evidenceTarget,
            dataUrlToFile(
              dataUrl,
              evidenceTarget.scope === "item"
                ? `signature-${evidenceTarget.itemId}.png`
                : `section-signature-${evidenceTarget.sectionId}.png`
            )
          );
        }}
      />
    </div>
  );
}
