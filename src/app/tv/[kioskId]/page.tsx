import { redirect } from 'next/navigation';

export default async function TvRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ kioskId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { kioskId } = await params;
  const { token } = await searchParams;
  const qs = new URLSearchParams({ kiosk: kioskId });
  if (token) qs.set('token', token);
  redirect(`/player?${qs.toString()}`);
}
