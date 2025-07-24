

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
const findParentSection = (sections: FormSection[], x: number, y: number, width: number, height: number): FormSection | undefined => {
    return sections.find(sec => {
        const secX = sec.position.x;
        const secY = sec.position.y;
        const secWidth = sec.width || 400;
        const secHeight = sec.height || 200;
        return x >= secX && x + width <= secX + secWidth &&
               y >= secY && y + height <= secY + secHeight;
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
    });

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
            onPinToggle: () => {
                 const currentQuestion = allQuestions.find(q => q.id === question.id)!;
                 let newSectionId: string | null = null;
                 
                 // If un-pinning, set sectionId to null
                 if (currentQuestion.sectionId) {
                     newSectionId = null;
                 } else {
                    // If pinning, find the section it's inside
                    const parent = findParentSection(template.sections, currentQuestion.position.x, currentQuestion.position.y, 300, 80);
                    newSectionId = parent?.id || null;
                 }
                
                const updatedQuestion = { ...currentQuestion, sectionId: newSectionId };

                const newSections = template.sections.map(s => {
                    const newQuestions = s.questions.map(q => q.id === question.id ? updatedQuestion : q);
                    return {...s, questions: newQuestions };
                });
                
                onTemplateChange({ ...template, sections: newSections });
            }
          },
          selected: question.id === selectedQuestionId,
          zIndex: 2,
        });
      });

    return nodes;
  }, [template, onTemplateChange, selectedQuestionId, selectedSectionId, allQuestions, onDeleteQuestion]);
  
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
            s.id === node.id ? { ...s, position: node.position, width: node.width, height: node.height } : s
        );
        onTemplateChange({ ...template, sections: newSections });
        return;
    }

    if (node.type === 'question') {
        const questionId = node.id;
        let currentQuestion = allQuestions.find(q => q.id === questionId);
        if (!currentQuestion) return;

        let absolutePosition = { ...node.position };

        // Calculate absolute position if it's a child node
        if (node.parentNode) {
            const parentNode = nodes.find(n => n.id === node.parentNode);
            if (parentNode) {
                absolutePosition = {
                    x: parentNode.position.x + node.position.x,
                    y: parentNode.position.y + node.position.y
                };
            }
        }
        
        // Find which section it's inside now
        const parentSection = findParentSection(template.sections, absolutePosition.x, absolutePosition.y, node.width!, node.height!);
        const newSectionId = parentSection ? parentSection.id : currentQuestion.sectionId; // Keep old section if dropped outside

        let newSections = [...template.sections];

        // If the section has changed, update the structure
        if (currentQuestion.sectionId !== newSectionId) {
            // Remove from old section
            newSections = newSections.map(s => ({
                ...s,
                questions: s.questions.filter(q => q.id !== questionId)
            }));
            
            // Add to new section
            const newSectionIndex = newSections.findIndex(s => s.id === newSectionId);
            if (newSectionIndex !== -1) {
                newSections[newSectionIndex].questions.push({ ...currentQuestion, sectionId: newSectionId });
            }
        }

        // Always update the position
        newSections = newSections.map(s => ({
            ...s,
            questions: s.questions.map(q => 
                q.id === questionId ? { ...q, position: absolutePosition, sectionId: newSectionId } : q
            )
        }));

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
    (params: Edge | Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
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
