

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
            onPinToggle: () => {
                 const currentQuestion = allQuestions.find(q => q.id === question.id)!;
                 let newSectionId: string | null = null;
                 
                 if (!currentQuestion.sectionId) {
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
  }, [template, onTemplateChange, selectedQuestionId, selectedSectionId, allQuestions]);
  
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
        const currentQuestion = allQuestions.find(q => q.id === questionId);
        
        if (!currentQuestion) return;

        let absolutePosition = node.position;
        if (currentQuestion.sectionId && node.parentNode) {
            const parentSection = template.sections.find(s => s.id === node.parentNode);
            if (parentSection) {
                 absolutePosition = {
                    x: parentSection.position.x + node.position.x,
                    y: parentSection.position.y + node.position.y,
                };
            }
        }
        
        const parentSection = findParentSection(template.sections, absolutePosition.x, absolutePosition.y, node.width!, node.height!);
        const newSectionId = parentSection ? parentSection.id : currentQuestion.sectionId;

        const updatedQuestionData = { 
            ...currentQuestion,
            position: absolutePosition, 
            sectionId: newSectionId, 
        };
        
        const newSections = template.sections.map(s => ({
            ...s,
            questions: s.questions
                .filter(q => q.id !== questionId) // Remove from all sections
                .concat(s.id === newSectionId ? [updatedQuestionData] : []) // Add to the correct one
        }));

        onTemplateChange({ ...template, sections: newSections });
    }
  }, [template, onTemplateChange, allQuestions]);


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
