import { Suspense } from 'react';

import { SignagePlayer } from '@/components/signage/signage-player';

export default function PlayerPage() {
  return (
    <Suspense fallback={null}>
      <SignagePlayer />
    </Suspense>
  );
}
