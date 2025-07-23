
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
  type OnNodeClick,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { type FormTemplate, type FormQuestion, type FormSection } from '@/types';
import { SectionNode } from './section-node';
import { QuestionNode } from './form-question-node';
import { AddNode } from './add-node';
import { nanoid } from 'nanoid';

interface FormBuilderProps {
  initialTemplate: FormTemplate | Omit<FormTemplate, 'id' | 'status'>;
  onTemplateChange: (template: FormTemplate | Omit<FormTemplate, 'id'>) => void;
  onNodeSelect: (nodeId: string | null) => void;
  selectedNodeId: string | null;
}

const SECTION_WIDTH = 400;
const SECTION_GAP = 50;

export function FormBuilder({ initialTemplate, onTemplateChange, onNodeSelect, selectedNodeId }: FormBuilderProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const nodeTypes: NodeTypes = useMemo(() => ({
    section: SectionNode,
    question: QuestionNode,
    add_node: AddNode,
  }), []);

  const handleAddNode = (type: 'section' | 'card', parentId?: string) => {
    let newTemplate = JSON.parse(JSON.stringify(initialTemplate));
    
    if (type === 'section') {
      const lastSection = newTemplate.sections[newTemplate.sections.length - 1];
      const newX = lastSection ? lastSection.position.x + SECTION_WIDTH + SECTION_GAP : 0;
      
      newTemplate.sections.push({
        id: `section-${nanoid()}`,
        name: `Momento ${newTemplate.sections.length + 1}`,
        questions: [],
        position: { x: newX, y: 0 },
        color: '#FEE2E2',
      });
    } else if (type === 'card' && parentId) {
      const section = newTemplate.sections.find((s: any) => s.id === parentId);
      if (section) {
        const yOffset = (section.questions.length % 5) * 100;
        const xOffset = Math.floor(section.questions.length / 5) * 150;
        section.questions.push({
          id: `question-${nanoid()}`,
          label: 'Nova Pergunta',
          type: 'text',
          isRequired: false,
          position: { x: section.position.x + 20 + xOffset, y: 80 + yOffset },
        });
      }
    }
    
    onTemplateChange(newTemplate);
  };
  
  const handleSectionUpdate = (sectionId: string, updates: Partial<FormSection>) => {
    let newTemplate = JSON.parse(JSON.stringify(initialTemplate));
    const sectionIndex = newTemplate.sections.findIndex((s: any) => s.id === sectionId);
    if(sectionIndex > -1) {
        newTemplate.sections[sectionIndex] = { ...newTemplate.sections[sectionIndex], ...updates };
        onTemplateChange(newTemplate);
    }
  }


  useEffect(() => {
    if (!initialTemplate || !initialTemplate.sections) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    let currentX = 0;

    initialTemplate.sections.forEach((section) => {
      // Add Section Node
      newNodes.push({
        id: section.id,
        type: 'section',
        data: { 
            label: section.name,
            color: section.color,
            onUpdate: (updates: Partial<FormSection>) => handleSectionUpdate(section.id, updates),
        },
        position: section.position,
        draggable: false,
        style: { width: SECTION_WIDTH, height: 'auto', minHeight: '600px' },
        zIndex: 1, // Ensure sections are in the background
      });

      // Add Question Nodes for the section
      const questionCount = section.questions.length;
      const addNodeHeight = 60;
      const sectionHeight = Math.max(600, (questionCount * 100) + addNodeHeight);
      
      const updatedSectionNode = newNodes.find(n => n.id === section.id);
      if(updatedSectionNode) {
          updatedSectionNode.style = { ...updatedSectionNode.style, height: `${sectionHeight}px` };
      }


      section.questions.forEach((question, index) => {
        newNodes.push({
          id: question.id,
          type: 'question',
          data: { label: question.label, description: question.description },
          position: question.position,
          draggable: true,
          zIndex: 10, // Ensure questions are on top
        });

        // Add edges for ramifications
        question.ramifications?.forEach(ramification => {
          if (ramification.action === 'show_question' && ramification.targetQuestionId) {
            newEdges.push({
              id: `e-${question.id}-${ramification.targetQuestionId}-${ramification.id}`,
              source: question.id,
              target: ramification.targetQuestionId,
              type: 'smoothstep',
              markerEnd: { type: MarkerType.ArrowClosed },
              label: ramification.conditions[0]?.value || 'next',
              zIndex: 5,
            });
          }
        });
      });

      // Add the "Add Card" node at the end of the section
      newNodes.push({
        id: `add-card-${section.id}`,
        type: 'add_node',
        data: { label: 'Adicionar Card', type: 'card', parentId: section.id, onAdd: handleAddNode },
        position: { x: section.position.x, y: section.position.y + sectionHeight - addNodeHeight - 10 },
        zIndex: 2, // Above section, below questions
      });
      
      currentX = section.position.x + SECTION_WIDTH + SECTION_GAP;
    });

    // Add the "Add Section" node at the end
    newNodes.push({
      id: 'add-section-node',
      type: 'add_node',
      data: { label: 'Adicionar Momento', type: 'section', onAdd: handleAddNode },
      position: { x: currentX, y: 0 },
      draggable: false,
      zIndex: 1
    });
    
    setNodes(newNodes);
    setEdges(newEdges);
  }, [initialTemplate]);

  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.type === 'question') {
          node.selected = node.id === selectedNodeId;
        }
        return node;
      })
    );
  }, [selectedNodeId]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
        setNodes((nds) => applyNodeChanges(changes, nds));
        
        const nodePositionChange = changes.find(c => c.type === 'position' && c.dragging === false);
        if (nodePositionChange && 'position' in nodePositionChange && nodePositionChange.position) {
            const { id, position } = nodePositionChange;
            let newTemplate = JSON.parse(JSON.stringify(initialTemplate));
            let questionFound = false;
            for (const section of newTemplate.sections) {
                const questionIndex = section.questions.findIndex((q:any) => q.id === id);
                if (questionIndex > -1) {
                    section.questions[questionIndex].position = position;
                    questionFound = true;
                    break;
                }
            }
            if (questionFound) {
                onTemplateChange(newTemplate);
            }
        }
    },
    [setNodes, initialTemplate, onTemplateChange]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges]
  );
  const onConnect: OnConnect = useCallback(
    (connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );
  
  const onNodeClick: OnNodeClick = useCallback((event, node) => {
    if (node.type === 'question') {
        onNodeSelect(node.id);
    } else {
        onNodeSelect(null);
    }
  }, [onNodeSelect]);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
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
