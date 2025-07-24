

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
  ReactFlowProvider,
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

  const onNodeDragStop = (_: any, node: Node) => {
    if (node.type === 'section') {
        const newSections = template.sections.map(s => {
            if (s.id === node.id) {
                return { ...s, position: node.position };
            }
            return s;
        });
        onTemplateChange({ ...template, sections: newSections });
    } else if (node.type === 'question' && node.parentNode) {
        const newSections = template.sections.map(section => {
            if (section.id === node.parentNode) {
                const newQuestions = section.questions.map(q => {
                    if (q.id === node.id) {
                        return { ...q, position: node.position };
                    }
                    return q;
                });
                return { ...section, questions: newQuestions };
            }
            return section;
        });
        onTemplateChange({ ...template, sections: newSections });
    }
  };

  const handleNodeClick = (_: any, node: Node) => {
    if (node.type === 'section') {
        onSelectSection(node.id);
        onSelectQuestion(null);
    } else if (node.type === 'question') {
        onSelectSection(node.parentNode || null);
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
            backgroundColor: section.color ? `${section.color}20` : 'hsl(var(--card))',
            borderColor: section.color,
        },
        selected: section.id === selectedSectionId,
      });

      (section.questions || []).forEach(question => {
        nodes.push({
          id: question.id,
          type: 'question',
          position: question.position || { x: 50, y: 50 },
          data: {
            label: question.label,
            description: question.description,
          },
          parentNode: section.id,
          extent: 'parent',
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
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
