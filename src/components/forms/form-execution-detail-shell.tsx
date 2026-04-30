"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Camera,
  History,
  Loader2,
  MapPin,
  Paperclip,
  Save,
  UploadCloud,
  UserCheck,
  XCircle,
} from "lucide-react";

import type { FormExecution, FormExecutionEvent, FormExecutionItem } from "@/types/forms";
import { useAuth } from "@/hooks/use-auth";
import {
  claimFormExecution,
  deleteFormAsset,
  fetchFormExecution,
  updateFormExecution,
  uploadFormAsset,
} from "@/features/forms/lib/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PhotoCaptureModal } from "@/components/photo-capture-modal";
import { SignatureCaptureModal } from "@/components/forms/signature-capture-modal";

type DraftItem = Record<string, unknown> & {
  template_item_id: string;
  section_id: string;
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

function getStatusLabel(status: string) {
  if (status === "pending") return "Pendente";
  if (status === "in_progress") return "Em andamento";
  if (status === "completed") return "Concluída";
  if (status === "overdue") return "Atrasada";
  if (status === "canceled") return "Cancelada";
  return status;
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

export function FormExecutionDetailShell({ executionId }: { executionId: string }) {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [execution, setExecution] = useState<FormExecution | null>(null);
  const [events, setEvents] = useState<FormExecutionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftItem>>({});
  const [submitting, setSubmitting] = useState<null | "claim" | "save" | "complete" | "reopen" | "cancel">(null);
  const [autosaveState, setAutosaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [cameraItemId, setCameraItemId] = useState<string | null>(null);
  const [signatureItemId, setSignatureItemId] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDraftRef = useRef<string>("");

  const itemList = execution?.items ?? [];
  const groupedSections = useMemo(() => {
    if (!execution) return [];

    return execution.sections.map((section) => ({
      ...section,
      items: itemList.filter((item) => item.section_id === section.id),
    }));
  }, [execution, itemList]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!firebaseUser) return;

      try {
        const payload = await fetchFormExecution(firebaseUser, executionId);
        if (!cancelled) {
          setExecution(payload.execution);
          setEvents(payload.events);
          setDrafts(
            Object.fromEntries(
              (payload.execution.items ?? []).map((item) => [
                item.id,
                normalizeDraftItem(item),
              ])
            )
          );
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

  const canEdit =
    execution?.status === "in_progress" || execution?.status === "pending";

  async function refreshExecution() {
    if (!firebaseUser) return;
    const payload = await fetchFormExecution(firebaseUser, executionId);
    setExecution(payload.execution);
    setEvents(payload.events);
    const nextDrafts = Object.fromEntries(
      (payload.execution.items ?? []).map((item) => [item.id, normalizeDraftItem(item)])
    );
    setDrafts(nextDrafts);
    lastSavedDraftRef.current = JSON.stringify(nextDrafts);
    initializedRef.current = true;
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

  async function handleAssetUpload(
    item: FormExecutionItem,
    file: File,
    kind: "photo" | "signature" | "file"
  ) {
    if (!firebaseUser) return;

    try {
      setUploadingKey(`${item.id}:${kind}`);
      const uploaded = await uploadFormAsset(firebaseUser, { file, kind });

      if (kind === "photo") {
        const currentUrls = Array.isArray(drafts[item.id]?.photo_urls)
          ? (drafts[item.id]?.photo_urls as string[])
          : [];
        updateDraft(item.id, { photo_urls: [...currentUrls, uploaded.assetUrl] });
      } else if (kind === "signature") {
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

      toast({ title: "Arquivo enviado" });
    } catch (uploadError) {
      toast({
        variant: "destructive",
        title: uploadError instanceof Error ? uploadError.message : "Falha ao enviar arquivo.",
      });
    } finally {
      setUploadingKey(null);
    }
  }

  async function handleAssetDelete(
    item: FormExecutionItem,
    kind: "photo" | "signature" | "file",
    targetUrl: string
  ) {
    if (!firebaseUser || !canEdit) return;

    try {
      setUploadingKey(`${item.id}:${kind}:delete`);
      const assetPath = extractAssetPathFromUrl(targetUrl);
      if (assetPath) {
        await deleteFormAsset(firebaseUser, assetPath);
      }

      if (kind === "photo") {
        const currentUrls = Array.isArray(drafts[item.id]?.photo_urls)
          ? (drafts[item.id]?.photo_urls as string[])
          : [];
        updateDraft(item.id, {
          photo_urls: currentUrls.filter((url) => url !== targetUrl),
        });
      } else if (kind === "signature") {
        updateDraft(item.id, { signature_url: "" });
      } else {
        const currentFiles = Array.isArray(drafts[item.id]?.file_urls)
          ? (drafts[item.id]?.file_urls as Array<Record<string, unknown>>)
          : [];
        updateDraft(item.id, {
          file_urls: currentFiles.filter(
            (entry) =>
              !entry ||
              typeof entry !== "object" ||
              String((entry as Record<string, unknown>).url ?? "") !== targetUrl
          ),
        });
      }

      toast({ title: "Arquivo removido" });
    } catch (deleteError) {
      toast({
        variant: "destructive",
        title:
          deleteError instanceof Error
            ? deleteError.message
            : "Falha ao remover arquivo.",
      });
    } finally {
      setUploadingKey(null);
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

  async function autosaveDrafts() {
    if (!firebaseUser || !canEdit || submitting !== null) return;

    const payload = Object.values(drafts);
    if (payload.length === 0) return;

    try {
      setAutosaveState("saving");
      await updateFormExecution(firebaseUser, executionId, {
        action: "save",
        items: payload,
      });
      lastSavedDraftRef.current = JSON.stringify(drafts);
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
        const items = Object.values(drafts);
        await updateFormExecution(firebaseUser, executionId, {
          action,
          items,
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
    if (!initializedRef.current || !canEdit) {
      return;
    }

    const serialized = JSON.stringify(drafts);
    if (serialized === lastSavedDraftRef.current) {
      return;
    }

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
  }, [drafts, canEdit, executionId, firebaseUser, submitting]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

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

  if (error || !execution) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Execução</CardTitle>
          <CardDescription>{error ?? "Execução não encontrada."}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/forms">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            {execution.template_name}
          </CardTitle>
          <CardDescription>
            Status: {getStatusLabel(execution.status)} • Unidade: {execution.unit_name ?? execution.unit_id}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border p-3 text-sm">
            Responsável: {execution.assigned_username}
          </div>
          <div className="rounded-lg border p-3 text-sm">
            Score: {execution.score ?? 0}
          </div>
          <div className="rounded-lg border p-3 text-sm">
            {execution.sections.length} seção(ões)
          </div>
          <div className="rounded-lg border p-3 text-sm">
            Autosave: {renderAutosaveLabel()}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ações</CardTitle>
          <CardDescription>
            Fluxo mínimo do MVP: assumir, salvar respostas, concluir, reabrir ou cancelar.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {execution.status === "pending" ? (
            <Button onClick={() => void runAction("claim")} disabled={submitting !== null}>
              {submitting === "claim" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
              Assumir
            </Button>
          ) : null}
          {canEdit ? (
            <>
              <Button variant="outline" onClick={() => void runAction("save")} disabled={submitting !== null}>
                {submitting === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar
              </Button>
              <Button onClick={() => void runAction("complete")} disabled={submitting !== null}>
                {submitting === "complete" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Concluir
              </Button>
              <Button variant="destructive" onClick={() => void runAction("cancel")} disabled={submitting !== null}>
                {submitting === "cancel" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                Cancelar
              </Button>
            </>
          ) : null}
          {(execution.status === "completed" || execution.status === "canceled") ? (
            <Button variant="outline" onClick={() => void runAction("reopen")} disabled={submitting !== null}>
              {submitting === "reopen" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
              Reabrir
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {groupedSections.map((section) => (
          <Card key={section.id}>
            <CardHeader>
              <CardTitle className="text-lg">{section.title}</CardTitle>
              <CardDescription>
                {section.items.length} item(ns) nesta seção
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {section.items.map((item) => {
                const draft = drafts[item.id] ?? normalizeDraftItem(item);

                return (
                  <div key={item.id} className="rounded-lg border p-4 space-y-3">
                    <div>
                      <div className="font-medium">{item.title}</div>
                      <div className="text-sm text-muted-foreground">
                        {item.type} • {item.required ? "obrigatório" : "opcional"}
                        {item.is_out_of_range ? " • fora do intervalo" : ""}
                      </div>
                    </div>

                    {item.type === "checkbox" ? (
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={draft.checked === true}
                          disabled={!canEdit}
                          onCheckedChange={(checked) =>
                            updateDraft(item.id, { checked: checked === true })
                          }
                        />
                        Item verificado
                      </label>
                    ) : null}

                    {item.type === "yes_no" ? (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={draft.yes_no_value === true ? "default" : "outline"}
                          disabled={!canEdit}
                          onClick={() => updateDraft(item.id, { yes_no_value: true })}
                        >
                          Sim
                        </Button>
                        <Button
                          type="button"
                          variant={draft.yes_no_value === false ? "destructive" : "outline"}
                          disabled={!canEdit}
                          onClick={() => updateDraft(item.id, { yes_no_value: false })}
                        >
                          Não
                        </Button>
                      </div>
                    ) : null}

                    {(item.type === "text" || item.type === "select") ? (
                      <Textarea
                        value={String(draft.text_value ?? "")}
                        disabled={!canEdit}
                        onChange={(event) =>
                          updateDraft(item.id, { text_value: event.target.value })
                        }
                        placeholder="Digite a resposta"
                      />
                    ) : null}

                    {(item.type === "number" || item.type === "temperature") ? (
                      <Input
                        type="number"
                        value={draft.number_value === undefined ? "" : String(draft.number_value)}
                        disabled={!canEdit}
                        onChange={(event) =>
                          updateDraft(item.id, {
                            number_value:
                              event.target.value === ""
                                ? undefined
                                : Number(event.target.value),
                          })
                        }
                        placeholder="Informe um valor"
                      />
                    ) : null}

                    {item.type === "date" ? (
                      <Input
                        type="date"
                        value={String(draft.date_value ?? "")}
                        disabled={!canEdit}
                        onChange={(event) =>
                          updateDraft(item.id, { date_value: event.target.value })
                        }
                      />
                    ) : null}

                    {item.type === "multi_select" ? (
                      <Textarea
                        value={Array.isArray(draft.multi_values) ? draft.multi_values.join(", ") : ""}
                        disabled={!canEdit}
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
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!canEdit}
                            onClick={() => setCameraItemId(item.id)}
                          >
                            <Camera className="mr-2 h-4 w-4" />
                            Tirar foto
                          </Button>
                        </div>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                          <UploadCloud className="h-4 w-4" />
                          {uploadingKey === `${item.id}:photo` ? "Enviando..." : "Enviar foto"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            disabled={!canEdit || uploadingKey === `${item.id}:photo`}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) {
                                void handleAssetUpload(item, file, "photo");
                              }
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <Textarea
                          value={Array.isArray(draft.photo_urls) ? draft.photo_urls.join("\n") : ""}
                          disabled={!canEdit}
                          onChange={(event) =>
                            updateDraft(item.id, {
                              photo_urls: event.target.value
                                .split("\n")
                                .map((value) => value.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="Uma URL de foto por linha"
                        />
                        {Array.isArray(draft.photo_urls) && draft.photo_urls.length > 0 ? (
                          <div className="space-y-2">
                            {draft.photo_urls.map((url) => (
                              <div
                                key={url}
                                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                              >
                                <span className="truncate">{url}</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={!canEdit || uploadingKey === `${item.id}:photo:delete`}
                                  onClick={() => void handleAssetDelete(item, "photo", url)}
                                >
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
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!canEdit}
                            onClick={() => setSignatureItemId(item.id)}
                          >
                            <Paperclip className="mr-2 h-4 w-4" />
                            Assinar
                          </Button>
                        </div>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                          <UploadCloud className="h-4 w-4" />
                          {uploadingKey === `${item.id}:signature` ? "Enviando..." : "Enviar assinatura"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            disabled={!canEdit || uploadingKey === `${item.id}:signature`}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) {
                                void handleAssetUpload(item, file, "signature");
                              }
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <Input
                          value={String(draft.signature_url ?? "")}
                          disabled={!canEdit}
                          onChange={(event) =>
                            updateDraft(item.id, { signature_url: event.target.value })
                          }
                          placeholder="URL da assinatura"
                        />
                        {String(draft.signature_url ?? "") ? (
                          <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                            <span className="truncate">{String(draft.signature_url ?? "")}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={!canEdit || uploadingKey === `${item.id}:signature:delete`}
                              onClick={() =>
                                void handleAssetDelete(
                                  item,
                                  "signature",
                                  String(draft.signature_url ?? "")
                                )
                              }
                            >
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
                            disabled={!canEdit || uploadingKey === `${item.id}:file`}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) {
                                void handleAssetUpload(item, file, "file");
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
                          disabled={!canEdit}
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
                        {Array.isArray(draft.file_urls) && draft.file_urls.length > 0 ? (
                          <div className="space-y-2">
                            {draft.file_urls.map((entry, index) => {
                              if (!entry || typeof entry !== "object") return null;
                              const fileEntry = entry as Record<string, unknown>;
                              const url = String(fileEntry.url ?? "");
                              const label = String(fileEntry.name ?? url ?? `arquivo-${index + 1}`);
                              return (
                                <div
                                  key={`${url}-${index}`}
                                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                                >
                                  <span className="truncate">{label}</span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={!canEdit || uploadingKey === `${item.id}:file:delete`}
                                    onClick={() => void handleAssetDelete(item, "file", url)}
                                  >
                                    Remover
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {item.type === "location" ? (
                      <div className="grid gap-2 md:grid-cols-3">
                        <Input
                          type="number"
                          value={String((draft.location as { lat?: number } | null)?.lat ?? "")}
                          disabled={!canEdit}
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
                          disabled={!canEdit}
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
                          disabled={!canEdit}
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

                    {(item.type === "photo" || item.type === "signature" || item.type === "file_upload" || item.type === "location") ? (
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {item.type === "photo" ? <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" /> Evidência por URL</span> : null}
                        {item.type === "signature" ? <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" /> Assinatura por URL</span> : null}
                        {item.type === "file_upload" ? <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" /> Arquivos por linha</span> : null}
                        {item.type === "location" ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> Coordenadas manuais</span> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-4 w-4" />
            Eventos recentes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sem eventos registrados.</div>
          ) : (
            events.map((event) => (
              <div key={event.id} className="rounded-lg border p-3 text-sm">
                <div className="font-medium">{event.type}</div>
                <div className="text-muted-foreground">
                  {event.username} • {String(event.timestamp)}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <PhotoCaptureModal
        open={cameraItemId !== null}
        onOpenChange={(open) => {
          if (!open) setCameraItemId(null);
        }}
        onPhotoCaptured={(dataUrl) => {
          const target = itemList.find((item) => item.id === cameraItemId);
          if (!target) return;
          void handleAssetUpload(
            target,
            dataUrlToFile(dataUrl, `photo-${target.id}.jpg`),
            "photo"
          );
          setCameraItemId(null);
        }}
      />

      <SignatureCaptureModal
        open={signatureItemId !== null}
        onOpenChange={(open) => {
          if (!open) setSignatureItemId(null);
        }}
        onSignatureCaptured={(dataUrl) => {
          const target = itemList.find((item) => item.id === signatureItemId);
          if (!target) return;
          void handleAssetUpload(
            target,
            dataUrlToFile(dataUrl, `signature-${target.id}.png`),
            "signature"
          );
          setSignatureItemId(null);
        }}
      />
    </div>
  );
}
