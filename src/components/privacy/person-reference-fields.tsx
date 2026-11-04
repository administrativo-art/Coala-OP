"use client";

import { Field, fieldInputClass } from "@/components/patterns/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SubjectRef } from "@/features/privacy/person-subject";

export const personNamespaceLabels: Record<SubjectRef["namespace"], string> = {
  "main.users": "Conta do sistema",
  "hr.employees": "Cadastro RH",
  "hr.candidates": "Candidatura",
  "hr.onboardingPersons": "Pessoa em admissão",
};

export function PersonReferenceFields({ prefix, namespace, id, onChange, optional = false }: {
  prefix: string; namespace: string; id: string; optional?: boolean;
  onChange: (namespace: string, id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Origem do cadastro" htmlFor={`${prefix}-namespace`}>
        <Select value={namespace || "unlinked"} onValueChange={(value) => onChange(value === "unlinked" ? "" : value, id)}>
          <SelectTrigger id={`${prefix}-namespace`} className={fieldInputClass}><SelectValue /></SelectTrigger>
          <SelectContent>
            {optional ? <SelectItem value="unlinked">Sem vínculo com cadastro</SelectItem> : null}
            {Object.entries(personNamespaceLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      {namespace ? <Field label="Identificador do cadastro" htmlFor={`${prefix}-id`}>
        <Input id={`${prefix}-id`} className={fieldInputClass} value={id} maxLength={180} onChange={(event) => onChange(namespace, event.target.value)} autoComplete="off" />
      </Field> : null}
      <p className="text-xs leading-5 text-ds-ink-muted">Use o ID imutável da origem escolhida. Nome, CPF e e-mail não vinculam cadastros. A permissão e o escopo são conferidos no servidor.</p>
      {optional && !namespace ? <p className="text-xs leading-5 text-ds-ink-muted">Pessoa externa sem cadastro pode ter seu pedido registrado sem vínculo. O vínculo de pedidos antigos exige revisão própria.</p> : null}
    </div>
  );
}
