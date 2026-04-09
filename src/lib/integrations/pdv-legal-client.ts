/**
 * Client-side sync helper.
 * Delega para a API route server-side, que mantém as credenciais do PDV Legal
 * fora do navegador. O Firebase ID Token é usado para autenticação.
 */
export async function syncDayClient(
  dateStr: string,
  kioskId: string,
  idToken: string,
): Promise<{ success: boolean; count: number; unmapped: { sku: string; name: string }[] }> {
  const res = await fetch(
    `/api/integrations/pdvlegal/sync?date=${dateStr}&kiosk=${kioskId}`,
    {
      headers: { Authorization: `Bearer ${idToken}` },
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Falha na sincronização: HTTP ${res.status}`);
  }

  const data = await res.json();
  const processed = data.processed?.[0];
  return {
    success: data.success,
    count: processed?.count ?? 0,
    unmapped: processed?.unmapped ?? [],
  };
}
