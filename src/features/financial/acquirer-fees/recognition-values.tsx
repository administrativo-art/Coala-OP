import React from "react";
import type { FeeRecognitionBatch, FeeRecognitionRecord } from "./recognition-contracts";
import { centsLabel } from "../receipts-reconciliation/stone-account-format";
import { feeTotalCents } from "./fee-amounts";
export const recognitionStateLabels = { assessed: "Taxa apurada · a receber", estimated: "Taxa estimada · a receber", partially_received: "Parcialmente liquidado na adquirente", received: "Liquidado na adquirente", cancelled: "Revertido" };
/** One presentation source: active recognition wins over the older capture forecast. */
export function RecognitionValues({ capture, record }: { capture: FeeRecognitionBatch; record?: FeeRecognitionRecord }) {
 const shown=record?.active?record.batch:capture;
 const received=record?.active&&record.state==="received"&&shown.members.every(m=>m.paidNetDecimal!==null);
 const net=received?feeTotalCents(shown.members.map(m=>m.paidNetDecimal!)):shown.expectedNetCents;
 return <><td className="p-2">{shown.kind.toUpperCase()} · {shown.measurement==="estimated"?"Estimada":"Apurada"}<br />{record?recognitionStateLabels[record.state]:"Ainda não reconhecida"}</td><td>{centsLabel(shown.grossCents)}</td><td>{centsLabel(shown.amountCents)}</td><td>{centsLabel(net)}<br /><span className="text-xs">{received?"Liquidado na adquirente":"Previsto"}</span></td><td>{shown.dueOn}</td></>;
}
