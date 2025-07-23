
"use client";

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
  OnNodesDelete,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { type FormTemplate, type FormQuestion, type FormSection } from '@/types';
import { SectionNode } from './section-node';
import { QuestionNode } from './form-question-node';
import { nanoid } from 'nanoid';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Trash2 } from 'lucide-react';

interface FormBuilderProps {
  initialTemplate: FormTemplate | Omit<FormTemplate, 'id' | 'status'>;
  onTemplateChange: (template: FormTemplate | Omit<FormTemplate, 'id'>) => void;
  onNodeSelect: (nodeId: string | null) => void;
  selectedNodeId: string | null;
}

const SECTION_WIDTH = 400;
const SECTION_GAP = 50;
const DEFAULT_SECTION_HEIGHT = 600;

export function FormBuilder({ initialTemplate, onTemplateChange, onNodeSelect, selectedNodeId }: FormBuilderProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [sectionToDelete, setSectionToDelete] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const deleteZoneRef = useRef<HTMLDivElement>(null);

  const nodeTypes: NodeTypes = useMemo(() => ({
    section: SectionNode,
    question: QuestionNode,
  }), []);
  
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
    
    initialTemplate.sections.forEach((section) => {
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
        style: { width: section.width || SECTION_WIDTH, height: section.height || DEFAULT_SECTION_HEIGHT },
        zIndex: 1,
        selectable: true,
        resizable: true,
      });

      section.questions.forEach((question) => {
        newNodes.push({
          id: question.id,
          type: 'question',
          data: { label: question.label, description: question.description },
          position: question.position,
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
            if (change.type === 'dimensions' && !change.resizing && change.dimensions) {
                const sectionIndex = newTemplate.sections.findIndex((s: any) => s.id === change.id);
                if (sectionIndex > -1) {
                    newTemplate.sections[sectionIndex].width = change.dimensions.width;
                    newTemplate.sections[sectionIndex].height = change.dimensions.height;
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
  
  const onNodesDelete: OnNodesDelete = useCallback((deletedNodes) => {
    let newTemplate = JSON.parse(JSON.stringify(initialTemplate));
    
    deletedNodes.forEach(node => {
      newTemplate.sections.forEach((section: FormSection) => {
        section.questions = section.questions.filter(q => q.id !== node.id);
      });
    });

    onTemplateChange(newTemplate);
  }, [initialTemplate, onTemplateChange]);


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

  const onNodeDragStart: OnNodeClick = useCallback((_, node) => {
    if (node.type === 'question') {
        setIsDragging(true);
    }
  }, []);

  const onNodeDragStop: OnNodeClick = useCallback((event: React.MouseEvent, node) => {
    setIsDragging(false);

    if (deleteZoneRef.current && node.type === 'question') {
        const deleteZoneBounds = deleteZoneRef.current.getBoundingClientRect();
        if (
            event.clientX >= deleteZoneBounds.left &&
            event.clientX <= deleteZoneBounds.right &&
            event.clientY >= deleteZoneBounds.top &&
            event.clientY <= deleteZoneBounds.bottom
        ) {
            let newTemplate = JSON.parse(JSON.stringify(initialTemplate));
            newTemplate.sections.forEach((section: FormSection) => {
                section.questions = section.questions.filter(q => q.id !== node.id);
            });
            onTemplateChange(newTemplate);
            return;
        }
    }

    let newTemplate = JSON.parse(JSON.stringify(initialTemplate));
    let templateNeedsUpdate = false;
    
    if (node.type === 'section') {
        const sectionIndex = newTemplate.sections.findIndex((s:any) => s.id === node.id);
        if (sectionIndex > -1) {
            newTemplate.sections[sectionIndex].position = node.position;
            templateNeedsUpdate = true;
        }
    } else if (node.type === 'question') {
        for (const section of newTemplate.sections) {
            const questionIndex = section.questions.findIndex((q: any) => q.id === node.id);
            if (questionIndex > -1) {
                section.questions[questionIndex].position = node.position;
                templateNeedsUpdate = true;
                break;
            }
        }
    }
    
    if (templateNeedsUpdate) {
        onTemplateChange(newTemplate);
    }

  }, [initialTemplate, onTemplateChange]);


  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodesDelete={onNodesDelete}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        className="bg-muted/50"
      >
        <Controls />
        <Background />
      </ReactFlow>
      
      {isDragging && (
          <div ref={deleteZoneRef} className="absolute bottom-5 right-5 z-20 flex h-24 w-48 flex-col items-center justify-center rounded-lg border-2 border-dashed border-destructive bg-destructive/10 text-destructive transition-colors pointer-events-none">
            <Trash2 className="h-8 w-8" />
            <p className="mt-1 text-sm font-medium">Arraste aqui para excluir</p>
          </div>
      )}
      
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
