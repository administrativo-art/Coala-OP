"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  Search,
  Users,
  ChevronDown,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  GripVertical,
  X,
  Briefcase,
  ListChecks,
  Award,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useHrBootstrap } from "@/hooks/use-hr-bootstrap";
import { updateHrRole } from "@/features/hr/lib/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { JobRole, User } from "@/types";

interface OrgNode {
  role: JobRole;
  employees: User[];
  children: OrgNode[];
}

function buildTree(roles: JobRole[], allUsers: User[]): OrgNode[] {
  const nodesMap = new Map<string, OrgNode>();
  roles.forEach((role) => {
    nodesMap.set(role.id, {
      role,
      employees: allUsers.filter((u) => u.jobRoleId === role.id && u.isActive !== false),
      children: [],
    });
  });

  const roots: OrgNode[] = [];
  nodesMap.forEach((node) => {
    if (node.role.reportsTo && nodesMap.has(node.role.reportsTo)) {
      nodesMap.get(node.role.reportsTo)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function nodeMatchesSearch(node: OrgNode, search: string): boolean {
  const q = search.toLowerCase();
  if (node.role.name.toLowerCase().includes(q)) return true;
  if (node.role.publicTitle?.toLowerCase().includes(q)) return true;
  if (node.employees.some((e) => e.username.toLowerCase().includes(q))) return true;
  return node.children.some((c) => nodeMatchesSearch(c, search));
}

// ─── Role Detail Modal ──────────────────────────────────────────────────────

function RoleDetailModal({
  role,
  employees,
  onClose,
}: {
  role: JobRole | null;
  employees: User[];
  onClose: () => void;
}) {
  if (!role) return null;
  return (
    <Dialog open={!!role} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg bg-slate-900 border border-slate-800 text-white">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-white">{role.name}</DialogTitle>
          {role.publicTitle && (
            <p className="text-indigo-400 text-sm font-medium uppercase tracking-wider">{role.publicTitle}</p>
          )}
        </DialogHeader>

        <div className="space-y-4 mt-2 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
          {role.description && (
            <p className="text-slate-300 text-sm leading-relaxed">{role.description}</p>
          )}

          {employees.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">
                <Users className="h-3 w-3" />
                <span>Colaboradores ({employees.length})</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {employees.map((emp) => (
                  <div key={emp.id} className="flex items-center gap-1.5 bg-slate-800 rounded-lg px-2 py-1">
                    <div
                      className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                      style={{ backgroundColor: emp.color || "#4f46e5" }}
                    >
                      {emp.avatarUrl ? (
                        <img src={emp.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
                      ) : (
                        emp.username.substring(0, 2).toUpperCase()
                      )}
                    </div>
                    <span className="text-slate-300 text-xs">{emp.username}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {role.responsibilities && role.responsibilities.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">
                <Briefcase className="h-3 w-3" />
                <span>Responsabilidades</span>
              </div>
              <ul className="space-y-1">
                {role.responsibilities.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-slate-300 text-sm">
                    <span className="text-indigo-400 mt-0.5">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {role.requirements && role.requirements.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">
                <ListChecks className="h-3 w-3" />
                <span>Requisitos</span>
              </div>
              <ul className="space-y-1">
                {role.requirements.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-slate-300 text-sm">
                    <span className="text-indigo-400 mt-0.5">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {role.competencies && role.competencies.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">
                <Award className="h-3 w-3" />
                <span>Competências</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {role.competencies.map((c, i) => (
                  <span key={i} className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs px-2 py-0.5 rounded-full">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {role.salaryRange?.visible && (role.salaryRange.min || role.salaryRange.max) && (
            <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">Faixa Salarial</p>
              <p className="text-white font-semibold">
                {role.salaryRange.currency}{" "}
                {role.salaryRange.min?.toLocaleString("pt-BR")}
                {role.salaryRange.min && role.salaryRange.max ? " – " : ""}
                {role.salaryRange.max?.toLocaleString("pt-BR")}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Draggable/Droppable Node Card ─────────────────────────────────────────

function DraggableDroppableCard({
  node,
  canDrag,
  onOpenModal,
  isDraggingOver,
}: {
  node: OrgNode;
  canDrag: boolean;
  onOpenModal: (node: OrgNode) => void;
  isDraggingOver: boolean;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: node.role.id,
    disabled: !canDrag,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: node.role.id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const isDropTarget = isOver || isDraggingOver;

  return (
    <div
      ref={(el) => { setDragRef(el); setDropRef(el); }}
      style={style}
      className={`relative p-5 rounded-2xl border transition-all duration-200 w-72 group/card ${
        isDropTarget
          ? "bg-indigo-900/30 border-indigo-500/70 shadow-[0_0_20px_rgba(79,70,229,0.25)]"
          : "bg-slate-900/80 border-slate-800 hover:border-indigo-500/50 hover:shadow-[0_0_20px_rgba(79,70,229,0.1)]"
      }`}
    >
      {canDrag && (
        <div
          {...listeners}
          {...attributes}
          className="absolute top-3 right-3 p-1 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-slate-800 cursor-grab active:cursor-grabbing opacity-0 group-hover/card:opacity-100 transition-opacity"
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}

      <button
        className="text-left w-full"
        onClick={() => onOpenModal(node)}
      >
        <h3 className="font-bold text-white leading-tight pr-6">{node.role.name}</h3>
        <p className="text-indigo-400 text-xs font-medium uppercase tracking-wider mt-1">
          {node.role.publicTitle || "Cargo Interno"}
        </p>
      </button>

      <div className="mt-4 space-y-2">
        {node.employees.length > 0 ? (
          node.employees.map((emp) => (
            <div key={emp.id} className="flex items-center gap-2">
              <div
                className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                style={{ backgroundColor: emp.color || "#4f46e5" }}
              >
                {emp.avatarUrl ? (
                  <img src={emp.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  emp.username.substring(0, 2).toUpperCase()
                )}
              </div>
              <span className="text-slate-300 text-sm truncate">{emp.username}</span>
            </div>
          ))
        ) : (
          <div className="flex items-center gap-2 text-slate-600 italic text-xs py-1">
            <Users className="h-3 w-3" />
            <span>Vago</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Root Drop Zone ─────────────────────────────────────────────────────────

function RootDropZone({ visible }: { visible: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "__root__" });
  if (!visible) return null;
  return (
    <div
      ref={setNodeRef}
      className={`w-full mb-6 flex items-center justify-center rounded-2xl border-2 border-dashed py-3 text-sm font-medium transition-all duration-200 ${
        isOver
          ? "border-indigo-400 bg-indigo-500/10 text-indigo-300"
          : "border-slate-700 text-slate-600"
      }`}
    >
      Soltar aqui para tornar cargo raiz (sem hierarquia superior)
    </div>
  );
}

// ─── Org Tree Node ──────────────────────────────────────────────────────────

function OrgTreeNode({
  node,
  expandedNodes,
  onToggle,
  search,
  canDrag,
  onOpenModal,
  activeId,
}: {
  node: OrgNode;
  expandedNodes: Set<string>;
  onToggle: (id: string) => void;
  search: string;
  canDrag: boolean;
  onOpenModal: (node: OrgNode) => void;
  activeId: string | null;
}) {
  const isExpanded = expandedNodes.has(node.role.id);
  const hasChildren = node.children.length > 0;

  if (search !== "" && !nodeMatchesSearch(node, search)) return null;

  return (
    <div className="flex flex-col items-center">
      <DraggableDroppableCard
        node={node}
        canDrag={canDrag}
        onOpenModal={onOpenModal}
        isDraggingOver={false}
      />

      {hasChildren && (
        <button
          onClick={() => onToggle(node.role.id)}
          className="mt-1 mb-1 w-6 h-6 bg-slate-800 border border-slate-700 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-indigo-600 hover:border-indigo-500 transition-all z-10"
        >
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
      )}

      {hasChildren && isExpanded && (
        <>
          <div className="w-px h-4 bg-gradient-to-b from-indigo-500/40 to-indigo-500/10" />
          <div className="relative flex gap-8">
            {node.children.length > 1 && (
              <div className="absolute top-0 left-6 right-6 h-px bg-indigo-500/20" />
            )}
            {node.children.map((child) => (
              <div key={child.role.id} className="flex flex-col items-center">
                <div className="w-px h-4 bg-indigo-500/20" />
                <OrgTreeNode
                  node={child}
                  expandedNodes={expandedNodes}
                  onToggle={onToggle}
                  search={search}
                  canDrag={canDrag}
                  onOpenModal={onOpenModal}
                  activeId={activeId}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function OrgChartPage() {
  const { firebaseUser, users: allUsers } = useAuth();
  const { roles, access, loading, error, refresh } = useHrBootstrap();

  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<OrgNode | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canDrag = access.canManageCatalog;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const tree = useMemo(() => buildTree(roles, allUsers ?? []), [roles, allUsers]);

  React.useEffect(() => {
    if (tree.length > 0 && expandedNodes.size === 0) {
      setExpandedNodes(new Set(tree.map((n) => n.role.id)));
    }
  }, [tree]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const roleId = String(active.id);
    const newParentId = over.id === "__root__" ? null : String(over.id);

    setSaving(true);
    try {
      await updateHrRole(firebaseUser!, roleId, { reportsTo: newParentId });
      await refresh();
    } catch (err) {
      console.error("Falha ao atualizar hierarquia:", err);
    } finally {
      setSaving(false);
    }
  }, [firebaseUser, refresh]);

  const activeRole = useMemo(
    () => roles.find((r) => r.id === activeId) ?? null,
    [roles, activeId]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          <p className="text-indigo-400 font-medium animate-pulse">Carregando Organograma...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex flex-col h-full space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Organograma</h1>
            <p className="text-slate-400 mt-1">Estrutura hierárquica e distribuição de cargos.</p>
          </div>

          <div className="flex items-center gap-3">
            {saving && (
              <span className="text-xs text-indigo-400 animate-pulse">Salvando...</span>
            )}

            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
              <input
                type="text"
                placeholder="Buscar cargo ou colaborador..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/50 transition-all w-64"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex bg-slate-900/50 border border-slate-800 rounded-xl p-1">
              <button
                onClick={() => setZoom((z) => Math.min(z + 0.15, 2))}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"
                title="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"
                title="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <div className="w-px bg-slate-800 mx-1 my-1" />
              <button
                onClick={() => setZoom(1)}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"
                title="Reset zoom"
              >
                <Maximize className="h-4 w-4" />
              </button>
            </div>

            {canDrag && (
              <div className="flex items-center gap-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-3 py-1.5 text-indigo-400 text-xs">
                <GripVertical className="h-3 w-3" />
                <span>Arraste para reorganizar</span>
              </div>
            )}
          </div>
        </div>

        {/* Chart */}
        <div className="flex-1 bg-slate-950/50 border border-slate-900 rounded-2xl overflow-auto custom-scrollbar p-8">
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top center",
              minWidth: "max-content",
              transition: "transform 0.15s ease",
            }}
          >
            <RootDropZone visible={canDrag && !!activeId} />
            <div className="flex gap-12 justify-center">
              {tree.map((node) => (
                <OrgTreeNode
                  key={node.role.id}
                  node={node}
                  expandedNodes={expandedNodes}
                  onToggle={toggleExpand}
                  search={search}
                  canDrag={canDrag}
                  onOpenModal={setSelectedNode}
                  activeId={activeId}
                />
              ))}
            </div>
            {tree.length === 0 && (
              <div className="text-center text-slate-600 py-16">
                <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Nenhum cargo cadastrado.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeRole && (
          <div className="p-4 rounded-2xl border border-indigo-500/50 bg-slate-900/95 shadow-2xl w-72 opacity-90">
            <h3 className="font-bold text-white">{activeRole.name}</h3>
            <p className="text-indigo-400 text-xs uppercase tracking-wider mt-0.5">{activeRole.publicTitle || "Cargo Interno"}</p>
          </div>
        )}
      </DragOverlay>

      {/* Role detail modal */}
      <RoleDetailModal
        role={selectedNode?.role ?? null}
        employees={selectedNode?.employees ?? []}
        onClose={() => setSelectedNode(null)}
      />
    </DndContext>
  );
}
