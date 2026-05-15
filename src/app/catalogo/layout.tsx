export default function CatalogoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: 'hsl(220 20% 97%)' }}>
      {children}
    </div>
  );
}
