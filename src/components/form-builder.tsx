
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
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

interface FormBuilderProps {
  initialTemplate: FormTemplate | Omit<FormTemplate, 'id' | 'status'>;
  onTemplateChange: (template: FormTemplate | Omit<FormTemplate, 'id'>) => void;
  onNodeSelect: (nodeId: string | null) => void;
  selectedNodeId: string | null;
}

const SECTION_WIDTH = 400;
const SECTION_GAP = 50;
const DEFAULT_SECTION_HEIGHT = 600;
const CARD_HEIGHT = 80;
const CARD_VERTICAL_GAP = 20;

export function FormBuilder({ initialTemplate, onTemplateChange, onNodeSelect, selectedNodeId }: FormBuilderProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [sectionToDelete, setSectionToDelete] = useState<string | null>(null);

  const nodeTypes: NodeTypes = useMemo(() => ({
    section: SectionNode,
    question: QuestionNode,
    add_node: AddNode,
  }), []);

  const handleAddNode = (type: 'section' | 'card', parentId?: string) => {
    let newTemplate = JSON.parse(JSON.stringify(initialTemplate));
    
    if (type === 'section') {
      const lastSection = newTemplate.sections[newTemplate.sections.length - 1];
      const newX = lastSection ? lastSection.position.x + (lastSection.width || SECTION_WIDTH) + SECTION_GAP : 0;
      
      newTemplate.sections.push({
        id: `section-${nanoid()}`,
        name: `Momento ${newTemplate.sections.length + 1}`,
        questions: [],
        position: { x: newX, y: 0 },
        width: SECTION_WIDTH,
        height: DEFAULT_SECTION_HEIGHT,
        color: '#FEE2E2',
      });
    } else if (type === 'card' && parentId) {
      const section = newTemplate.sections.find((s: any) => s.id === parentId);
      if (section) {
        const lastQuestionY = section.questions.length > 0 ? section.questions[section.questions.length - 1].position.y : 60;

        section.questions.push({
          id: `question-${nanoid()}`,
          label: 'Nova Pergunta',
          type: 'text',
          isRequired: false,
          position: { x: 20, y: lastQuestionY + CARD_HEIGHT + CARD_VERTICAL_GAP },
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

  const handleDeleteSection = () => {
    if (!sectionToDelete) return;

    let newTemplate = JSON.parse(JSON.stringify(initialTemplate));
    newTemplate.sections = newTemplate.sections.filter((s: FormSection) => s.id !== sectionToDelete);
    onTemplateChange(newTemplate);
    setSectionToDelete(null);
  };


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
      const sectionWidth = section.width || SECTION_WIDTH;
      const sectionHeight = section.height || DEFAULT_SECTION_HEIGHT;
      
      newNodes.push({
        id: section.id,
        type: 'section',
        data: { 
            label: section.name,
            color: section.color,
            onUpdate: (updates: Partial<FormSection>) => handleSectionUpdate(section.id, updates),
            onDelete: () => setSectionToDelete(section.id),
        },
        position: section.position,
        style: { width: sectionWidth, height: sectionHeight },
        zIndex: 1,
      });

      section.questions.forEach((question, index) => {
        newNodes.push({
          id: question.id,
          type: 'question',
          data: { label: question.label, description: question.description },
          position: question.position,
          parentId: section.id,
          extent: 'parent',
          draggable: true,
          zIndex: 10,
        });

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
      
      const lastQuestionY = section.questions.length > 0 ? section.questions[section.questions.length - 1].position.y : 60;
      newNodes.push({
          id: `add-card-${section.id}`,
          type: 'add_node',
          data: { label: 'Adicionar Card', type: 'card', parentId: section.id, onAdd: handleAddNode },
          position: { x: 20, y: lastQuestionY + CARD_HEIGHT + CARD_VERTICAL_GAP },
          parentId: section.id,
          zIndex: 10,
          draggable: false,
      });
      
      currentX = section.position.x + sectionWidth + SECTION_GAP;
    });

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
        if (node.type === 'question' || node.type === 'section') {
          node.selected = node.id === selectedNodeId;
        }
        return node;
      })
    );
  }, [selectedNodeId]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
        setNodes((nds) => applyNodeChanges(changes, nds));
        
        let templateNeedsUpdate = false;
        let newTemplate = JSON.parse(JSON.stringify(initialTemplate));
        
        changes.forEach(change => {
            if (change.type === 'position' && change.dragging === false && change.position) {
                const { id, position } = change;
                for (const section of newTemplate.sections) {
                    if (section.id === id) {
                        section.position = position;
                        templateNeedsUpdate = true;
                        break;
                    }
                    const questionIndex = section.questions.findIndex((q:any) => q.id === id);
                    if (questionIndex > -1) {
                        section.questions[questionIndex].position = position;
                        templateNeedsUpdate = true;
                        break;
                    }
                }
            } else if (change.type === 'dimensions' && change.resizing === false && change.dimensions) {
                const { id, dimensions } = change;
                const sectionIndex = newTemplate.sections.findIndex((s: any) => s.id === id);
                if (sectionIndex > -1) {
                    newTemplate.sections[sectionIndex].width = dimensions.width;
                    newTemplate.sections[sectionIndex].height = dimensions.height;
                    templateNeedsUpdate = true;
                }
            }
        });
        
        if (templateNeedsUpdate) {
            onTemplateChange(newTemplate);
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
    if (node.type === 'question' || node.type === 'section') {
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
      
      <DeleteConfirmationDialog 
        open={!!sectionToDelete}
        onOpenChange={() => setSectionToDelete(null)}
        onConfirm={handleDeleteSection}
        title="Excluir Momento?"
        description="Esta ação é irreversível e excluirá o momento e todas as perguntas contidas nele."
      />
    </div>
  );
}
