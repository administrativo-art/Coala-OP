

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type FormTemplate, type FormSubmission, type Task } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch } from 'firebase/firestore';

export interface FormContextType {
  templates: FormTemplate[];
  submissions: FormSubmission[];
  loading: boolean;
  addTemplate: (template: Omit<FormTemplate, 'id' | 'status'>) => Promise<string | null>;
  updateTemplate: (template: FormTemplate) => Promise<void>;
  deleteTemplate: (templateId: string) => Promise<void>;
  addSubmission: (submission: Omit<FormSubmission, 'id'>, tasksToCreate?: Omit<Task, 'id' | 'origin'>[]) => Promise<string | null>;
  deleteSubmission: (submissionId: string) => Promise<void>;
  updateSubmission: (submissionId: string, updates: Partial<FormSubmission>) => Promise<void>;
}

export const FormContext = createContext<FormContextType | undefined>(undefined);

export function FormProvider({ children }: { children: React.ReactNode }) {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const qTemplates = query(collection(db, "formTemplates"));
    const unsubscribeTemplates = onSnapshot(qTemplates, async (querySnapshot) => {
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), status: doc.data().status || 'draft' } as FormTemplate));
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

  const addTemplate = useCallback(async (template: Omit<FormTemplate, 'id' | 'status'>): Promise<string | null> => {
    try {
      const docRef = await addDoc(collection(db, "formTemplates"), { ...template, status: 'draft' });
      return docRef.id;
    } catch (error) {
      console.error("Error adding template:", error);
      return null;
    }
  }, []);

  const updateTemplate = useCallback(async (template: FormTemplate) => {
    const templateRef = doc(db, "formTemplates", template.id);
    const { id, ...dataToUpdate } = template;

    // Deep-clone and clean undefined values
    const cleanedData = JSON.parse(JSON.stringify(dataToUpdate), (key, value) => {
        return value === undefined ? null : value;
    });

    try {
      await updateDoc(templateRef, cleanedData as any);
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
  
  const addSubmission = useCallback(async (submission: Omit<FormSubmission, 'id'>, tasksToCreate?: Omit<Task, 'id' | 'origin'>[]): Promise<string | null> => {
    try {
      const batch = writeBatch(db);
      
      const submissionRef = doc(collection(db, "formSubmissions"));
      batch.set(submissionRef, submission);
      
      if (tasksToCreate && tasksToCreate.length > 0) {
        tasksToCreate.forEach(taskData => {
          const taskRef = doc(collection(db, "tasks"));
          const fullTaskData = {
            ...taskData,
            origin: { 
              type: 'form_submission',
              submissionId: submissionRef.id,
              ...taskData.origin,
            },
          };
          batch.set(taskRef, fullTaskData as any);
        });
      }
      
      await batch.commit();
      return submissionRef.id;

    } catch (error) {
      console.error("Error adding submission and tasks:", error);
      return null;
    }
  }, []);

  const updateSubmission = useCallback(async (submissionId: string, updates: Partial<FormSubmission>) => {
    const submissionRef = doc(db, "formSubmissions", submissionId);
    try {
        await updateDoc(submissionRef, updates);
    } catch(error) {
        console.error("Error updating submission:", error);
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

  const value: FormContextType = useMemo(() => ({
    templates,
    submissions,
    loading,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    addSubmission,
    deleteSubmission,
    updateSubmission,
  }), [templates, submissions, loading, addTemplate, updateTemplate, deleteTemplate, addSubmission, deleteSubmission, updateSubmission]);

  return <FormContext.Provider value={value}>{children}</FormContext.Provider>;
}

    