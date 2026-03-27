import type { Metadata } from "next";
import "./globals.css";
import { brand } from "@/config/brand";
import { AppProviders } from "@/components/app-providers";

export const metadata: Metadata = {
  title: brand.name,
  description: brand.description,
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link rel="apple-touch-icon" href="/icons/Icon PWM (192 x 192 px).png" />
      </head>
      <body className="font-sans antialiased">
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
