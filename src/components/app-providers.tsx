"use client";

import { AuthProvider } from '@/components/auth-provider';
import { ProductsProvider } from '@/components/products-provider';
import { KiosksProvider } from '@/components/kiosks-provider';
import { LocationsProvider } from '@/components/locations-provider';
import { ExpiryProductsProvider } from '@/hooks/use-expiry-products';
import { PredefinedListsProvider } from '@/components/predefined-lists-provider';
import { BaseProductsProvider } from '@/components/base-products-provider';
import { ConsumptionAnalysisProvider } from '@/components/consumption-analysis-provider';
import { MovementHistoryProvider } from '@/components/movement-history-provider';
import { ReturnsProvider } from '@/components/return-request-provider';
import { CompanySettingsProvider } from '@/components/company-settings-provider';
import { EntitiesProvider } from '@/components/entities-provider';
import { PurchaseProvider } from '@/components/purchase-provider';
import { ItemAdditionProvider } from '@/components/item-addition-provider';
import { RepositionProvider } from '@/components/reposition-provider';
import { ProductSimulationProvider } from '@/components/product-simulation-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { ProductSimulationCategoryProvider } from '@/components/product-simulation-category-provider';
import { AllTasksProvider } from '@/hooks/use-all-tasks';
import { StockAuditProvider } from '@/components/stock-audit-provider';
import { TaskProvider } from '@/components/task-provider';
import { AuthorBoardDiaryProvider } from '@/components/author-board-diary-provider';
import { ClassificationsProvider } from '@/components/classifications-provider';
import { CompetitorProvider } from '@/components/competitor-provider';
import { ProfilesProvider } from '@/components/profiles-provider';
import { SalesReportProvider } from '@/components/sales-report-provider';
import { GoalsProvider } from '@/components/goals-provider';
import { Toaster } from "@/components/ui/toaster";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ProfilesProvider>
        <AuthProvider>
            <KiosksProvider>
              <GoalsProvider>
              <LocationsProvider>
                <CompanySettingsProvider>
                  <EntitiesProvider>
                    <BaseProductsProvider>
                      <ClassificationsProvider>
                        <ProductsProvider>
                          <TaskProvider>
                            <ItemAdditionProvider>
                                <ExpiryProductsProvider>
                                  <MovementHistoryProvider>
                                    <PredefinedListsProvider>
                                        <ConsumptionAnalysisProvider>
                                            <SalesReportProvider>
                                                <ReturnsProvider>
                                                    <RepositionProvider>
                                                        <StockAuditProvider>
                                                            <AuthorBoardDiaryProvider>
                                                                <PurchaseProvider>
                                                                    <ProductSimulationCategoryProvider>
                                                                        <ProductSimulationProvider>
                                                                            <CompetitorProvider>
                                                                                <AllTasksProvider>
                                                                                    {children}
                                                                                </AllTasksProvider>
                                                                            </CompetitorProvider>
                                                                        </ProductSimulationProvider>
                                                                    </ProductSimulationCategoryProvider>
                                                                </PurchaseProvider>
                                                            </AuthorBoardDiaryProvider>
                                                        </StockAuditProvider>
                                                    </RepositionProvider>
                                                </ReturnsProvider>
                                            </SalesReportProvider>
                                        </ConsumptionAnalysisProvider>
                                    </PredefinedListsProvider>
                                  </MovementHistoryProvider>
                                </ExpiryProductsProvider>
                            </ItemAdditionProvider>
                          </TaskProvider>
                        </ProductsProvider>
                      </ClassificationsProvider>
                    </BaseProductsProvider>
                  </EntitiesProvider>
                </CompanySettingsProvider>
              </LocationsProvider>
              </GoalsProvider>
            </KiosksProvider>
        </AuthProvider>
      </ProfilesProvider>
      <Toaster />
    </ThemeProvider>
  );
}
