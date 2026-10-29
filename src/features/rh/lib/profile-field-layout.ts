/**
 * Organização visual da ficha do colaborador: subgrupos dentro de uma seção e cartões
 * que combinam campos relacionados (cidade e UF, logradouro e número, Pix, benefícios).
 * Só muda a apresentação e a edição; cada campo continua gravado na própria chave.
 */

/** Texto já formatado de um campo, ou null quando vazio. */
export type FieldText = (key: string) => string | null;

export type CompositeFieldDef = {
  id: string;
  label: string;
  /** Campos representados pelo cartão; o primeiro define a posição. */
  keys: readonly string[];
  /** Campos exibidos no modal de edição do cartão. */
  editKeys: readonly string[];
  format: (text: FieldText) => string | null;
  /** Campos preenchidos automaticamente a partir dos editados, no formato bruto do modal. */
  deriveOnSave?: (values: Record<string, string>) => Record<string, string>;
};

export type ProfileSubgroupDef = {
  id: string;
  title: string;
  description: string;
  keys: readonly string[];
};

const STREET = "employee.address_street";
const NUMBER = "employee.address_number";
const NO_NUMBER = "employee.address_no_number";

function benefitText(enabled: string | null, value: string | null) {
  if (enabled === "Sim") return value ? `Sim · ${value}/dia` : "Sim";
  return enabled;
}

export const PROFILE_COMPOSITE_FIELDS: readonly CompositeFieldDef[] = [
  {
    id: "composite.street_number",
    label: "Logradouro, nº",
    keys: [STREET, NUMBER, NO_NUMBER],
    editKeys: [STREET, NUMBER],
    format: (text) => {
      const street = text(STREET);
      const number = text(NUMBER);
      if (!street && !number) return null;
      const suffix = number ?? "s/n";
      return street ? `${street}, ${suffix}` : `Nº ${suffix}`;
    },
    deriveOnSave: (values) => ({ [NO_NUMBER]: values[NUMBER]?.trim() ? "false" : "true" }),
  },
  {
    id: "composite.city_state",
    label: "Cidade | UF",
    keys: ["employee.city", "employee.state"],
    editKeys: ["employee.city", "employee.state"],
    format: (text) => {
      const city = text("employee.city");
      const state = text("employee.state");
      if (city && state) return `${city} | ${state}`;
      return city ?? state;
    },
  },
  {
    id: "composite.pix",
    label: "Chave Pix",
    keys: ["employee.pix_key_type", "employee.pix_key"],
    editKeys: ["employee.pix_key_type", "employee.pix_key"],
    format: (text) => {
      const type = text("employee.pix_key_type");
      const key = text("employee.pix_key");
      if (type && key) return `${type} · ${key}`;
      return key ?? type;
    },
  },
  {
    id: "composite.transport_voucher",
    label: "Vale-transporte",
    keys: ["employee.has_vt", "employee.vt_daily_value"],
    editKeys: ["employee.has_vt", "employee.vt_daily_value"],
    format: (text) => benefitText(text("employee.has_vt"), text("employee.vt_daily_value")),
  },
  {
    id: "composite.meal_voucher",
    label: "VA/VR",
    keys: ["employee.has_va_vr", "employee.va_vr_daily_value"],
    editKeys: ["employee.has_va_vr", "employee.va_vr_daily_value"],
    format: (text) => benefitText(text("employee.has_va_vr"), text("employee.va_vr_daily_value")),
  },
];

/**
 * Campos que não aparecem na ficha. `employee.address` era uma linha livre que repetia o
 * endereço; os documentos agora montam essa linha a partir dos campos do endereço.
 */
export const HIDDEN_PROFILE_FIELD_KEYS: ReadonlySet<string> = new Set([
  "employee.address",
  "employee.mother_name",
  "employee.father_name",
  "employee.vt_notes",
  "employee.employer_name",
]);

export const PROFILE_SUBGROUPS: Readonly<Record<string, readonly ProfileSubgroupDef[]>> = {
  "Dados pessoais": [
    {
      id: "identity",
      title: "Identificação",
      description: "Quem é a pessoa: nome e nascimento.",
      keys: [
        "employee.name",
        "employee.birth_date",
        "employee.nationality",
        "employee.marital_status",
        "employee.mother_name",
        "employee.father_name",
        "employee.children_under_14",
      ],
    },
    {
      id: "contact",
      title: "Contato",
      description: "Como falar com a pessoa.",
      keys: ["employee.phone", "employee.personal_email"],
    },
    {
      id: "address",
      title: "Endereço residencial",
      description: "Onde a pessoa mora hoje. Vai para o contrato e para o vale-transporte.",
      keys: [
        "employee.address_zipcode",
        STREET,
        "employee.address_complement",
        "employee.address_neighborhood",
        "employee.city",
      ],
    },
    {
      id: "documents",
      title: "Documentos",
      description: "CPF, PIS, carteira de trabalho e habilitação.",
      keys: [
        "employee.cpf",
        "employee.pis",
        "employee.ctps_number",
        "employee.ctps_series",
        "employee.ctps_date",
        "employee.has_cnh",
        "employee.cnh_number",
        "employee.cnh_type",
        "employee.cnh_expiry",
        "employee.cnh_first_date",
      ],
    },
  ],
  "Benefícios": [
    {
      id: "transport",
      title: "Vale-transporte",
      description: "Se recebe, o valor diário e observações.",
      keys: ["employee.has_vt", "employee.vt_notes"],
    },
    {
      id: "meal",
      title: "Vale-alimentação / refeição",
      description: "Se recebe e o valor diário.",
      keys: ["employee.has_va_vr"],
    },
    {
      id: "health",
      title: "Convênios",
      description: "Planos médico e odontológico.",
      keys: ["employee.has_health_plan", "employee.has_dental_plan"],
    },
  ],
};

