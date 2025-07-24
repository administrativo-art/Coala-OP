

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
  useReactFlow,
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
  const allQuestions = useMemo(() => {
    const sectionQuestions = template.sections.flatMap(s => s.questions || []);
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
            dragHandle: '.drag-handle-question',
            data: {
              ...question,
              onDelete: () => onDeleteQuestion(question.id),
              onTogglePin: () => {
                const currentQuestion = allQuestions.find(q => q.id === question.id)!;
                const isPinned = !!currentQuestion.sectionId;
                const newTemplate = { ...template };
                
                if (isPinned) {
                    // Unpin: Move from section to root
                    const sourceSection = newTemplate.sections.find(s => s.id === currentQuestion.sectionId);
                    if (sourceSection) {
                        sourceSection.questions = sourceSection.questions.filter(q => q.id !== currentQuestion.id);
                    }
                    newTemplate.questions = [...(newTemplate.questions || []), { ...currentQuestion, sectionId: null }];
                } else {
                    // Pin: Move from root to section
                    const node = reactFlow.getNode(question.id);
                    const parentSection = node?.positionAbsolute ? findParentSection(template.sections, node.positionAbsolute.x, node.positionAbsolute.y) : null;
                    if (parentSection) {
                        newTemplate.questions = (newTemplate.questions || []).filter(q => q.id !== currentQuestion.id);
                        const targetSection = newTemplate.sections.find(s => s.id === parentSection.id);
                        if(targetSection) {
                           targetSection.questions.push({ ...currentQuestion, sectionId: parentSection.id });
                        }
                    }
                }
                onTemplateChange(newTemplate);
              }
            },
            selected: question.id === selectedQuestionId,
            zIndex: 2,
        });
    });

    return nodes;
  }, [template, onTemplateChange, selectedQuestionId, selectedSectionId, onDeleteQuestion, allQuestions, reactFlow]);
  
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
  const nodeRef = React.useRef(nodes);

  useEffect(() => {
    nodeRef.current = nodes;
  }, [nodes]);
  
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

        if (node.type === 'question' && node.positionAbsolute) {
            const questionId = node.id;
            const newTemplate = { ...template, sections: [...template.sections], questions: [...(template.questions || [])] };
            
            const question = allQuestions.find(q => q.id === questionId)!;
            const oldSectionId = question.sectionId;
            const newParentSection = findParentSection(template.sections, node.positionAbsolute.x, node.positionAbsolute.y);

            // Remove from old location
            if (oldSectionId) {
                const sourceSection = newTemplate.sections.find(s => s.id === oldSectionId);
                if (sourceSection) {
                    sourceSection.questions = sourceSection.questions.filter(q => q.id !== questionId);
                }
            } else {
                newTemplate.questions = newTemplate.questions.filter(q => q.id !== questionId);
            }

            // Add to new location
            const updatedQuestion = { ...question, position: node.position, sectionId: newParentSection?.id || null };
            if (newParentSection) {
                const targetSection = newTemplate.sections.find(s => s.id === newParentSection.id);
                if(targetSection) {
                    targetSection.questions.push(updatedQuestion);
                }
            } else {
                newTemplate.questions.push(updatedQuestion);
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
        questions: section.questions.map(updateQuestionRamification)
      }));
      newTemplate.questions = newTemplate.questions.map(updateQuestionRamification);
      
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
        questions: section.questions.map(updateQuestionRamification)
    }));
    newTemplate.questions = newTemplate.questions.map(updateQuestionRamification);

    onTemplateChange(newTemplate);
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
