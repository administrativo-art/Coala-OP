

"use client";

import React, { useCallback, useMemo, useEffect, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  MarkerType,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { type FormTemplate, type FormQuestion, type FormSection } from '@/types';
import { SectionNode } from './section-node';
import { QuestionNode } from './form-question-node';
import { EdgeDeleteButton } from './edge-delete-button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';


interface FormBuilderProps {
    template: FormTemplate | Omit<FormTemplate, 'id' | 'status'>;
    onTemplateChange: (template: FormTemplate | Omit<FormTemplate, 'id' | 'status'>) => void;
    onSelectQuestion: (questionId: string | null) => void;
    selectedQuestionId: string | null;
    onSelectSection: (sectionId: string | null) => void;
    selectedSectionId: string | null;
    onDeleteQuestion: (questionId: string) => void;
}

const nodeTypes = {
  section: SectionNode,
  question: QuestionNode,
};

const edgeTypes = {
  deletable: EdgeDeleteButton,
};

const findParentSection = (sections: FormSection[], x: number, y: number): FormSection | undefined => {
    return sections.find(sec => {
        const secX = sec.position.x;
        const secY = sec.position.y;
        const secWidth = sec.width || 400;
        const secHeight = sec.height || 200;
        return x >= secX && x <= secX + secWidth &&
               y >= secY && y <= secY + secHeight;
    });
};


export function FormBuilder({ 
  template, 
  onTemplateChange,
  onSelectQuestion,
  selectedQuestionId,
  onSelectSection,
  selectedSectionId,
  onDeleteQuestion,
}: FormBuilderProps) {
  const reactFlow = useReactFlow();
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, nodeId: string, inSection: boolean } | null>(null);

  const allQuestions = useMemo(() => {
    const sectionQuestions = (template.sections || []).flatMap(s => s.questions || []);
    const floatingQuestions = template.questions || [];
    return [...sectionQuestions, ...floatingQuestions];
  }, [template.sections, template.questions]);

  const initialNodes = useMemo(() => {
    const nodes: Node[] = [];

    // Render sections
    (template.sections || []).forEach(section => {
      nodes.push({
        id: section.id,
        type: 'section',
        position: section.position,
        data: {
          label: section.name,
          color: section.color,
          onUpdate: (updates: Partial<FormSection>) => {
              const newSections = template.sections.map(s => s.id === section.id ? { ...s, ...updates } : s);
              onTemplateChange({ ...template, sections: newSections });
          },
          onDelete: () => {
              const newSections = template.sections.filter(s => s.id !== section.id);
              onTemplateChange({ ...template, sections: newSections });
          },
        },
        style: { width: section.width || 400, height: section.height || 200 },
        zIndex: 1,
        selected: section.id === selectedSectionId,
      });
    });

    // Render all questions (both in sections and floating)
    allQuestions.forEach(question => {
        nodes.push({
            id: question.id,
            type: 'question',
            position: question.position,
            parentNode: question.sectionId || undefined,
            extent: question.sectionId ? 'parent' : undefined,
            data: {
              ...question,
              onDelete: () => onDeleteQuestion(question.id),
            },
            selected: question.id === selectedQuestionId,
            zIndex: 2,
        });
    });

    return nodes;
  }, [template, onTemplateChange, selectedQuestionId, selectedSectionId, onDeleteQuestion, allQuestions]);
  
  const initialEdges = useMemo(() => {
     const newEdges: Edge[] = [];
      allQuestions.forEach(question => {
          if (question.ramifications) {
              question.ramifications.forEach(ramification => {
                  if (ramification.action === 'show_question' && ramification.targetQuestionId) {
                      newEdges.push({
                          id: `e-${question.id}-${ramification.targetQuestionId}`,
                          source: question.id,
                          target: ramification.targetQuestionId,
                          type: 'deletable',
                          markerEnd: { type: MarkerType.ArrowClosed },
                      });
                  }
              });
          }
      });
      return newEdges;
  }, [allQuestions]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);
  
  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

   const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
        if (node.type === 'section') {
            const newSections = template.sections.map(s =>
                s.id === node.id ? { ...s, position: node.position, width: node.width || s.width, height: node.height || s.height } : s
            );
            onTemplateChange({ ...template, sections: newSections });
            return;
        }

        if (node.type === 'question') {
            const newQuestions = allQuestions.map(q => q.id === node.id ? {...q, position: node.position} : q);
             const newTemplate = { ...template, sections: [...template.sections], questions: [...(template.questions || [])] };
             const question = newQuestions.find(q => q.id === node.id)!;
             
             // Remove from wherever it was
             newTemplate.sections.forEach(s => { s.questions = s.questions.filter(q => q.id !== node.id) });
             newTemplate.questions = newTemplate.questions.filter(q => q.id !== node.id);

             // Add to new parent or root
             if(node.parentNode) {
                 const parentSection = newTemplate.sections.find(s => s.id === node.parentNode);
                 parentSection?.questions.push(question);
             } else {
                 newTemplate.questions.push(question);
             }
             onTemplateChange(newTemplate);
        }
    },
    [template, onTemplateChange, allQuestions]
  );


  const handleNodeClick = (_: any, node: Node) => {
    if (node.type === 'section') {
        onSelectSection(node.id);
        onSelectQuestion(null);
    } else if (node.type === 'question') {
        onSelectSection(node.parentNode || null);
        onSelectQuestion(node.id);
    }
  };

  const onConnect = useCallback(
    (params: Edge | Connection) => {
      const newEdge = { ...params, type: 'deletable', markerEnd: { type: MarkerType.ArrowClosed }};
      setEdges((eds) => addEdge(newEdge, eds));
      
      const newTemplate = { ...template, sections: [...template.sections], questions: [...(template.questions || [])] };

      const updateQuestionRamification = (q: FormQuestion) => {
          if (q.id === params.source) {
            const newRamification = {
              id: `ram-${Date.now()}`,
              conditions: [], // Simplified: no condition for direct connection
              action: 'show_question' as const,
              targetQuestionId: params.target!,
            };
            return { ...q, ramifications: [...(q.ramifications || []), newRamification] };
          }
          return q;
      };

      newTemplate.sections = newTemplate.sections.map(section => ({
        ...section,
        questions: (section.questions || []).map(updateQuestionRamification)
      }));
      newTemplate.questions = (newTemplate.questions || []).map(updateQuestionRamification);
      
      onTemplateChange(newTemplate);
    },
    [setEdges, template, onTemplateChange]
  );
  
  const handleEdgeDelete = (edgeId: string) => {
    const [_, sourceId, targetId] = edgeId.split('-');
    
    const newTemplate = { ...template, sections: [...template.sections], questions: [...(template.questions || [])] };
    
    const updateQuestionRamification = (q: FormQuestion) => {
        if (q.id === sourceId) {
            const newRamifications = (q.ramifications || []).filter(
                ram => !(ram.action === 'show_question' && ram.targetQuestionId === targetId)
            );
            return { ...q, ramifications: newRamifications };
        }
        return q;
    }

    newTemplate.sections = newTemplate.sections.map(section => ({
        ...section,
        questions: (section.questions || []).map(updateQuestionRamification)
    }));
    newTemplate.questions = (newTemplate.questions || []).map(updateQuestionRamification);

    onTemplateChange(newTemplate);
};

