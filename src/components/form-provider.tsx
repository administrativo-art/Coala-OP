
"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type FormTemplate, type FormSubmission } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch } from 'firebase/firestore';

export interface FormContextType {
  templates: FormTemplate[];
  submissions: FormSubmission[];
  loading: boolean;
  addTemplate: (template: Omit<FormTemplate, 'id'>) => Promise<void>;
  updateTemplate: (template: FormTemplate) => Promise<void>;
  deleteTemplate: (templateId: string) => Promise<void>;
  addSubmission: (submission: Omit<FormSubmission, 'id'>) => Promise<void>;
}

export const FormContext = createContext<FormContextType | undefined>(undefined);

export function FormProvider({ children }: { children: React.ReactNode }) {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const qTemplates = query(collection(db, "formTemplates"));
    const unsubscribeTemplates = onSnapshot(qTemplates, async (querySnapshot) => {
      
      if (querySnapshot.empty && !localStorage.getItem('formTemplates_seeded')) {
        console.log("No form templates found. Seeding test template...");
        
        const testTemplate: Omit<FormTemplate, 'id'> = {
            name: "Formulário de Teste de Ramificação",
            sections: [
                {
                    id: 'section1-' + new Date().toISOString() + Math.random(),
                    name: "Testes de Ramificação",
                    questions: [
                        {
                            id: 'q-yes-no-' + new Date().toISOString() + Math.random(),
                            label: "Teste Sim/Não: Você precisa de ajuda?",
                            type: "yes-no",
                            options: [
                                { id: 'opt-yes-' + new Date().toISOString() + Math.random(), value: "Sim", subQuestions: [ { id: 'subq-yes-' + new Date().toISOString() + Math.random(), label: "Descreva o problema:", type: "text", options: [] } ] },
                                { id: 'opt-no-' + new Date().toISOString() + Math.random(), value: "Não", subQuestions: [] }
                            ]
                        },
                        {
                            id: 'q-single-' + new Date().toISOString() + Math.random(),
                            label: "Teste Escolha Única: Qual seu departamento?",
                            type: "single-choice",
                            options: [
                                { id: 'opt-sc1-' + new Date().toISOString() + Math.random(), value: "Vendas", subQuestions: [] },
                                { id: 'opt-sc2-' + new Date().toISOString() + Math.random(), value: "Engenharia", subQuestions: [ { id: 'subq-eng-' + new Date().toISOString() + Math.random(), label: "Quantos anos de experiência?", type: "number", options: [] } ] },
                                { id: 'opt-sc3-' + new Date().toISOString() + Math.random(), value: "Marketing", subQuestions: [] },
                            ]
                        },
                        {
                            id: 'q-multi-' + new Date().toISOString() + Math.random(),
                            label: "Teste Múltipla Escolha: Quais tecnologias você usa?",
                            type: "multiple-choice",
                            options: [
                                { id: 'opt-mc1-' + new Date().toISOString() + Math.random(), value: "React", subQuestions: [ { id: 'subq-react-' + new Date().toISOString() + Math.random(), label: "Qual state manager prefere com React?", type: "text", options: [] } ] },
                                { id: 'opt-mc2-' + new Date().toISOString() + Math.random(), value: "Vue", subQuestions: [] },
                                { id: 'opt-mc3-' + new Date().toISOString() + Math.random(), value: "Node.js", subQuestions: [ { id: 'subq-node-' + new Date().toISOString() + Math.random(), label: "Qual framework Node.js você mais usa?", type: "single-choice", options: [
                                    { id: 'subq-node-opt1-' + new Date().toISOString() + Math.random(), value: "Express", subQuestions: [] },
                                    { id: 'subq-node-opt2-' + new Date().toISOString() + Math.random(), value: "Fastify", subQuestions: [] },
                                    { id: 'subq-node-opt3-' + new Date().toISOString() + Math.random(), value: "NestJS", subQuestions: [] },
                                ] } ] }
                            ]
                        }
                    ]
                }
            ]
        };
        
        try {
            await addDoc(collection(db, "formTemplates"), testTemplate);
            localStorage.setItem('formTemplates_seeded', 'true');
        } catch (seedError) {
            console.error("Error seeding form template:", seedError);
        }
        return;
      }

      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FormTemplate));
      setTemplates(data);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching form templates from Firestore: ", error);
      setLoading(false);
    });

    const qSubmissions = query(collection(db, "formSubmissions"));
    const unsubscribeSubmissions = onSnapshot(qSubmissions, (querySnapshot) => {
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FormSubmission));
      setSubmissions(data.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    }, (error) => {
      console.error("Error fetching form submissions from Firestore: ", error);
    });

    return () => {
      unsubscribeTemplates();
      unsubscribeSubmissions();
    };
  }, []);

  const addTemplate = useCallback(async (template: Omit<FormTemplate, 'id'>) => {
    try {
      await addDoc(collection(db, "formTemplates"), template);
    } catch (error) {
      console.error("Error adding template:", error);
    }
  }, []);

  const updateTemplate = useCallback(async (template: FormTemplate) => {
    const templateRef = doc(db, "formTemplates", template.id);
    const { id, ...dataToUpdate } = template;
    try {
      await updateDoc(templateRef, dataToUpdate);
    } catch (error) {
      console.error("Error updating template:", error);
    }
  }, []);

  const deleteTemplate = useCallback(async (templateId: string) => {
    try {
      await deleteDoc(doc(db, "formTemplates", templateId));
    } catch (error) {
      console.error("Error deleting template:", error);
    }
  }, []);
  
  const addSubmission = useCallback(async (submission: Omit<FormSubmission, 'id'>) => {
    try {
      await addDoc(collection(db, "formSubmissions"), submission);
    } catch (error) {
      console.error("Error adding submission:", error);
    }
  }, []);

  const value: FormContextType = {
    templates,
    submissions,
    loading,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    addSubmission,
  };

  return <FormContext.Provider value={value}>{children}</FormContext.Provider>;
}
