import { NextRequest, NextResponse } from "next/server";

import { assertFormalizationAccess } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PartyOption = {
  id: string;
  partyType: "employee" | "company" | "external_person" | "external_company";
  name: string;
  document: string;
  address: string;
};

function text(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function fieldText(value: FirebaseFirestore.DocumentData | undefined) {
  return text(value?.value_text, value?.value_date, value?.value_number);
}

function entityAddress(data: FirebaseFirestore.DocumentData) {
  const address = data.address && typeof data.address === "object"
    ? data.address as Record<string, unknown>
    : {};
  return [
    [text(address.street, data.logradouro), text(address.number, data.numero)]
      .filter(Boolean)
      .join(", "),
    text(address.complement, data.complemento),
    text(address.neighborhood, data.bairro),
    [text(address.city, data.cidade), text(address.state, data.uf)]
      .filter(Boolean)
      .join("/"),
    text(address.zipCode, data.cep),
  ].filter(Boolean).join(" · ");
}

export async function GET(request: NextRequest) {
  try {
    await assertFormalizationAccess(request, "documents.generate");
    const [entities, employees] = await Promise.all([
      dbAdmin.collection("entities").get(),
      hrDbAdmin.collection("employees").get(),
    ]);

    const employeeCpfDocuments = employees.docs.map((employee) =>
      employee.ref.collection("field_values").doc("employee.cpf")
    );
    const employeeCpfs = employeeCpfDocuments.length
      ? await hrDbAdmin.getAll(...employeeCpfDocuments)
      : [];

    const employeeOptions: PartyOption[] = employees.docs
      .filter((employee) => String(employee.get("status") ?? "active") !== "inactive")
      .map((employee, index) => ({
        id: employee.id,
        partyType: "employee",
        name: text(
          employee.get("name"),
          employee.get("username"),
          employee.get("email"),
          "Colaborador sem nome",
        ),
        document: fieldText(employeeCpfs[index]?.data()),
        address: text(employee.get("address")),
      }));

    const entityOptions: PartyOption[] = entities.docs
      .filter((entity) => String(entity.get("status") ?? "active") !== "inactive")
      .map((entity) => {
        const data = entity.data();
        const isCompany = data.type === "pessoa_juridica"
          || text(data.cnpj, data.document).replace(/\D/g, "").length === 14;
        return {
          id: entity.id,
          partyType: isCompany ? "company" : "external_person",
          name: text(
            data.name,
            data.fantasyName,
            data.nome_fantasia,
            data.razao_social,
            "Cadastro sem nome",
          ),
          document: text(data.document, data.cnpj),
          address: entityAddress(data),
        };
      });

    const parties = [...employeeOptions, ...entityOptions].sort((left, right) =>
      left.name.localeCompare(right.name, "pt-BR")
    );
    return NextResponse.json({ parties });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Acesso negado." },
      { status: 403 },
    );
  }
}
