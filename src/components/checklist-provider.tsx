"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type ChecklistTemplate, type ChecklistSubmission } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch } from 'firebase/firestore';

export interface ChecklistContextType {
  templates: ChecklistTemplate[];
  submissions: ChecklistSubmission[];
  loading: boolean;
  addTemplate: (template: Omit<ChecklistTemplate, 'id'>) => Promise<void>;
  updateTemplate: (template: ChecklistTemplate) => Promise<void>;
  deleteTemplate: (templateId: string) => Promise<void>;
  addSubmission: (submission: Omit<ChecklistSubmission, 'id'>) => Promise<void>;
}

export const ChecklistContext = createContext<ChecklistContextType | undefined>(undefined);

export function ChecklistProvider({ children }: { children: React.ReactNode }) {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [submissions, setSubmissions] = useState<ChecklistSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const qTemplates = query(collection(db, "checklistTemplates"));
    const unsubscribeTemplates = onSnapshot(qTemplates, (querySnapshot) => {
      if (querySnapshot.empty && !localStorage.getItem('checklist_templates_seeded')) {
        console.log("No checklist templates found. Seeding default template...");
        const defaultTemplate: Omit<ChecklistTemplate, 'id'> = {
          name: 'Checklist de Abertura de Quiosque',
          questions: [
            { id: '1', label: 'O quiosque está limpo e organizado?', type: 'yes-no', condition: null },
            { id: '2', label: 'Se não, descreva o problema:', type: 'text', condition: { questionId: '1', value: 'Não' } },
            { id: '3', label: 'Todos os equipamentos estão funcionando?', type: 'yes-no', condition: null },
            { id: '4', label: 'Qual a temperatura do freezer?', type: 'number', condition: null },
          ]
        };
        addDoc(collection(db, "checklistTemplates"), defaultTemplate)
          .then(() => localStorage.setItem('checklist_templates_seeded', 'true'))
          .catch(err => console.error("Error seeding checklist template:", err));
        return;
      }
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChecklistTemplate));
      setTemplates(data);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching checklist templates from Firestore: ", error);
      setLoading(false);
    });

    const qSubmissions = query(collection(db, "checklistSubmissions"));
    const unsubscribeSubmissions = onSnapshot(qSubmissions, (querySnapshot) => {
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChecklistSubmission));
      setSubmissions(data);
    }, (error) => {
      console.error("Error fetching checklist submissions from Firestore: ", error);
    });

    return () => {
      unsubscribeTemplates();
      unsubscribeSubmissions();
    };
  }, []);

  const addTemplate = useCallback(async (template: Omit<ChecklistTemplate, 'id'>) => {
    try {
      await addDoc(collection(db, "checklistTemplates"), template);
    } catch (error) {
      console.error("Error adding template:", error);
    }
  }, []);

  const updateTemplate = useCallback(async (template: ChecklistTemplate) => {
    const templateRef = doc(db, "checklistTemplates", template.id);
    const { id, ...dataToUpdate } = template;
    try {
      await updateDoc(templateRef, dataToUpdate);
    } catch (error) {
      console.error("Error updating template:", error);
    }
  }, []);

  const deleteTemplate = useCallback(async (templateId: string) => {
    try {
      await deleteDoc(doc(db, "checklistTemplates", templateId));
    } catch (error) {
      console.error("Error deleting template:", error);
    }
  }, []);
  
  const addSubmission = useCallback(async (submission: Omit<ChecklistSubmission, 'id'>) => {
    try {
      await addDoc(collection(db, "checklistSubmissions"), submission);
    } catch (error) {
      console.error("Error adding submission:", error);
    }
  }, []);

  const value: ChecklistContextType = {
    templates,
    submissions,
    loading,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    addSubmission,
  };

  return <ChecklistContext.Provider value={value}>{children}</ChecklistContext.Provider>;
}
