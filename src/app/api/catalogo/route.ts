import { NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { type ProductSimulation, type SimulationCategory } from '@/types';

export async function GET() {
  try {
    const [simSnap, catSnap] = await Promise.all([
      dbAdmin.collection('productSimulations').get(),
      dbAdmin.collection('productSimulationCategories').get(),
    ]);

    const lineMap = new Map<string, SimulationCategory>();
    catSnap.docs.forEach(doc => {
      const cat = { id: doc.id, ...doc.data() } as SimulationCategory;
      if (cat.type === 'line') lineMap.set(cat.id, cat);
    });

    const lines = Array.from(lineMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR'),
    );

    const products = simSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }) as ProductSimulation)
      .filter(sim => !sim.isArchived)
      .map(sim => ({
        id: sim.id,
        name: sim.name,
        lineId: sim.lineId ?? null,
        imageUrl: sim.ppo?.referenceImageUrl ?? null,
        preparationTime: sim.ppo?.preparationTime ?? null,
        portionWeight: sim.ppo?.portionWeight ?? null,
        assemblyInstructions: sim.ppo?.assemblyInstructions ?? [],
        qualityStandard: sim.ppo?.qualityStandard ?? [],
        allergens: sim.ppo?.allergens ?? [],
        assemblyVideoUrl: sim.ppo?.assemblyVideoUrl ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    return NextResponse.json({ lines, products });
  } catch (error) {
    console.error('Catalogo API error:', error);
    return NextResponse.json({ error: 'Falha ao carregar dados' }, { status: 500 });
  }
}
