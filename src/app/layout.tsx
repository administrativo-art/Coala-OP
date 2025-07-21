
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
import { AllTasksProvider } from '@/hooks/use-all-tasks';
import { SidebarProvider } from '@/hooks/use-sidebar-state';

export const metadata: Metadata = {
  title: 'Coala Shakes',
  description: 'Sua ferramenta para conversões e gestão de estoque.',
  manifest: '/manifest.json',
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
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Inter:wght@400;500;600;700&family=PT+Sans:wght@400;700&display=swap" rel="stylesheet" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Coala Shakes" />
        <link rel="apple-touch-icon" href="/icons/Icon PWM (192 x 192 px).png" />
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
                  <EntitiesProvider>
                    <BaseProductsProvider>
                      <PurchaseProvider>
                        <ProductsProvider>
                          <ProductSimulationCategoryProvider>
                            <ProductSimulationProvider>
                              <ExpiryProductsProvider>
                                <PredefinedListsProvider>
                                  <FormProvider>
                                    <TaskProvider>
                                      <ConsumptionAnalysisProvider>
                                        <MovementHistoryProvider>
                                          <ReturnsProvider>
                                            <ScheduleProvider>
                                              <MonthlyScheduleProvider>
                                                  <RepositionProvider>
                                                    <ItemAdditionProvider>
                                                      <StockCountProvider>
                                                        <AllTasksProvider>
                                                          {children}
                                                        </AllTasksProvider>
                                                      </StockCountProvider>
                                                    </ItemAdditionProvider>
                                                  </RepositionProvider>
                                              </MonthlyScheduleProvider>
                                            </ScheduleProvider>
                                          </ReturnsProvider>
                                        </MovementHistoryProvider>
                                      </ConsumptionAnalysisProvider>
                                    </TaskProvider>
                                  </FormProvider>
                                </PredefinedListsProvider>
                              </ExpiryProductsProvider>
                            </ProductSimulationProvider>
                          </ProductSimulationCategoryProvider>
                        </ProductsProvider>
                      </PurchaseProvider>
                    </BaseProductsProvider>
                  </EntitiesProvider>
                </CompanySettingsProvider>
              </LocationsProvider>
            </KiosksProvider>
          </AuthProvider>
        </ProfilesProvider>
        <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
