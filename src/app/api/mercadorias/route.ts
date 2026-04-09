
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { type ProductSimulation, type ProductSimulationItem, type BaseProduct } from '@/types';
import { verifyAuth } from '@/lib/verify-auth';

export async function GET(req: NextRequest) {
  try {
    await verifyAuth(req);
  } catch {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  try {
    // 1. Fetch all necessary data in parallel
    const [simulationsSnapshot, itemsSnapshot, baseProductsSnapshot] = await Promise.all([
      getDocs(collection(db, 'productSimulations')),
      getDocs(collection(db, 'productSimulationItems')),
      getDocs(collection(db, 'baseProducts')),
    ]);

    // 2. Process and map data for efficient lookup
    const simulations = simulationsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductSimulation));
    const items = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductSimulationItem));
    const baseProductMap = new Map(baseProductsSnapshot.docs.map(doc => [doc.id, doc.data() as BaseProduct]));

    // 3. Combine the data into the desired structure
    const responseData = simulations.map(sim => {
      const compositionItems = items
        .filter(item => item.simulationId === sim.id)
        .map(item => {
          const baseProduct = baseProductMap.get(item.baseProductId);
          return {
            insumo_base: baseProduct?.name || 'Insumo não encontrado',
            quantidade: item.quantity,
            unidade_medida: item.overrideUnit || baseProduct?.unit || 'N/A',
          };
        });

      return {
        nome_mercadoria: sim.name,
        composicao: compositionItems,
      };
    });

    return NextResponse.json(responseData);

  } catch (error) {
    console.error("Error fetching mercadorias API:", error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}
