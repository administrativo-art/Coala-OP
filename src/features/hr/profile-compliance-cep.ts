export type ProfileCepAddress = {
  zipcode: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

type ViaCepResponse = {
  cep?: unknown;
  logradouro?: unknown;
  bairro?: unknown;
  localidade?: unknown;
  uf?: unknown;
  erro?: unknown;
};

export function cepDigits(value: string) {
  return value.replace(/\D/gu, "").slice(0, 8);
}

export function formatBrazilianCep(value: string) {
  const digits = cepDigits(value);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function lookupProfileAddressByCep(
  value: string,
  options: { signal?: AbortSignal } = {},
): Promise<ProfileCepAddress> {
  const digits = cepDigits(value);
  if (digits.length !== 8) throw new Error("Informe um CEP com 8 números.");

  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: options.signal,
  });
  if (!response.ok) throw new Error("Não foi possível consultar o CEP agora.");

  const result = await response.json().catch(() => null) as ViaCepResponse | null;
  if (!result || result.erro === true) throw new Error("CEP não encontrado.");

  const city = text(result.localidade);
  const state = text(result.uf).toUpperCase();
  if (!city || !/^[A-Z]{2}$/u.test(state)) throw new Error("O CEP retornou um endereço incompleto.");

  return {
    zipcode: formatBrazilianCep(text(result.cep) || digits),
    street: text(result.logradouro),
    neighborhood: text(result.bairro),
    city,
    state,
  };
}
