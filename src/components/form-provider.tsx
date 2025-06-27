
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
    const unsubscribeTemplates = onSnapshot(qTemplates, (querySnapshot) => {
      if (querySnapshot.empty && !localStorage.getItem('form_templates_seeded')) {
        console.log("No form templates found. Seeding default template...");
        const defaultTemplate: Omit<FormTemplate, 'id'> = {
          name: 'Formulário de abertura de quiosque',
          questions: [
            { id: '1', label: 'O quiosque está limpo e organizado?', type: 'yes-no', condition: null },
            { id: '2', label: 'Se não, descreva o problema:', type: 'text', condition: { questionId: '1', value: 'Não' } },
            { id: '3', label: 'Qual o turno?', type: 'single-choice', options: ['Manhã', 'Tarde', 'Noite'], condition: null },
            { id: '4', label: 'Todos os equipamentos estão funcionando?', type: 'yes-no', condition: null },
            { id: '5', label: 'Qual a temperatura do freezer?', type: 'number', condition: null },
          ]
        };
        addDoc(collection(db, "formTemplates"), defaultTemplate)
          .then(() => localStorage.setItem('form_templates_seeded', 'true'))
          .catch(err => console.error("Error seeding form template:", err));
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
