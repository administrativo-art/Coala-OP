
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
  deleteSubmission: (submissionId: string) => Promise<void>;
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
            layout: 'continuous',
            submissionTitleFormat: 'Teste: {q-single}',
            sections: [
                {
                    id: 'section1-' + new Date().toISOString(),
                    name: "Testes de Ramificação",
                    questions: [
                        {
                            id: 'q-yes-no',
                            label: "Teste Sim/Não: Você precisa de ajuda?",
                            type: "yes-no",
                            isRequired: true,
                            options: [
                                { id: 'opt-yes', value: "Sim", subQuestions: [ { id: 'subq-yes', label: "Descreva o problema:", type: "text", isRequired: true, options: [] } ] },
                                { id: 'opt-no', value: "Não", subQuestions: [] }
                            ]
                        },
                        {
                            id: 'q-single',
                            label: "Teste Escolha Única: Qual seu departamento?",
                            type: "single-choice",
                            isRequired: true,
                            options: [
                                { id: 'opt-sc1', value: "Vendas", subQuestions: [] },
                                { id: 'opt-sc2', value: "Engenharia", subQuestions: [ { id: 'subq-eng', label: "Quantos anos de experiência?", type: "number", isRequired: true, options: [] } ] },
                                { id: 'opt-sc3', value: "Marketing", subQuestions: [] },
                            ]
                        },
                        {
                            id: 'q-multi',
                            label: "Teste Múltipla Escolha: Quais tecnologias você usa?",
                            type: "multiple-choice",
                            isRequired: false,
                            options: [
                                { id: 'opt-mc1', value: "React", subQuestions: [ { id: 'subq-react', label: "Qual state manager prefere com React?", type: "text", isRequired: true, options: [] } ] },
                                { id: 'opt-mc2', value: "Vue", subQuestions: [] },
                                { id: 'opt-mc3', value: "Node.js", subQuestions: [ { id: 'subq-node', label: "Qual framework Node.js você mais usa?", type: "single-choice", isRequired: true, options: [
                                    { id: 'subq-node-opt1', value: "Express", subQuestions: [] },
                                    { id: 'subq-node-opt2', value: "Fastify", subQuestions: [] },
                                    { id: 'subq-node-opt3', value: "NestJS", subQuestions: [] },
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
      throw error;
    }
  }, []);
  
  const addSubmission = useCallback(async (submission: Omit<FormSubmission, 'id'>) => {
    try {
      await addDoc(collection(db, "formSubmissions"), submission);
    } catch (error) {
      console.error("Error adding submission:", error);
    }
  }, []);

  const deleteSubmission = useCallback(async (submissionId: string) => {
    try {
        await deleteDoc(doc(db, "formSubmissions", submissionId));
    } catch(error) {
        console.error("Error deleting submission:", error);
        throw error;
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
    deleteSubmission,
  };

  return <FormContext.Provider value={value}>{children}</FormContext.Provider>;
}