const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      if (node.type !== 'question') return;
      
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: node.id,
        inSection: !!node.parentNode,
      });
    },
    []
);

const handleGroup = () => {
    if (!contextMenu) return;
    const nodeId = contextMenu.nodeId;
    const node = reactFlow.getNode(nodeId);
    if (!node || !node.positionAbsolute) return;

    const parentSection = findParentSection(template.sections, node.positionAbsolute.x, node.positionAbsolute.y);
    if (!parentSection) return;

    const question = allQuestions.find(q => q.id === nodeId)!;
    const newTemplate = { ...template };
    
    // Calculate new relative position
    const relativePosition = {
        x: node.positionAbsolute.x - parentSection.position.x,
        y: node.positionAbsolute.y - parentSection.position.y,
    };

    // Remove from root
    newTemplate.questions = (newTemplate.questions || []).filter(q => q.id !== nodeId);
    
    // Add to section
    const targetSection = newTemplate.sections.find(s => s.id === parentSection.id)!;
    targetSection.questions = [...(targetSection.questions || []), { ...question, sectionId: parentSection.id, position: relativePosition }];
    
    onTemplateChange(newTemplate);
    setContextMenu(null);
};

const handleUngroup = () => {
    if (!contextMenu) return;
    const nodeId = contextMenu.nodeId;
    const node = reactFlow.getNode(nodeId);
    if (!node) return;
    
    const question = allQuestions.find(q => q.id === nodeId)!;
    const oldSectionId = question.sectionId;
    if (!oldSectionId) return;

    const newTemplate = { ...template };
    
    // Remove from section
    const sourceSection = newTemplate.sections.find(s => s.id === oldSectionId)!;
    sourceSection.questions = sourceSection.questions.filter(q => q.id !== nodeId);

    // Add to root with absolute position
    newTemplate.questions = [...(newTemplate.questions || []), { ...question, sectionId: null, position: node.positionAbsolute! }];

    onTemplateChange(newTemplate);
    setContextMenu(null);
};


  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        nodeDragThreshold={5}
        deleteKeyCode={['Backspace', 'Delete']}
        onEdgesDelete={(edgesToDelete) => handleEdgeDelete(edgesToDelete[0].id)}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>

      {contextMenu && (
        <div style={{ position: 'absolute', top: contextMenu.y, left: contextMenu.x }}>
            <DropdownMenu open={true} onOpenChange={() => setContextMenu(null)}>
                <DropdownMenuTrigger asChild><button style={{all: 'unset'}}></button></DropdownMenuTrigger>
                <DropdownMenuContent>
                    {contextMenu.inSection ? (
                        <DropdownMenuItem onSelect={handleUngroup}>Desagrupar da Seção</DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem onSelect={handleGroup}>Agrupar à Seção</DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
      )}
    </div>
  );
}
