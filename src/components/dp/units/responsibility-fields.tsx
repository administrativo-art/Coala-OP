"use client";

import { Field, fieldInputClass } from "@/components/patterns/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { JobFunction, JobRole, User } from "@/types";
import {
  NONE,
  functionLabel,
  roleLabel,
  userMatchesResponsibility,
  type ResponsibilityForm,
} from "./units-model";

export type ResponsibilityDirectory = {
  roles: JobRole[];
  functions: JobFunction[];
  users: Array<User & { name: string }>;
};

/** Vínculo de responsabilidade: primeiro cargo ou função, depois a pessoa entre os nomes compatíveis. */
export function ResponsibilityFields({
  form,
  directory,
  onPatch,
  idPrefix,
}: {
  form: ResponsibilityForm;
  directory: ResponsibilityDirectory;
  onPatch: (patch: Partial<ResponsibilityForm>) => void;
  idPrefix: string;
}) {
  const sourceOptions =
    form.responsibleSourceType === "job_role"
      ? directory.roles.map((role) => ({ id: role.id, label: roleLabel(role) }))
      : form.responsibleSourceType === "job_function"
        ? directory.functions.map((item) => ({ id: item.id, label: functionLabel(item) }))
        : [];
  const candidates = directory.users.filter((user) =>
    userMatchesResponsibility(user, form.responsibleSourceType, form.responsibleSourceId)
  );

  return (
    <fieldset className="space-y-3 rounded-ds-btn-lg border border-ds-border bg-white p-4">
      <legend className="px-1 text-xs font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">Responsabilidade</legend>
      <p className="text-xs text-ds-ink-muted">
        Vincule primeiro a um cargo ou função. Depois escolha a pessoa responsável entre os nomes compatíveis.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tipo de vínculo" htmlFor={`${idPrefix}-source-type`}>
          <Select
            value={form.responsibleSourceType || NONE}
            onValueChange={(value) =>
              onPatch({ responsibleSourceType: value === NONE ? "" : (value as ResponsibilityForm["responsibleSourceType"]) })
            }
          >
            <SelectTrigger id={`${idPrefix}-source-type`} className={fieldInputClass}>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sem responsável</SelectItem>
              <SelectItem value="job_role">Cargo</SelectItem>
              <SelectItem value="job_function">Função</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={form.responsibleSourceType === "job_function" ? "Função" : "Cargo"} htmlFor={`${idPrefix}-source`}>
          <Select
            value={form.responsibleSourceId || NONE}
            onValueChange={(value) => onPatch({ responsibleSourceId: value === NONE ? "" : value })}
            disabled={!form.responsibleSourceType}
          >
            <SelectTrigger id={`${idPrefix}-source`} className={fieldInputClass}>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{form.responsibleSourceType ? "Selecione" : "Escolha o tipo primeiro"}</SelectItem>
              {sourceOptions.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
              ))}
              {form.responsibleSourceType && sourceOptions.length === 0 ? (
                <SelectItem value="__empty_source__" disabled>Nenhuma opção disponível</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Pessoa responsável" htmlFor={`${idPrefix}-user`}>
        <Select
          value={form.responsibleUserId || NONE}
          onValueChange={(value) => onPatch({ responsibleUserId: value === NONE ? "" : value })}
          disabled={!form.responsibleSourceId}
        >
          <SelectTrigger id={`${idPrefix}-user`} className={fieldInputClass}>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              {form.responsibleSourceId ? "Sem responsável definido" : "Escolha cargo ou função primeiro"}
            </SelectItem>
            {candidates.map((user) => (
              <SelectItem key={user.id} value={user.id}>{user.username}</SelectItem>
            ))}
            {form.responsibleSourceId && candidates.length === 0 ? (
              <SelectItem value="__empty_users__" disabled>Nenhum colaborador encontrado para este vínculo</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </Field>
    </fieldset>
  );
}
