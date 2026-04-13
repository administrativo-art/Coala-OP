// Minimal layout for standalone full-screen modules.
// AppProviders (auth, theme, etc.) are inherited from the root layout.
export default function ModulesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
