"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { fetchHrBootstrap } from '@/features/hr/lib/client';
import type { JobRole, User } from '@/types';
import { Search, Users, ChevronDown, ChevronRight, Layout, ZoomIn, ZoomOut, Maximize } from 'lucide-react';

interface OrgNode {
  role: JobRole;
  employees: User[];
  children: OrgNode[];
}

export default function OrgChartPage() {
  const { firebaseUser, users: allUsers, loading: authLoading } = useAuth();
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      if (!firebaseUser) return;
      try {
        const data = await fetchHrBootstrap(firebaseUser);
        setRoles(data.roles);
        // Initially expand top level
        const topLevelIds = data.roles.filter(r => !r.reportsTo).map(r => r.id);
        setExpandedNodes(new Set(topLevelIds));
      } catch (err) {
        console.error('Error loading roles:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [firebaseUser]);

  const tree = useMemo(() => {
    if (!roles.length) return [];

    const nodesMap = new Map<string, OrgNode>();
    
    // Create nodes
    roles.forEach(role => {
      nodesMap.set(role.id, {
        role,
        employees: allUsers.filter(u => u.jobRoleId === role.id && u.isActive !== false),
        children: []
      });
    });

    const rootNodes: OrgNode[] = [];

    // Build hierarchy
    nodesMap.forEach(node => {
      if (node.role.reportsTo && nodesMap.has(node.role.reportsTo)) {
        nodesMap.get(node.role.reportsTo)!.children.push(node);
      } else {
        rootNodes.push(node);
      }
    });

    return rootNodes;
  }, [roles, allUsers]);

  const toggleExpand = (id: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading || authLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
          <p className="text-indigo-400 font-medium animate-pulse">Carregando Organograma...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Organograma</h1>
          <p className="text-slate-400 mt-1">Estrutura hierárquica e distribuição de cargos.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
            <input
              type="text"
              placeholder="Buscar cargo ou colaborador..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/50 transition-all w-64"
            />
          </div>
          
          <div className="flex bg-slate-900/50 border border-slate-800 rounded-xl p-1">
            <button className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all">
              <ZoomOut className="h-4 w-4" />
            </button>
            <div className="w-px bg-slate-800 mx-1 my-1" />
            <button className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all">
              <Maximize className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Chart Area */}
      <div className="flex-1 bg-slate-950/50 border border-slate-900 rounded-2xl overflow-auto custom-scrollbar p-8">
        <div className="min-w-max">
          {tree.map(node => (
            <OrgTreeNode 
              key={node.role.id} 
              node={node} 
              expandedNodes={expandedNodes} 
              onToggle={toggleExpand}
              search={search}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function OrgTreeNode({ 
  node, 
  expandedNodes, 
  onToggle,
  search 
}: { 
  node: OrgNode; 
  expandedNodes: Set<string>; 
  onToggle: (id: string) => void;
  search: string;
}) {
  const isExpanded = expandedNodes.has(node.role.id);
  const hasChildren = node.children.length > 0;
  
  // Basic filtering
  const matchesSearch = search === '' || 
    node.role.name.toLowerCase().includes(search.toLowerCase()) ||
    node.employees.some(e => e.username.toLowerCase().includes(search.toLowerCase()));

  if (search !== '' && !matchesSearch && !node.children.some(c => hasVisibleMatch(c, search))) {
    return null;
  }

  return (
    <div className="flex flex-col items-center">
      {/* Node Card */}
      <div 
        className={`relative p-5 rounded-2xl border transition-all duration-300 w-72 ${
          matchesSearch 
            ? 'bg-slate-900/80 border-slate-800 hover:border-indigo-500/50 hover:shadow-[0_0_20px_rgba(79,70,229,0.1)]' 
            : 'bg-slate-900/30 border-slate-900 opacity-60'
        }`}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-white leading-tight">{node.role.name}</h3>
            <p className="text-indigo-400 text-xs font-medium uppercase tracking-wider mt-1">{node.role.publicTitle || 'Cargo Interno'}</p>
          </div>
          <div className="p-2 bg-indigo-500/10 rounded-xl">
            <Layout className="h-4 w-4 text-indigo-400" />
          </div>
        </div>

        {/* Employees in this role */}
        <div className="mt-4 space-y-2">
          {node.employees.length > 0 ? (
            node.employees.map(emp => (
              <div key={emp.id} className="flex items-center gap-2 group/emp">
                <div 
                  className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                  style={{ backgroundColor: emp.color || '#4f46e5' }}
                >
                  {emp.avatarUrl ? (
                    <img src={emp.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
                  ) : (
                    emp.username.substring(0, 2).toUpperCase()
                  )}
                </div>
                <span className="text-slate-300 text-sm truncate group-hover/emp:text-white transition-colors">{emp.username}</span>
              </div>
            ))
          ) : (
            <div className="flex items-center gap-2 text-slate-600 italic text-xs py-1">
              <Users className="h-3 w-3" />
              <span>Vago</span>
            </div>
          )}
        </div>

        {/* Child toggle */}
        {hasChildren && (
          <button 
            onClick={() => onToggle(node.role.id)}
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 bg-slate-800 border border-slate-700 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-indigo-600 hover:border-indigo-500 transition-all z-10"
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        )}
      </div>

      {/* Children connector and list */}
      {hasChildren && isExpanded && (
        <div className="flex flex-col items-center">
          {/* Vertical line connector */}
          <div className="w-px h-8 bg-gradient-to-b from-indigo-500/50 to-indigo-500/20" />
          
          <div className="relative flex gap-8">
            {/* Horizontal line connector */}
            {node.children.length > 1 && (
              <div className="absolute top-0 left-0 right-0 h-px bg-indigo-500/20 w-[calc(100%-2.25rem)] mx-auto" />
            )}
            
            {node.children.map((child, idx) => (
              <div key={child.role.id} className="relative flex flex-col items-center">
                {/* Short vertical connector to horizontal line */}
                <div className="w-px h-4 bg-indigo-500/20" />
                <OrgTreeNode 
                  node={child} 
                  expandedNodes={expandedNodes} 
                  onToggle={onToggle}
                  search={search}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function hasVisibleMatch(node: OrgNode, search: string): boolean {
  if (node.role.name.toLowerCase().includes(search.toLowerCase())) return true;
  if (node.employees.some(e => e.username.toLowerCase().includes(search.toLowerCase()))) return true;
  return node.children.some(c => hasVisibleMatch(c, search));
}
