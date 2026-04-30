"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { fetchHrBootstrap } from '@/features/hr/lib/client';
import type { Candidate, CandidateStatus, JobRole } from '@/types';
import { 
  UserPlus, Search, Filter, MoreHorizontal, Mail, Phone, 
  FileText, Calendar, Star, Clock, CheckCircle2, XCircle, 
  ArrowRight, Kanban, List, Loader2 
} from 'lucide-react';

const STATUS_CONFIG: Record<CandidateStatus, { label: string; color: string; icon: any }> = {
  applied: { label: 'Inscrito', color: 'bg-blue-500', icon: Clock },
  screening: { label: 'Triagem', color: 'bg-indigo-500', icon: Filter },
  interview: { label: 'Entrevista', color: 'bg-purple-500', icon: Calendar },
  technical_test: { label: 'Teste Técnico', color: 'bg-pink-500', icon: FileText },
  offer: { label: 'Proposta', color: 'bg-yellow-500', icon: Star },
  hired: { label: 'Contratado', color: 'bg-green-500', icon: CheckCircle2 },
  rejected: { label: 'Reprovado', color: 'bg-red-500', icon: XCircle },
  withdrawn: { label: 'Desistência', color: 'bg-slate-500', icon: ArrowRight },
};

export default function RecruitmentPage() {
  const { firebaseUser } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [search, setSearch] = useState('');

  const loadData = async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const [candidatesRes, rolesRes] = await Promise.all([
        fetch('/api/hr/candidates', {
          headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` }
        }).then(r => r.json()),
        fetchHrBootstrap(firebaseUser)
      ]);
      setCandidates(candidatesRes);
      setRoles(rolesRes.roles);
    } catch (err) {
      console.error('Error loading recruitment data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [firebaseUser]);

  const filteredCandidates = useMemo(() => {
    return candidates.filter(c => 
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase())
    );
  }, [candidates, search]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Recrutamento (ATS)</h1>
          <p className="text-slate-400 mt-1">Gestão de talentos e processos seletivos.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar candidatos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-64"
            />
          </div>
          
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1">
            <button 
              onClick={() => setViewMode('kanban')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'kanban' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Kanban className="h-4 w-4" />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-indigo-500/20">
            <UserPlus className="h-4 w-4" />
            <span>Novo Candidato</span>
          </button>
        </div>
      </div>

      {viewMode === 'kanban' ? (
        <div className="flex-1 flex gap-6 overflow-x-auto pb-4 custom-scrollbar">
          {(['applied', 'screening', 'interview', 'technical_test', 'offer', 'hired'] as CandidateStatus[]).map(status => (
            <KanbanColumn 
              key={status} 
              status={status} 
              candidates={filteredCandidates.filter(c => c.status === status)} 
            />
          ))}
        </div>
      ) : (
        <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/80">
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Candidato</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Cargo</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Inscrição</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filteredCandidates.map(candidate => (
                <tr key={candidate.id} className="hover:bg-slate-800/30 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-semibold text-white">{candidate.name}</span>
                      <span className="text-xs text-slate-500">{candidate.email}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-300">{candidate.jobRoleName || 'N/A'}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${STATUS_CONFIG[candidate.status].color} bg-opacity-10 text-${STATUS_CONFIG[candidate.status].color.split('-')[1]}-400`}>
                      {candidate.status}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">
                    {new Date(candidate.appliedAt).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="p-2 text-slate-500 hover:text-white transition-colors">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KanbanColumn({ status, candidates }: { status: CandidateStatus; candidates: Candidate[] }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div className="flex-shrink-0 w-80 flex flex-col gap-4">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${config.color} bg-opacity-10`}>
            <Icon className={`h-4 w-4 text-${config.color.split('-')[1]}-400`} />
          </div>
          <h3 className="font-bold text-white text-sm uppercase tracking-wider">{config.label}</h3>
          <span className="bg-slate-800 text-slate-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
            {candidates.length}
          </span>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-3 p-2 bg-slate-900/30 rounded-2xl border border-dashed border-slate-800 overflow-y-auto custom-scrollbar">
        {candidates.map(candidate => (
          <div 
            key={candidate.id}
            className="p-4 bg-slate-900 border border-slate-800 rounded-xl hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/5 transition-all cursor-pointer group"
          >
            <div className="flex items-start justify-between">
              <h4 className="font-bold text-white group-hover:text-indigo-400 transition-colors">{candidate.name}</h4>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map(star => (
                  <Star 
                    key={star} 
                    className={`h-2.5 w-2.5 ${star <= (candidate.rating || 0) ? 'fill-yellow-500 text-yellow-500' : 'text-slate-700'}`} 
                  />
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-1 truncate">{candidate.jobRoleName}</p>
            
            <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-800/50">
              <div className="flex items-center gap-1 text-[10px] text-slate-500">
                <Mail className="h-3 w-3" />
                <span className="hidden group-hover:inline">E-mail</span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-slate-500">
                <Phone className="h-3 w-3" />
                <span className="hidden group-hover:inline">Ligar</span>
              </div>
              <div className="ml-auto flex items-center gap-1 text-[10px] text-slate-600">
                <Calendar className="h-3 w-3" />
                <span>{new Date(candidate.appliedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
              </div>
            </div>
          </div>
        ))}
        {candidates.length === 0 && (
          <div className="h-32 flex flex-col items-center justify-center text-slate-600 gap-2 opacity-50">
            <UserPlus className="h-6 w-6" />
            <span className="text-[10px] font-medium uppercase tracking-widest">Vazio</span>
          </div>
        )}
      </div>
    </div>
  );
}
