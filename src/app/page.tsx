
"use client";

import { FeaturesSectionWithHoverEffects } from "@/components/blocks/feature-section-with-hover-effects";
import { AppFooter } from "@/components/footer";
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col">
        <main className="flex-1">
            <div className="container mx-auto px-4 py-16 text-center">
                 <div className="inline-block font-logo select-none mb-4">
                    <div className="text-left text-6xl text-primary">coala</div>
                    <div className="text-left text-5xl text-accent -mt-4 pl-6">shakes</div>
                </div>
                <p className="mt-4 max-w-2xl mx-auto text-lg text-muted-foreground">
                    Sua plataforma completa para gestão inteligente de estoque, custos e operações de quiosques.
                </p>
                <div className="mt-8">
                     <Link href="/login">
                        <Button size="lg">
                            Acessar o sistema <ArrowRight className="ml-2"/>
                        </Button>
                    </Link>
                </div>
            </div>
            <FeaturesSectionWithHoverEffects />
        </main>
        <AppFooter />
    </div>
  );
}
