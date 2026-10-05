"use client";

import { useState, type MouseEvent } from "react";
import { CalendarClock, EyeOff, Loader2, MoreHorizontal, Pause, Play, Trash2, XCircle } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { InstagramScheduleListItem } from "./contracts";
import { ScheduleDatePicker, ScheduleTimeInput } from "./schedule-date-time-fields";
import {
  canCancelInstagramSchedule,
  canDeleteInstagramSchedule,
  canHideInstagramScheduleFromGrid,
  canPauseInstagramSchedule,
  canResumeInstagramSchedule,
  INSTAGRAM_SCHEDULE_MIN_LEAD_MS,
  isInstagramScheduleEditableStatus,
} from "./schedule-mutation-policy";
import {
  dateKeyInBelem,
  instagramPostTitle,
  minimumScheduleDateTimeInBelem,
  scheduleAtInBelem,
  timeInBelem,
} from "./workspace-utils";

export type ScheduleCardActions = {
  onReschedule: (id: string, scheduledAt: string) => Promise<boolean>;
  onPause: (id: string) => Promise<boolean>;
  onResume: (id: string, scheduledAt?: string) => Promise<boolean>;
  onCancel: (id: string) => Promise<boolean>;
  onHide: (id: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
};

type DialogState = "reschedule" | "resume-reschedule" | "cancel" | "hide" | "delete" | null;

const primaryButton =
  "flex items-center justify-center gap-2 rounded-lg bg-[#F462A7] px-4 py-2.5 text-[13px] font-extrabold text-[#4A1A04] disabled:cursor-not-allowed disabled:opacity-45";
const secondaryButton =
  "rounded-lg border border-[#EADFD3] bg-white px-4 py-2.5 text-[13px] font-bold disabled:opacity-50";

export function hasScheduleCardActions(item: InstagramScheduleListItem) {
  return canDeleteInstagramSchedule(item.status);
}

function RescheduleDialog({
  item,
  resume,
  onSubmit,
  onClose,
}: {
  item: InstagramScheduleListItem;
  resume: boolean;
  onSubmit: (scheduledAt: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const minimum = minimumScheduleDateTimeInBelem();
  const original = new Date(item.scheduledAt).getTime() >= Date.now() + INSTAGRAM_SCHEDULE_MIN_LEAD_MS;
  const [date, setDate] = useState(original ? dateKeyInBelem(item.scheduledAt) : minimum.date);
  const [time, setTime] = useState(original ? timeInBelem(item.scheduledAt) : minimum.time);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const current = minimumScheduleDateTimeInBelem();
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError("Digite o horário no formato HH:MM.");
      return;
    }
    if (date < current.date || (date === current.date && time < current.time)) {
      setError("Escolha um horário com pelo menos dois minutos de antecedência.");
      return;
    }
    const scheduledAt = scheduleAtInBelem(date, time);
    if (!scheduledAt) {
      setError("Escolha uma data e um horário válidos.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (await onSubmit(scheduledAt)) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-[420px]" onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{resume ? "Programar publicação" : "Alterar agendamento"}</DialogTitle>
          <DialogDescription>
            {instagramPostTitle(item)}
            {resume ? " · escolha quando ela será publicada." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] font-bold text-[#7A5646]">
            Data
            <ScheduleDatePicker
              value={date}
              minimum={minimum.date}
              disabled={busy}
              onChange={(value) => { setDate(value); setError(null); }}
            />
          </label>
          <label className="text-[12px] font-bold text-[#7A5646]">
            Horário · HH:MM
            <ScheduleTimeInput
              value={time}
              minimum={date === minimum.date ? minimum.time : undefined}
              disabled={busy}
              onChange={(value) => { setTime(value); setError(null); }}
            />
          </label>
        </div>
        {error && <p role="alert" className="text-[12px] font-semibold text-[#A52E24]">{error}</p>}
        <DialogFooter className="gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>Cancelar</button>
          <button type="button" onClick={() => void submit()} disabled={busy} className={primaryButton}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {resume ? "Programar" : "Salvar horário"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      if (await onConfirm()) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <AlertDialogContent onClick={(event) => event.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
            className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-extrabold disabled:opacity-50 ${destructive ? "bg-[#A52E24] text-white" : "bg-[#F462A7] text-[#4A1A04]"}`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ScheduleCardMenu({
  item,
  actions,
  className = "",
}: {
  item: InstagramScheduleListItem;
  actions: ScheduleCardActions;
  className?: string;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const editable = isInstagramScheduleEditableStatus(item.status);
  const canPause = canPauseInstagramSchedule(item.status);
  const canResume = canResumeInstagramSchedule(item.status);
  const canCancel = canCancelInstagramSchedule(item.status);
  const canHide = canHideInstagramScheduleFromGrid(item.status);
  const canDelete = canDeleteInstagramSchedule(item.status);

  if (!canDelete) return null;

  const stop = (event: MouseEvent) => event.stopPropagation();

  async function run(action: () => Promise<boolean>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  function resume() {
    const stillFuture = new Date(item.scheduledAt).getTime() >= Date.now() + INSTAGRAM_SCHEDULE_MIN_LEAD_MS;
    if (stillFuture) void run(() => actions.onResume(item.id));
    else setDialog("resume-reschedule");
  }

  const published = item.status === "published";

  return (
    <div className={className} onClick={stop} onKeyDown={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={busy}
            aria-label={`Ações de ${instagramPostTitle(item)}`}
            className="grid h-7 w-7 place-items-center rounded-md text-[#7A5646] outline-none hover:bg-[#F4ECE2] focus-visible:ring-2 focus-visible:ring-[#D90F6F] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[190px]">
          {editable && (
            <DropdownMenuItem onSelect={() => setDialog("reschedule")}>
              <CalendarClock className="mr-2 h-4 w-4" aria-hidden="true" /> Agendamento
            </DropdownMenuItem>
          )}
          {canPause && (
            <DropdownMenuItem onSelect={() => void run(() => actions.onPause(item.id))}>
              <Pause className="mr-2 h-4 w-4" aria-hidden="true" /> Pausar
            </DropdownMenuItem>
          )}
          {canResume && (
            <DropdownMenuItem onSelect={resume}>
              <Play className="mr-2 h-4 w-4" aria-hidden="true" /> Programar
            </DropdownMenuItem>
          )}
          {canCancel && (
            <DropdownMenuItem onSelect={() => setDialog("cancel")}>
              <XCircle className="mr-2 h-4 w-4" aria-hidden="true" /> Cancelar
            </DropdownMenuItem>
          )}
          {canHide && (
            <DropdownMenuItem onSelect={() => setDialog("hide")}>
              <EyeOff className="mr-2 h-4 w-4" aria-hidden="true" /> Remover da grade
            </DropdownMenuItem>
          )}
          {(editable || canCancel || canHide) && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => setDialog("delete")} className="text-[#A52E24] focus:text-[#A52E24]">
            <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" /> Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {(dialog === "reschedule" || dialog === "resume-reschedule") && (
        <RescheduleDialog
          item={item}
          resume={dialog === "resume-reschedule"}
          onSubmit={(scheduledAt) => (
            dialog === "resume-reschedule"
              ? actions.onResume(item.id, scheduledAt)
              : actions.onReschedule(item.id, scheduledAt)
          )}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "cancel" && (
        <ConfirmDialog
          title="Cancelar esta publicação?"
          description="Ela não será enviada ao Instagram e continua visível na programação, marcada como cancelada."
          confirmLabel="Cancelar publicação"
          destructive
          onConfirm={() => actions.onCancel(item.id)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "hide" && (
        <ConfirmDialog
          title="Remover da grade?"
          description="O card some do calendário. O registro é mantido e o conteúdo no Instagram não é alterado."
          confirmLabel="Remover da grade"
          onConfirm={() => actions.onHide(item.id)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title="Excluir esta publicação?"
          description={published
            ? "Ela some da programação e os arquivos associados são apagados. O conteúdo já publicado continua no Instagram: para removê-lo, exclua pelo aplicativo."
            : "Ela é removida por completo da programação, junto com os arquivos associados. Isso não pode ser desfeito."}
          confirmLabel="Excluir"
          destructive
          onConfirm={() => actions.onDelete(item.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
