import { NextResponse } from "next/server";
import { analyzeConsumption } from "@/ai/flows/analyze-consumption-flow";
import { ConsumptionAnalysisInputSchema } from "@/ai/flows/consumption-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Increase the timeout for Vercel
export const maxDuration = 120; 

export async function POST(req: Request) {
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
