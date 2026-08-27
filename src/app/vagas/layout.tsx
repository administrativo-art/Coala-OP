import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://vagas.coalashakes.com"),
  title: "Vagas | Coala Shakes",
  description: "Vagas abertas e banco de talentos da Coala Shakes.",
  openGraph: {
    title: "Vagas | Coala Shakes",
    description: "Cresca com a gente. Veja vagas abertas e cadastre seu curriculo no banco de talentos.",
    url: "https://vagas.coalashakes.com",
    siteName: "Coala Shakes",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Vagas | Coala Shakes",
    description: "Veja vagas abertas e cadastre seu curriculo no banco de talentos.",
  },
};

export default function VagasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
