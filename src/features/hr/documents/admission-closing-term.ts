export type AdmissionClosingComponent = {
  title: string;
  startPage?: number | null;
  endPage?: number | null;
};

export function admissionClosingComponentsSummary(
  components: readonly AdmissionClosingComponent[],
) {
  if (!components.length) throw new Error("O termo de encerramento exige ao menos um componente.");
  return components.map((component, index) => {
    const pages = component.startPage && component.endPage
      ? component.startPage === component.endPage
        ? ` (pág. ${component.startPage})`
        : ` (págs. ${component.startPage}–${component.endPage})`
      : "";
    return `${index + 1}. ${component.title}${pages};`;
  }).join("\n");
}
