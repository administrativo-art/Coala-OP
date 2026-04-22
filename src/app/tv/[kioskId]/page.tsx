import { redirect } from 'next/navigation';

export default async function TvRedirectPage({ params }: { params: Promise<{ kioskId: string }> }) {
  const { kioskId } = await params;
  redirect(`/player?kiosk=${kioskId}`);
}
