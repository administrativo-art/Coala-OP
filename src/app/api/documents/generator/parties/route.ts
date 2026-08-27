import { NextRequest, NextResponse } from "next/server";

import { assertFormalizationAccess } from "@/features/hr/lib/server-access";
import { loadVisibleEmployeeIds } from "@/features/hr/lib/employee-document-access-server";
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
  email: string;
  signatureName: string;
  signatureUserId: string;
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
    const access = await assertFormalizationAccess(request, "documents.generate");
    const visibleEmployeeIds = await loadVisibleEmployeeIds(access);
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
    const employeeCpfById = new Map(
      employees.docs.map((employee, index) => [employee.id, employeeCpfs[index]?.data()])
    );

    const employeeOptions: PartyOption[] = employees.docs
      .filter((employee) => String(employee.get("status") ?? "active") !== "inactive")
      .filter((employee) => visibleEmployeeIds.has(employee.id))
      .map((employee) => ({
        id: employee.id,
        partyType: "employee",
        name: text(
          employee.get("name"),
          employee.get("username"),
          employee.get("email"),
          "Colaborador sem nome",
        ),
        document: fieldText(employeeCpfById.get(employee.id)),
        address: text(employee.get("address")),
        email: text(employee.get("documentSignatureEmail"), employee.get("email")),
        signatureName: text(
          employee.get("documentSignatureName"),
          employee.get("name"),
          employee.get("username"),
        ),
        signatureUserId: employee.id,
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
          email: text(
            data.documentSignatoryEmail,
            data.email,
            data.contactEmail,
            data.email_financeiro,
            data.financeEmail,
          ),
          signatureName: text(
            data.documentSignatoryName,
            data.responsible,
            data.name,
          ),
          signatureUserId: text(data.documentSignatoryUserId),
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
