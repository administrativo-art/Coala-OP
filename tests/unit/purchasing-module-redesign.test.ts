import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const redesignedRoutes = [
  "src/app/dashboard/purchasing/quotations/page.tsx",
  "src/app/dashboard/purchasing/quotations/compare/page.tsx",
  "src/app/dashboard/purchasing/quotations/[quotationId]/page.tsx",
  "src/app/dashboard/purchasing/quotations/[quotationId]/confirm-purchase/page.tsx",
  "src/app/dashboard/purchasing/orders/page.tsx",
  "src/app/dashboard/purchasing/orders/[orderId]/page.tsx",
  "src/app/dashboard/purchasing/orders/[orderId]/receipt/page.tsx",
  "src/app/dashboard/purchasing/receipts/page.tsx",
  "src/app/dashboard/purchasing/costs/page.tsx",
];

test("all purchasing screens keep the shared flow navigation", () => {
  for (const route of redesignedRoutes) {
    const source = readFileSync(route, "utf8");
    assert.match(
      source,
      /PurchasingModuleNavigation/,
      `${route} must use the shared purchasing navigation`,
    );
  }
});

test("purchasing list screens use the compact redesign instead of the old KPI/Kanban shell", () => {
  for (const route of [
    "src/app/dashboard/purchasing/quotations/page.tsx",
    "src/app/dashboard/purchasing/orders/page.tsx",
    "src/app/dashboard/purchasing/receipts/page.tsx",
  ]) {
    const source = readFileSync(route, "utf8");
    assert.doesNotMatch(
      source,
      /PurchasingMetricCard|PurchasingKanban/,
      `${route} reintroduced the legacy list shell`,
    );
  }
});

test("the purchasing typography covers pages and portalled surfaces", () => {
  const globalStyles = readFileSync("src/app/globals.css", "utf8");
  const pageFrame = readFileSync(
    "src/components/purchasing/purchasing-ui.tsx",
    "utf8",
  );
  const quotationModal = readFileSync(
    "src/components/purchasing/create-quotation-modal.tsx",
    "utf8",
  );
  const directPurchaseModal = readFileSync(
    "src/components/purchasing/create-direct-purchase-modal.tsx",
    "utf8",
  );

  assert.match(globalStyles, /\.font-purchasing[\s\S]*Inter Tight Variable/);
  assert.match(pageFrame, /font-purchasing/);
  assert.match(quotationModal, /font-purchasing/);
  assert.match(directPurchaseModal, /font-purchasing/);
});

test("all purchasing drawers use the redesigned visual shell", () => {
  const orderDetail = readFileSync(
    "src/app/dashboard/purchasing/orders/[orderId]/page.tsx",
    "utf8",
  );
  const priceComparison = readFileSync(
    "src/components/purchasing/price-comparison-sheet.tsx",
    "utf8",
  );
  const traceDrawer = readFileSync(
    "src/components/purchasing/trace-drawer.tsx",
    "utf8",
  );

  for (const [name, source] of [
    ["order actions and edit", orderDetail],
    ["price comparison", priceComparison],
    ["cost trace", traceDrawer],
  ] as const) {
    assert.match(
      source,
      /font-purchasing/,
      `${name} drawer must use the purchasing typography`,
    );
    assert.match(
      source,
      /bg-\[#f6f6f7\]/,
      `${name} drawer must use the redesigned surface`,
    );
    assert.match(
      source,
      /rounded-\[14px\]/,
      `${name} drawer must use the redesigned cards`,
    );
  }

  assert.match(orderDetail, /EditSectionCard/);
  assert.match(priceComparison, /Comparar preços/);
  assert.match(traceDrawer, /Percurso completo do custo efetivo/);
});

test("receipts list tolerates legacy or unexpected receipt statuses", () => {
  const receiptsPage = readFileSync(
    "src/app/dashboard/purchasing/receipts/page.tsx",
    "utf8",
  );
  assert.match(
    receiptsPage,
    /statusConfig\[status as PurchaseReceipt\['status'\]\] \?\? fallbackStatusConfig/,
  );
});

test("orders identify rows by their items and share the dashboard background", () => {
  const ordersPage = readFileSync(
    "src/app/dashboard/purchasing/orders/page.tsx",
    "utf8",
  );
  const itemsPreview = readFileSync(
    "src/components/purchasing/purchasing-items-preview.tsx",
    "utf8",
  );
  const pageFrame = readFileSync(
    "src/components/purchasing/purchasing-ui.tsx",
    "utf8",
  );

  assert.match(
    ordersPage,
    /PurchasingItemsPreview orderId=\{order\.id\} variant="inline"/,
  );
  assert.doesNotMatch(ordersPage, /orderSummary\(order\)/);
  assert.match(itemsPreview, /IntersectionObserver/);
  assert.match(itemsPreview, /Itens: /);
  assert.match(
    pageFrame,
    /min-h-\[calc\(100vh-1px\)\] bg-transparent/,
  );
  assert.doesNotMatch(
    pageFrame,
    /min-h-\[calc\(100vh-1px\)\] bg-\[#f5f5f6\]/,
  );
});
