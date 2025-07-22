
"use client";

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import ReactFlow, {
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { type FormTemplate, type FormQuestion } from '@/types';
import { SectionNode } from './section-node';
import { QuestionNode } from './form-question-node';
import { AddNode } from './add-node';

interface FormBuilderProps {
  initialTemplate: FormTemplate | Omit<FormTemplate, 'id'>;
  onTemplateChange: (template: FormTemplate | Omit<FormTemplate, 'id'>) => void;
}

const nodeTypes: NodeTypes = {
  section: SectionNode,
  question: QuestionNode,
  add_node: AddNode,
};

const SECTION_WIDTH = 400;
const SECTION_GAP = 50;
const CARD_HEIGHT = 120;
const CARD_GAP = 20;

export function FormBuilder({ initialTemplate, onTemplateChange }: FormBuilderProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    let currentX = 0;

    initialTemplate.sections.forEach((section, sectionIndex) => {
      // Add Section Node
      newNodes.push({
        id: section.id,
        type: 'section',
        data: { label: section.name },
        position: { x: currentX, y: 0 },
        draggable: false,
        style: { width: SECTION_WIDTH, height: '100%' },
      });

      // Add Question Nodes inside the section
      let currentY = 60; // Initial Y for cards within a section
      section.questions.forEach((question, questionIndex) => {
        newNodes.push({
          id: question.id,
          type: 'question',
          data: { label: question.label },
          position: { x: 20, y: currentY },
          parentId: section.id,
          extent: 'parent',
        });
        currentY += CARD_HEIGHT + CARD_GAP;
      });

      // Add the "Add Card" node at the end of the section
      newNodes.push({
        id: `add-card-${section.id}`,
        type: 'add_node',
        data: { label: 'Adicionar Card', type: 'card', parentId: section.id },
        position: { x: 20, y: currentY },
        parentId: section.id,
        extent: 'parent',
      });
      
      currentX += SECTION_WIDTH + SECTION_GAP;
    });

    // Add the "Add Section" node at the end
    newNodes.push({
      id: 'add-section-node',
      type: 'add_node',
      data: { label: 'Adicionar Momento', type: 'section' },
      position: { x: currentX, y: 0 },
      draggable: false,
    });
    
    setNodes(newNodes);
    setEdges(newEdges);
  }, [initialTemplate]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [setNodes]
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges]
  );
  const onConnect: OnConnect = useCallback(
    (connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        className="bg-muted/50"
      >
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}
