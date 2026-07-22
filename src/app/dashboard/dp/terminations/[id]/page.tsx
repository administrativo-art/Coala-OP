import { TerminationDetailPage } from "@/features/hr/termination/termination-detail-page";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <TerminationDetailPage id={(await params).id}/>; }
