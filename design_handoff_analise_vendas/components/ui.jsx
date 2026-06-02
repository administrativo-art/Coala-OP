// Shared UI primitives for Coala Despesas prototype

const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;

// Icons (inline SVG, lucide-style)
const Icon = ({ d, size = 16, className = "", strokeWidth = 2, fill = "none", children }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children || (d && <path d={d} />)}
  </svg>
);

// Icon library — all stroked, lucide vocabulary
const I = {
  Search:     (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></Icon>,
  Plus:       (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>,
  Upload:     (p) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><path d="M12 3v12"/></Icon>,
  Download:   (p) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><path d="M12 15V3"/></Icon>,
  Filter:     (p) => <Icon {...p}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></Icon>,
  More:       (p) => <Icon {...p}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></Icon>,
  Check:      (p) => <Icon {...p}><polyline points="20 6 9 17 4 12"/></Icon>,
  X:          (p) => <Icon {...p}><path d="M18 6L6 18M6 6l12 12"/></Icon>,
  Chevron:    (p) => <Icon {...p}><polyline points="6 9 12 15 18 9"/></Icon>,
  ChevronR:   (p) => <Icon {...p}><polyline points="9 18 15 12 9 6"/></Icon>,
  ChevronL:   (p) => <Icon {...p}><polyline points="15 18 9 12 15 6"/></Icon>,
  Calendar:   (p) => <Icon {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></Icon>,
  Coins:      (p) => <Icon {...p}><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/></Icon>,
  Bank:       (p) => <Icon {...p}><path d="M3 9.5L12 4l9 5.5"/><path d="M5 9.5v9M19 9.5v9M9 18.5v-7M15 18.5v-7M3 21h18"/></Icon>,
  File:       (p) => <Icon {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></Icon>,
  FilePlus:   (p) => <Icon {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6M9 15h6"/></Icon>,
  Inbox:      (p) => <Icon {...p}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></Icon>,
  Trash:      (p) => <Icon {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></Icon>,
  Edit:       (p) => <Icon {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></Icon>,
  Link:       (p) => <Icon {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></Icon>,
  Sparkle:    (p) => <Icon {...p}><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/><path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z"/></Icon>,
  AlertTri:   (p) => <Icon {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h0"/></Icon>,
  Clock:      (p) => <Icon {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Icon>,
  CheckCircle:(p) => <Icon {...p}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></Icon>,
  TrendUp:    (p) => <Icon {...p}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></Icon>,
  TrendDown:  (p) => <Icon {...p}><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></Icon>,
  Settings:   (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></Icon>,
  ArrowDown:  (p) => <Icon {...p}><path d="M12 5v14M19 12l-7 7-7-7"/></Icon>,
  ArrowUp:    (p) => <Icon {...p}><path d="M12 19V5M5 12l7-7 7 7"/></Icon>,
  Tag:        (p) => <Icon {...p}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/></Icon>,
  Building:   (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01"/></Icon>,
  Eye:        (p) => <Icon {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></Icon>,
  Layers:     (p) => <Icon {...p}><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></Icon>,
  Receipt:    (p) => <Icon {...p}><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2H4z"/><path d="M8 7h8M8 11h8M8 15h6"/></Icon>,
  Doc:        (p) => <Icon {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></Icon>,
  Undo:       (p) => <Icon {...p}><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></Icon>,
  Save:       (p) => <Icon {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></Icon>,
  Pin:        (p) => <Icon {...p}><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z"/></Icon>,
  Bell:       (p) => <Icon {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></Icon>,
  Help:       (p) => <Icon {...p}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></Icon>,
  Menu:       (p) => <Icon {...p}><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></Icon>,
  Sun:        (p) => <Icon {...p}><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></Icon>,
  Moon:       (p) => <Icon {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></Icon>,
  Split:      (p) => <Icon {...p}><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M21 16v5h-5"/><path d="M3 16v5h5"/><line x1="12" y1="3" x2="12" y2="21"/></Icon>,
  Money:      (p) => <Icon {...p}><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></Icon>,
  Wallet:     (p) => <Icon {...p}><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></Icon>,
  Logo:       (p) => <Icon {...p} size={p.size||20}><path d="M12 2L4 7v6c0 4.97 3.58 9 8 9s8-4.03 8-9V7l-8-5z" fill="currentColor"/><path d="M9 11.5l2 2 4-4" stroke="white" fill="none"/></Icon>,
  ArrowRight: (p) => <Icon {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></Icon>,
  ArrowLeft:  (p) => <Icon {...p}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></Icon>,
  RefreshCw:  (p) => <Icon {...p}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></Icon>,
  Skip:       (p) => <Icon {...p}><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></Icon>,
  Zap:        (p) => <Icon {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Icon>,
  Folder:     (p) => <Icon {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></Icon>,
  Briefcase:  (p) => <Icon {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></Icon>,
  Users:      (p) => <Icon {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></Icon>,
  PieChart:   (p) => <Icon {...p}><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></Icon>,
  Flag:       (p) => <Icon {...p}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></Icon>,
};

// Status pill (chip / dot / solid variants)
function StatusChip({ status, variant = "chip", className = "" }) {
  const meta = STATUS[status] || { label: status, tone: "zinc" };
  const t = TONE_CLASSES[meta.tone];
  if (variant === "dot") {
    return (
      <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${t.text} ${className}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`}></span>
        {meta.label}
      </span>
    );
  }
  if (variant === "solid") {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ${t.solid} ${className}`}>
        {meta.label}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${t.chip} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`}></span>
      {meta.label}
    </span>
  );
}

// Button
function Btn({ as: As = "button", variant = "secondary", size = "md", className = "", icon: IconC, children, ...rest }) {
  const sizes = {
    sm: "h-7 px-2.5 text-[12px] gap-1.5",
    md: "h-9 px-3 text-[13px] gap-2",
    lg: "h-10 px-4 text-sm gap-2",
    icon: "h-8 w-8 p-0 justify-center",
  };
  const variants = {
    primary: "bg-[--accent] text-white hover:brightness-110 shadow-sm shadow-[--accent]/20",
    secondary: "bg-white text-zinc-800 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:bg-zinc-800",
    ghost: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
    soft: "bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    dark: "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100",
  };
  return (
    <As
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${sizes[size]} ${variants[variant]} ${className}`}
      {...rest}
    >
      {IconC && <IconC size={size === "sm" ? 13 : 14} />}
      {children}
    </As>
  );
}

// Card
function Card({ className = "", children, ...rest }) {
  return (
    <div
      className={`rounded-xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

// Input
function Input({ className = "", icon: IconC, ...rest }) {
  return (
    <div className={`relative ${className}`}>
      {IconC && <IconC size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />}
      <input
        className={`h-9 w-full rounded-lg bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 text-[13px] text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-[--accent] focus:outline-none transition ${IconC ? "pl-9 pr-3" : "px-3"}`}
        {...rest}
      />
    </div>
  );
}

// Select wrapper (just styled <select>)
function Select({ className = "", children, ...rest }) {
  return (
    <div className={`relative ${className}`}>
      <select
        className="h-9 w-full appearance-none rounded-lg bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 pl-3 pr-8 text-[13px] text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-[--accent] focus:outline-none transition"
        {...rest}
      >
        {children}
      </select>
      <I.Chevron size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
    </div>
  );
}

// Sparkline (mini bar chart)
function Sparkbars({ data, tone = "blue", className = "" }) {
  const max = Math.max(...data, 1);
  const t = TONE_CLASSES[tone];
  return (
    <div className={`flex h-7 items-end gap-[3px] ${className}`}>
      {data.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${t.bar} opacity-80`}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

// Tabs (segmented)
function Segmented({ value, onChange, options, className = "" }) {
  return (
    <div className={`inline-flex rounded-lg bg-zinc-100 dark:bg-zinc-900 p-0.5 ring-1 ring-zinc-200 dark:ring-zinc-800 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 h-7 rounded-md text-[12px] font-medium transition-all ${
            value === o.value
              ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm"
              : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          {o.label}
          {o.count != null && (
            <span className={`ml-1.5 inline-flex items-center justify-center rounded px-1 text-[10px] font-semibold ${
              value === o.value ? "bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-100" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-500"
            }`}>{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// Avatar circle for unit
function UnitDot({ unit, size = 22 }) {
  const u = typeof unit === "string" ? findUnit(unit) : unit;
  const initials = u.short.slice(0, 1).toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
      style={{ width: size, height: size, backgroundColor: u.color }}
      title={u.name}
    >
      {initials}
    </span>
  );
}

// Modal shell
function Modal({ open, onClose, children, size = "md", className = "" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const sizes = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade">
      <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className={`relative w-full ${sizes[size]} rounded-2xl bg-white dark:bg-zinc-950 shadow-2xl ring-1 ring-zinc-200 dark:ring-zinc-800 animate-pop ${className}`}>
        {children}
      </div>
    </div>
  );
}

// Drawer (right-side slide-in)
function Drawer({ open, onClose, children, width = "max-w-2xl" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <div className={`fixed inset-0 z-40 ${open ? "pointer-events-auto" : "pointer-events-none"}`}>
      <div
        className={`absolute inset-0 bg-zinc-950/40 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      ></div>
      <div
        className={`absolute right-0 top-0 h-full w-full ${width} bg-zinc-50 dark:bg-zinc-950 shadow-2xl ring-1 ring-zinc-200 dark:ring-zinc-800 transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

Object.assign(window, { I, StatusChip, Btn, Card, Input, Select, Sparkbars, Segmented, UnitDot, Modal, Drawer });
