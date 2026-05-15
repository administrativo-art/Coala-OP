import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { type ProductSimulation } from '@/types';

export async function GET() {
  try {
    const snap = await getDocs(collection(db, 'productSimulations'));

    const products = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as ProductSimulation))
      .filter(sim => !sim.isArchived)
      .map(sim => ({
        id: sim.id,
        name: sim.name,
        imageUrl: sim.ppo?.referenceImageUrl ?? null,
        preparationTime: sim.ppo?.preparationTime ?? null,
        portionWeight: sim.ppo?.portionWeight ?? null,
        assemblyInstructions: sim.ppo?.assemblyInstructions ?? [],
        qualityStandard: sim.ppo?.qualityStandard ?? [],
        allergens: sim.ppo?.allergens ?? [],
        assemblyVideoUrl: sim.ppo?.assemblyVideoUrl ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    return NextResponse.json(products);
  } catch (error) {
    console.error('Catalogo API error:', error);
    return NextResponse.json({ error: 'Falha ao carregar dados' }, { status: 500 });
  }
}
