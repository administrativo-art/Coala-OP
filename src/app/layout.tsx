
import type {Metadata} from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from '@/components/auth-provider';
import { ProductsProvider } from '@/components/products-provider';
import { KiosksProvider } from '@/components/kiosks-provider';
import { ExpiryProductsProvider } from '@/components/expiry-products-provider';
import { PredefinedListsProvider } from '@/components/predefined-lists-provider';
import { ProfilesProvider } from '@/components/profiles-provider';
import { FormProvider } from '@/components/form-provider';
import { StockAnalysisProvider } from '@/components/stock-analysis-provider';
import { ConsumptionAnalysisProvider } from '@/components/consumption-analysis-provider';
import { MovementHistoryProvider } from '@/components/movement-history-provider';

export const metadata: Metadata = {
  title: 'Coala Shakes',
  description: 'Sua ferramenta para conversões e gestão de estoque.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased">
        <ProfilesProvider>
          <AuthProvider>
            <KiosksProvider>
              <ProductsProvider>
                <ExpiryProductsProvider>
                  <PredefinedListsProvider>
                    <FormProvider>
                      <StockAnalysisProvider>
                          <ConsumptionAnalysisProvider>
                            <MovementHistoryProvider>
                              {children}
                              <Toaster />
                            </MovementHistoryProvider>
                          </ConsumptionAnalysisProvider>
                      </StockAnalysisProvider>
                    </FormProvider>
                  </PredefinedListsProvider>
                </ExpiryProductsProvider>
              </ProductsProvider>
            </KiosksProvider>
          </AuthProvider>
        </ProfilesProvider>
      </body>
    </html>
  );
}
