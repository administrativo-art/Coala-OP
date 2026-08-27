export default function ExpensesLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <div className="relative min-w-0">
      {children}
      {modal}
    </div>
  );
}
