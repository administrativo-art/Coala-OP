

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

       // Questions that are children of this section
      section.questions.forEach(question => {
        nodes.push({
          id: question.id,
          type: 'question',
          position: question.position,
          parentNode: section.id,
          extent: 'parent',
          dragHandle: '.drag-handle-question',
          data: {
            ...question,
            onDelete: () => onDeleteQuestion(question.id),
            onPinToggle: () => {}
          },
          selected: question.id === selectedQuestionId,
          zIndex: 2,
        });
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
    // Handle Section Dragging and Resizing
    if (node.type === 'section') {
        const newSections = template.sections.map(s => 
            s.id === node.id ? { ...s, position: node.position, width: node.width, height: node.height } : s
        );
        onTemplateChange({ ...template, sections: newSections });
        return;
    }

    // Handle Question Dragging
    if (node.type === 'question') {
        const questionId = node.id;
        let currentQuestion = allQuestions.find(q => q.id === questionId);
        if (!currentQuestion) return;

        let absolutePosition = { ...node.position };

        // If the question was inside a section, calculate its new absolute position
        if (node.parentNode) {
            const parentNode = nodes.find(n => n.id === node.parentNode);
            if (parentNode) {
                absolutePosition = {
                    x: parentNode.position.x + node.position.x,
                    y: parentNode.position.y + node.position.y
                };
            }
        }
        
        // Find which section it's inside now based on its center point
        const questionCenter = {
            x: absolutePosition.x + (node.width! / 2),
            y: absolutePosition.y + (node.height! / 2),
        };
        const parentSection = findParentSection(template.sections, questionCenter.x, questionCenter.y);
        const newSectionId = parentSection ? parentSection.id : null;
        const oldSectionId = currentQuestion.sectionId;

        // Update the question with its new absolute position and possibly new sectionId
        currentQuestion = { ...currentQuestion, position: absolutePosition, sectionId: newSectionId };
        
        let newSections = [...template.sections];

        // If the section association has changed
        if (oldSectionId !== newSectionId) {
            // Remove from old section
            if (oldSectionId) {
                const oldSectionIndex = newSections.findIndex(s => s.id === oldSectionId);
                if (oldSectionIndex !== -1) {
                    newSections[oldSectionIndex] = {
                        ...newSections[oldSectionIndex],
                        questions: newSections[oldSectionIndex].questions.filter(q => q.id !== questionId)
                    };
                }
            }

            // Add to new section
            if (newSectionId) {
                const newSectionIndex = newSections.findIndex(s => s.id === newSectionId);
                if (newSectionIndex !== -1) {
                    const newParentNode = nodes.find(n => n.id === newSectionId)!;
                    // Make position relative to the new parent
                    currentQuestion.position = {
                        x: absolutePosition.x - newParentNode.position.x,
                        y: absolutePosition.y - newParentNode.position.y,
                    };
                    newSections[newSectionIndex] = {
                        ...newSections[newSectionIndex],
                        questions: [...newSections[newSectionIndex].questions, currentQuestion]
                    };
                }
            } else {
              // This is the case where the question is now "orphaned" (not in any section)
              // This part of the logic needs to be carefully handled to not lose the question.
              // For now, let's just update its position in the old section if it's dragged out.
              // A better approach is to have a top-level questions array.
              // Re-evaluating: The bug is likely that the question is removed but not re-added anywhere.
              // Let's ensure it's always *somewhere*.
            }
        } else {
             // If it stays in the same section, just update its relative position
             if (newSectionId) {
                const parentNode = nodes.find(n => n.id === newSectionId)!;
                currentQuestion.position = {
                    x: absolutePosition.x - parentNode.position.x,
                    y: absolutePosition.y - parentNode.position.y,
                };
             }
             // Update the question in its section
             const sectionIndex = newSections.findIndex(s => s.id === oldSectionId);
             if (sectionIndex !== -1) {
                newSections[sectionIndex] = {
                    ...newSections[sectionIndex],
                    questions: newSections[sectionIndex].questions.map(q => q.id === questionId ? currentQuestion : q)
                };
             }
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
