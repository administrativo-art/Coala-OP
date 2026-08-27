import { NewExpensePage } from "@/features/financial/pages/new-expense-page";

export default function ExpenseModalPage() {
  return (
    <div className="absolute inset-0 z-20 min-h-[calc(100vh-5rem)] bg-black/25 backdrop-blur-[2px]">
      <NewExpensePage presentation="modal" />
    </div>
  );
}
