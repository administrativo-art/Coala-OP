

"use client";

import React, { useCallback, useMemo } from 'react';
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
  NodeResizer,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { type FormTemplate, type FormQuestion } from '@/types';
import { nanoid } from 'nanoid';
import { SectionNode } from './section-node';
import { QuestionNode } from './form-question-node';
import { AddNode } from './add-node';

interface FormBuilderProps {
  template: FormTemplate | Omit<FormTemplate, 'id' | 'status'>;
  onTemplateChange: (template: FormTemplate | Omit<FormTemplate, 'id' | 'status'>) => void;
}

const nodeTypes = {
  section: SectionNode,
  question: QuestionNode,
  add: AddNode,
};

export function FormBuilder({ template, onTemplateChange }: FormBuilderProps) {

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
        });
      });
      
       nodes.push({
        id: `add-question-${section.id}`,
        type: 'add',
        position: { x: 20, y: section.height ? section.height - 80 : 120 },
        data: {
            label: "Adicionar Pergunta",
            type: 'card',
            parentId: section.id,
            onAdd: () => { /* This is handled by a different mechanism now */ }
        },
        parentNode: section.id,
        extent: 'parent'
      });
    });

    nodes.push({
        id: `add-section-button`,
        type: 'add',
        position: { x: (template.sections.length * 450) + 50, y: 100 },
        data: {
            label: "Adicionar Momento",
            type: 'section',
            onAdd: () => { /* This is handled by a different mechanism now */ }
        },
        className: '!w-52 !h-16'
    });
    
    return nodes;
  }, [template, onTemplateChange]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

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
