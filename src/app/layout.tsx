
import type {Metadata} from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from '@/components/auth-provider';
import { ProductsProvider } from '@/components/products-provider';
import { KiosksProvider } from '@/components/kiosks-provider';
import { LocationsProvider } from '@/components/locations-provider';
import { ExpiryProductsProvider } from '@/components/expiry-products-provider';
import { PredefinedListsProvider } from '@/components/predefined-lists-provider';
import { ProfilesProvider } from '@/components/profiles-provider';
import { FormProvider } from '@/components/form-provider';
import { BaseProductsProvider } from '@/components/base-products-provider';
import { ConsumptionAnalysisProvider } from '@/components/consumption-analysis-provider';
import { MovementHistoryProvider } from '@/components/movement-history-provider';
import { ReturnsProvider } from '@/components/return-request-provider';
import { ScheduleProvider } from '@/components/schedule-provider';
import { MonthlyScheduleProvider } from '@/components/monthly-schedule-provider';
import { StockCountProvider } from '@/components/stock-count-provider';
import { CompanySettingsProvider } from '@/components/company-settings-provider';
import { EntitiesProvider } from '@/components/entities-provider';
import { PurchaseProvider } from '@/components/purchase-provider';
import { ItemAdditionProvider } from '@/components/item-addition-provider';
import { RepositionProvider } from '@/components/reposition-provider';
import { ProductSimulationProvider } from '@/components/product-simulation-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { ProductSimulationCategoryProvider } from '@/components/product-simulation-category-provider';
import { TaskProvider } from '@/components/task-provider';

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
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
        <ProfilesProvider>
          <AuthProvider>
            <KiosksProvider>
              <LocationsProvider>
                <CompanySettingsProvider>
                  <BaseProductsProvider>
                    <ProductsProvider>
                      <ProductSimulationCategoryProvider>
                        <ProductSimulationProvider>
                          <ExpiryProductsProvider>
                            <PredefinedListsProvider>
                                <TaskProvider>
                                    <FormProvider>
                                        <EntitiesProvider>
                                            <ConsumptionAnalysisProvider>
                                            <MovementHistoryProvider>
                                                <ReturnsProvider>
                                                <ScheduleProvider>
                                                    <MonthlyScheduleProvider>
                                                    <StockCountProvider>
                                                        <PurchaseProvider>
                                                        <ItemAdditionProvider>
                                                            <RepositionProvider>
                                                            {children}
                                                            <Toaster />
                                                            </RepositionProvider>
                                                        </ItemAdditionProvider>
                                                        </PurchaseProvider>
                                                    </StockCountProvider>
                                                    </MonthlyScheduleProvider>
                                                </ScheduleProvider>
                                                </ReturnsProvider>
                                            </MovementHistoryProvider>
                                            </ConsumptionAnalysisProvider>
                                        </EntitiesProvider>
                                    </FormProvider>
                                </TaskProvider>
                            </PredefinedListsProvider>
                          </ExpiryProductsProvider>
                        </ProductSimulationProvider>
                      </ProductSimulationCategoryProvider>
                    </ProductsProvider>
                  </BaseProductsProvider>
                </CompanySettingsProvider>
              </LocationsProvider>
            </KiosksProvider>
          </AuthProvider>
        </ProfilesProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
