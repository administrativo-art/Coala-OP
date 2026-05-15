import { NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { type ProductSimulation, type ProductSimulationItem, type BaseProduct, type SimulationCategory } from '@/types';

export async function GET() {
  try {
    const [simSnap, itemsSnap, baseProductsSnap, catSnap] = await Promise.all([
      dbAdmin.collection('productSimulations').get(),
      dbAdmin.collection('productSimulationItems').get(),
      dbAdmin.collection('baseProducts').get(),
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

    const items = itemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as ProductSimulationItem);
    const baseProductMap = new Map(
      baseProductsSnap.docs.map(doc => [doc.id, { id: doc.id, ...doc.data() } as BaseProduct]),
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
        portionTolerance: sim.ppo?.portionTolerance ?? null,
        assemblyInstructions: sim.ppo?.assemblyInstructions ?? [],
        qualityStandard: sim.ppo?.qualityStandard ?? [],
        allergens: sim.ppo?.allergens ?? [],
        assemblyVideoUrl: sim.ppo?.assemblyVideoUrl ?? null,
        ingredients: items
          .filter(item => item.simulationId === sim.id)
          .map(item => {
            const bp = baseProductMap.get(item.baseProductId);
            return {
              name: bp?.name ?? 'Insumo não encontrado',
              quantity: item.quantity,
              unit: item.overrideUnit ?? bp?.unit ?? 'un',
            };
          }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    return NextResponse.json({ lines, products });
  } catch (error) {
    console.error('Catalogo API error:', error);
    return NextResponse.json({ error: 'Falha ao carregar dados' }, { status: 500 });
  }
}
