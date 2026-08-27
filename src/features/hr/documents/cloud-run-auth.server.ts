const METADATA_IDENTITY_ENDPOINT =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

export async function cloudRunIdentityAuthorization(
  audience: string,
  fetcher: typeof fetch = fetch,
) {
  const normalizedAudience = audience.trim();
  if (!normalizedAudience) return null;

  const endpoint = new URL(METADATA_IDENTITY_ENDPOINT);
  endpoint.searchParams.set("audience", normalizedAudience);
  endpoint.searchParams.set("format", "full");
  const response = await fetcher(endpoint, {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `Metadata server não emitiu identity token (${response.status}).`,
    );
  }
  const token = (await response.text()).trim();
  if (!token) throw new Error("Metadata server devolveu identity token vazio.");
  return `Bearer ${token}`;
}
