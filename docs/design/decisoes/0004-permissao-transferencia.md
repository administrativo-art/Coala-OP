# 0004 · Permissão de transferência

**Status:** em aberto · 07/10/2026

`StockTransfer` mostra a ação com `stock.inventoryControl.transfer`, mas o POST `/api/stock/reposition-activities` exige `reposition.prepareDispatch` ou `stock.analysis.restock` (ou administrador). Um perfil pode ver o botão e receber 403, ou ter acesso pela API sem ver o botão. Alinhar antes de mostrar "Transferir" no painel do lote.

Ver `docs/engineering/flows/stock-control.md`.

**Decisão:** —
