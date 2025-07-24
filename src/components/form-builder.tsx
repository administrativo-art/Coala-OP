

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
  useReactFlow,
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

export function FormBuilder({ 
  template, 
  onTemplateChange,
  onSelectQuestion,
  selectedQuestionId,
  onSelectSection,
  selectedSectionId,
}: FormBuilderProps) {

  const onNodeDragStop = (_: React.MouseEvent, node: Node) => {
    let newSections = [...template.sections];
    
    // Handle dragging a SECTION node
    if (node.type === 'section') {
        newSections = newSections.map(s => 
            s.id === node.id ? { ...s, position: node.position } : s
        );
        onTemplateChange({ ...template, sections: newSections });
        return;
    } 
    
    // Handle dragging a QUESTION node
    if (node.type === 'question') {
        const questionId = node.id;
        
        let originalSectionId: string | null = null;
        let questionData: FormQuestion | null = null;

        // Find the question and its original section
        for (const sec of newSections) {
            const qIndex = sec.questions.findIndex(q => q.id === questionId);
            if (qIndex !== -1) {
                originalSectionId = sec.id;
                questionData = sec.questions[qIndex];
                break;
            }
        }
        
        if (!questionData || !originalSectionId) return;
        
        const parentSectionNode = template.sections.find(s => s.id === originalSectionId);
        if (!parentSectionNode) return;

        // The node's position is relative to its parent. We need absolute position to find the new parent.
        const absolutePosition = {
            x: parentSectionNode.position.x + node.position.x,
            y: parentSectionNode.position.y + node.position.y,
        };

        const questionWidth = node.width || 300;
        const questionHeight = node.height || 80;
        const questionCenterX = absolutePosition.x + questionWidth / 2;
        const questionCenterY = absolutePosition.y + questionHeight / 2;
        
        // Find the new parent section based on where the node was dropped
        const newParentSection = newSections.find(sec =>
            questionCenterX >= sec.position.x &&
            questionCenterX <= sec.position.x + (sec.width || 400) &&
            questionCenterY >= sec.position.y &&
            questionCenterY <= sec.position.y + (sec.height || 200)
        );

        if (newParentSection && newParentSection.id !== originalSectionId) {
            // Recalculate position relative to the new parent
            const updatedQuestionData = {
                ...questionData,
                position: {
                    x: absolutePosition.x - newParentSection.position.x,
                    y: absolutePosition.y - newParentSection.position.y,
                },
            };
            
            // Remove from old section
            newSections = newSections.map(sec => {
                if (sec.id === originalSectionId) {
                    return { ...sec, questions: sec.questions.filter(q => q.id !== questionId) };
                }
                return sec;
            });

            // Add to new section
            newSections = newSections.map(sec => {
                if (sec.id === newParentSection.id) {
                    return { ...sec, questions: [...sec.questions, updatedQuestionData] };
                }
                return sec;
            });
             onTemplateChange({ ...template, sections: newSections });
        } else {
             // If it stayed in the same section, just update its relative position
             newSections = newSections.map(sec => {
                if (sec.id === originalSectionId) {
                     return { ...sec, questions: sec.questions.map(q => q.id === questionId ? {...q, position: node.position } : q) };
                }
                return sec;
            });
            onTemplateChange({ ...template, sections: newSections });
        }
    }
  };


  const handleNodeClick = (_: any, node: Node) => {
    if (node.type === 'section') {
        onSelectSection(node.id);
        onSelectQuestion(null);
    } else if (node.type === 'question') {
        // Find parent section to also highlight it
        const parent = template.sections.find(s => s.questions.some(q => q.id === node.id));
        onSelectSection(parent?.id || null);
        onSelectQuestion(node.id);
    }
  };

  const initialNodes = useMemo(() => {
    const nodes: Node[] = [];
    (template.sections || []).forEach(section => {
      nodes.push({
        id: section.id,
        type: 'section',
        position: section.position || { x: Math.random() * 200, y: Math.random() * 200 },
        data: {
          label: section.name,
          color: section.color,
          onUpdate: (updates: Partial<FormTemplate['sections'][0]>) => {
              const newSections = template.sections.map(s => s.id === section.id ? { ...s, ...updates } : s);
              onTemplateChange({ ...template, sections: newSections });
          },
          onDelete: () => {
              const newSections = template.sections.filter(s => s.id !== section.id);
              onTemplateChange({ ...template, sections: newSections });
          },
        },
        style: { 
            width: section.width || 400, 
            height: section.height || 200,
        },
        selected: section.id === selectedSectionId,
      });

      (section.questions || []).forEach(question => {
        nodes.push({
          id: question.id,
          type: 'question',
          position: question.position || { x: 50, y: 50 },
          parentNode: section.id,
          extent: 'parent',
          data: {
            label: question.label,
            description: question.description,
          },
          selected: question.id === selectedQuestionId,
        });
      });
    });
    
    return nodes;
  }, [template, onTemplateChange, selectedQuestionId, selectedSectionId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);


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
