"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CompetitorManagement } from '@/components/competitor-management';
import { ArrowLeft } from 'lucide-react';

export default function CompetitorsPage() {
  return (
    <div className="space-y-4">
      <Link href="/dashboard/pricing" className="inline-block">
          <Button variant="outline">
              <ArrowLeft className="mr-2" />
              Voltar para comparação de preços
          </Button>
      </Link>
      <CompetitorManagement />
    </div>
  );
}
