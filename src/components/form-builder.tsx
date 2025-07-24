

"use client";

import React, { useCallback, useMemo, useEffect } from 'react';
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
} from 'reactflow';
import 'reactflow/dist/style.css';
import { type FormTemplate, type FormQuestion, type FormSection } from '@/types';
import { SectionNode } from './section-node';
import { QuestionNode } from './form-question-node';
import { EdgeDeleteButton } from './edge-delete-button';

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

// Helper function to find which section a point is inside
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
  
  const allQuestions = useMemo(() => template.sections.flatMap(s => s.questions || []), [template.sections]);

  const initialNodes = useMemo(() => {
    const nodes: Node[] = [];

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

      section.questions.forEach(question => {
        nodes.push({
          id: question.id,
          type: 'question',
          position: question.position,
          parentNode: question.sectionId || undefined,
          extent: question.sectionId ? 'parent' : undefined,
          dragHandle: '.drag-handle-question',
          data: {
            ...question,
            onDelete: () => onDeleteQuestion(question.id),
            onTogglePin: () => {
              // This is where the pin toggle logic will go
            }
          },
          selected: question.id === selectedQuestionId,
          zIndex: 2,
        });
      });
    });

    return nodes;
  }, [template, onTemplateChange, selectedQuestionId, selectedSectionId, onDeleteQuestion]);
  
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

const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'section') {
        const newSections = template.sections.map(s => 
            s.id === node.id ? { ...s, position: node.position, width: node.width || s.width, height: node.height || s.height } : s
        );
        onTemplateChange({ ...template, sections: newSections });
        return;
    }

    if (node.type === 'question') {
        const questionId = node.id;
        let currentQuestion = allQuestions.find(q => q.id === questionId);
        if (!currentQuestion) return;

        const oldSectionId = currentQuestion.sectionId;
        const newParentSection = findParentSection(template.sections, node.position.x + (node.width! / 2), node.position.y + (node.height! / 2));
        const newSectionId = newParentSection ? newParentSection.id : null;
        
        // If the section remains the same, just update the position.
        if (oldSectionId === newSectionId) {
            if (oldSectionId) {
                 const newSections = template.sections.map(s => {
                    if (s.id === oldSectionId) {
                        return {
                            ...s,
                            questions: s.questions.map(q => q.id === questionId ? { ...q, position: node.position } : q)
                        };
                    }
                    return s;
                });
                onTemplateChange({ ...template, sections: newSections });
            }
            return;
        }

        // Section has changed, move the question.
        let newSections = [...template.sections];
        
        // 1. Remove from old section
        if (oldSectionId) {
            newSections = newSections.map(s => {
                if (s.id === oldSectionId) {
                    return { ...s, questions: s.questions.filter(q => q.id !== questionId) };
                }
                return s;
            });
        }

        // 2. Add to new section (if any)
        if (newSectionId) {
             newSections = newSections.map(s => {
                if (s.id === newSectionId) {
                    const newQuestion = { ...currentQuestion!, position: node.position, sectionId: newSectionId };
                    return { ...s, questions: [...s.questions, newQuestion] };
                }
                return s;
            });
        } else {
           // The question is now orphaned. We need a place to store it.
           // For now, it will be removed from all sections. A better implementation might add it to a top-level `questions` array.
        }

        onTemplateChange({ ...template, sections: newSections });
    }
}, [template, onTemplateChange, allQuestions, nodes]);


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
      
      const newSections = template.sections.map(section => ({
        ...section,
        questions: section.questions.map(q => {
          if (q.id === params.source) {
            const newRamification = {
              id: `ram-${Date.now()}`,
              conditions: [], // Simplified: no condition for direct connection
              action: 'show_question' as const,
              targetQuestionId: params.target!,
            };
            return {
              ...q,
              ramifications: [...(q.ramifications || []), newRamification]
            };
          }
          return q;
        })
      }));
      onTemplateChange({ ...template, sections: newSections });
    },
    [setEdges, template, onTemplateChange]
  );
  
  const handleEdgeDelete = (edgeId: string) => {
    const [_, sourceId, targetId] = edgeId.split('-');
    
    const newSections = template.sections.map(section => ({
        ...section,
        questions: section.questions.map(question => {
            if (question.id === sourceId) {
                const newRamifications = (question.ramifications || []).filter(
                    ram => !(ram.action === 'show_question' && ram.targetQuestionId === targetId)
                );
                return { ...question, ramifications: newRamifications };
            }
            return question;
        })
    }));

    onTemplateChange({ ...template, sections: newSections });
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
    </div>
  );
}