export type ProfileDisplayItem<Row extends { key: string }> =
  | { kind: "field"; key: string; row: Row }
  | { kind: "composite"; key: string; def: CompositeFieldDef; rows: Row[] };

/** Troca os campos de um cartão combinado por um único item, na posição do primeiro campo presente. */
export function buildProfileDisplayItems<Row extends { key: string }>(
  rows: readonly Row[],
): ProfileDisplayItem<Row>[] {
  const items: ProfileDisplayItem<Row>[] = [];
  const consumed = new Set<string>();
  for (const row of rows) {
    if (HIDDEN_PROFILE_FIELD_KEYS.has(row.key) || consumed.has(row.key)) continue;
    const def = PROFILE_COMPOSITE_FIELDS.find((candidate) => candidate.keys.includes(row.key));
    if (!def) {
      items.push({ kind: "field", key: row.key, row });
      continue;
    }
    const members = rows.filter((candidate) => def.keys.includes(candidate.key));
    members.forEach((member) => consumed.add(member.key));
    items.push({ kind: "composite", key: def.id, def, rows: members });
  }
  return items;
}

function itemKeys<Row extends { key: string }>(item: ProfileDisplayItem<Row>) {
  return item.kind === "field" ? [item.key] : item.def.keys;
}

export type ProfileSubgroup<Row extends { key: string }> = {
  id: string;
  title: string;
  description: string;
  items: ProfileDisplayItem<Row>[];
};

/**
 * Distribui os itens de uma seção nos subgrupos definidos, na ordem dos subgrupos.
 * Campos sem subgrupo vão para "Outros dados", para que um campo novo nunca suma.
 * Retorna null quando a seção não tem subgrupos.
 */
export function groupProfileSection<Row extends { key: string }>(
  section: string,
  items: readonly ProfileDisplayItem<Row>[],
): ProfileSubgroup<Row>[] | null {
  const defs = PROFILE_SUBGROUPS[section];
  if (!defs) return null;
  const used = new Set<ProfileDisplayItem<Row>>();
  const groups: ProfileSubgroup<Row>[] = defs.map((def) => {
    const groupItems = items
      .filter((item) => !used.has(item))
      .map((item) => ({ item, position: Math.min(...itemKeys(item).map((key) => {
        const index = def.keys.indexOf(key);
        return index < 0 ? Number.POSITIVE_INFINITY : index;
      })) }))
      .filter(({ position }) => Number.isFinite(position))
      .sort((left, right) => left.position - right.position)
      .map(({ item }) => item);
    groupItems.forEach((item) => used.add(item));
    return { id: def.id, title: def.title, description: def.description, items: groupItems };
  });
  const rest = items.filter((item) => !used.has(item));
  if (rest.length > 0) {
    groups.push({ id: "other", title: "Outros dados", description: "Campos desta seção sem grupo definido.", items: rest });
  }
  return groups.filter((group) => group.items.length > 0);
}

export type ResidentialAddressParts = {
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
};

function clean(value: string | null | undefined) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function formatZipcode(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : value;
}

/**
 * Linha única do endereço residencial, no formato usado pelos documentos:
 * "Rua das Flores, 120, Apto 2, Centro, São Luís/MA, CEP 65010-000".
 * Retorna null sem logradouro, para o documento cair no valor antigo.
 */
export function composeResidentialAddress(parts: ResidentialAddressParts): string | null {
  const street = clean(parts.street);
  if (!street) return null;
  const number = clean(parts.number) ?? "s/n";
  const city = clean(parts.city);
  const state = clean(parts.state);
  const place = city && state ? `${city}/${state}` : city ?? state;
  const zipcode = formatZipcode(clean(parts.zipcode));
  return [
    street,
    number,
    clean(parts.complement),
    clean(parts.neighborhood),
    place,
    zipcode ? `CEP ${zipcode}` : null,
  ].filter(Boolean).join(", ");
}
