import { redirect } from "next/navigation";

/**
 * Os documentos do colaborador ficam no Acervo, aba Colaborador (decisão 0008): anexar, revisar a
 * classificação, publicar, status e visibilidade. Este endereço antigo leva direto à pasta da pessoa.
 */
export default async function EmployeeDocumentsPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  redirect(`/dashboard/documents/collaborators?employee=${encodeURIComponent(userId)}`);
}
