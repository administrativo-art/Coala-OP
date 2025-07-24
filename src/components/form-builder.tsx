

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
} from 'reactflow';
import 'reactflow/dist/style.css';
import { type FormTemplate, type FormQuestion, type FormSection } from '@/types';
import { SectionNode } from './section-node';
import { QuestionNode } from './form-question-node';

interface FormBuilderProps {
  template: FormTemplate | Omit<FormTemplate, 'id' | 'status'>;
  onTemplateChange: (template: FormTemplate | Omit<FormTemplate, 'id' | 'status'>) => void;
  onSelectQuestion: (questionId: string | null) => void;
  selectedQuestionId: string | null;
  onSelectSection: (sectionId: string | null) => void;
  selectedSectionId: string | null;
}

const nodeTypes = {
  section: SectionNode,
  question: QuestionNode,
};

// Helper function to find which section a point is inside
const findParentSection = (sections: FormSection[], x: number, y: number, width: number, height: number): FormSection | undefined => {
    return sections.find(sec => {
        const secX = sec.position.x;
        const secY = sec.position.y;
        const secWidth = sec.width || 400;
        const secHeight = sec.height || 200;
        // Check if the center of the question is inside the section
        return x + width / 2 >= secX && x + width / 2 <= secX + secWidth &&
               y + height / 2 >= secY && y + height / 2 <= secY + secHeight;
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
  
  const initialNodes = useMemo(() => {
    const nodes: Node[] = [];
    const allQuestions = template.sections.flatMap(s => s.questions || []);

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
                 
                 // If unpinning, sectionId becomes null
                 // If pinning, find which section it's inside
                 if (!currentQuestion.sectionId) {
                    const parent = findParentSection(template.sections, currentQuestion.position.x, currentQuestion.position.y, 300, 80);
                    newSectionId = parent?.id || null;
                 }
                
                const updatedQuestion = { ...currentQuestion, sectionId: newSectionId };
                const newSections = template.sections.map(s => ({
                    ...s,
                    questions: s.questions.map(q => q.id === question.id ? updatedQuestion : q)
                }));
                onTemplateChange({ ...template, sections: newSections });
            }
          },
          selected: question.id === selectedQuestionId,
          zIndex: 2,
        });
      });

    return nodes;
  }, [template, onTemplateChange, selectedQuestionId, selectedSectionId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);


  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'section') {
        const newSections = template.sections.map(s => 
            s.id === node.id ? { ...s, position: node.position } : s
        );
        onTemplateChange({ ...template, sections: newSections });
        return;
    }

    if (node.type === 'question') {
        const questionId = node.id;
        const allQuestions = template.sections.flatMap(s => s.questions || []);
        const questionData = allQuestions.find(q => q.id === questionId);
        
        if (!questionData) return;

        let absolutePosition = node.position;
        // If node was child, its position is relative. Calculate absolute.
        if (questionData.sectionId) {
            const parentSection = template.sections.find(s => s.id === questionData.sectionId);
            if (parentSection) {
                 absolutePosition = {
                    x: parentSection.position.x + node.position.x,
                    y: parentSection.position.y + node.position.y,
                };
            }
        }
        
        // Always update the absolute position
        const updatedQuestionData = { ...questionData, position: absolutePosition };
        
        const newSections = template.sections.map(s => ({
            ...s,
            questions: s.questions.map(q => q.id === questionId ? updatedQuestionData : q)
        }));

        onTemplateChange({ ...template, sections: newSections });
    }
}, [template, onTemplateChange]);

  const handleNodeClick = (_: any, node: Node) => {
    if (node.type === 'section') {
        onSelectSection(node.id);
        onSelectQuestion(null);
    } else if (node.type === 'question') {
        const allQuestions = template.sections.flatMap(s => s.questions);
        const question = allQuestions.find(q => q.id === node.id);
        onSelectSection(question?.sectionId || null);
        onSelectQuestion(node.id);
    }
  };

  const onConnect = useCallback(
    (params: Edge | Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );
  
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
        fitView
        nodeDragThreshold={5}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
