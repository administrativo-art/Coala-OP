import { redirect } from 'next/navigation';

export default function TvRedirectPage({ params }: { params: { kioskId: string } }) {
  redirect(`/player?kiosk=${params.kioskId}`);
}
