import { NextRequest, NextResponse } from "next/server";
import { analyzeConsumption } from "@/ai/flows/analyze-consumption-flow";
import { ConsumptionAnalysisInputSchema } from "@/ai/flows/consumption-schemas";
import { verifyAuth } from "@/lib/verify-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    await verifyAuth(req);
  } catch {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  try {
    const json = await req.json();
    const input = ConsumptionAnalysisInputSchema.parse(json);

    // Call the existing flow function
    const analysisResult = await analyzeConsumption(input);

    return NextResponse.json(analysisResult);
  } catch (err: any) {
    console.error("AI Analysis API Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error during AI analysis." },
      { status: 500 }
    );
  }
}
