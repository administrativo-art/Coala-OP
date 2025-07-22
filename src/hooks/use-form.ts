
"use client";

import { useContext } from 'react';
import { FormContext, type FormContextType } from '@/components/form-provider';
import { useAuth } from './use-auth';
import { type FormSubmission, type FormTemplate, type TaskHistoryItem, type FormQuestion, type Task } from '@/types';
import { addDays } from 'date-fns';

type EnrichedFormContextType = Omit<FormContextType, 'addSubmission'> & {
    addSubmission: (submission: Omit<FormSubmission, 'id'>, template: FormTemplate) => Promise<void>;
    generateDailyChecklist: (kioskId: string, kioskName: string, date: string, dailySchedule: any) => Promise<void>;
};

const getAllQuestions = (sections: any[]): FormQuestion[] => {
    const questions: FormQuestion[] = [];
    const recurse = (qs: FormQuestion[] | undefined) => {
        if (!qs) return;
        qs.forEach(q => {
            questions.push(q);
            if (q.ramifications) {
                q.ramifications.forEach(ram => {
                    // This part would need to be expanded if we were to find questions inside ramifications
                    // For now, we assume a flat structure within a section for finding questions by ID.
                });
            }
        });
    };
    sections.forEach(sec => recurse(sec.questions));
    return questions;
};

export const useForm = (): EnrichedFormContextType => {
  const context = useContext(FormContext);
  const { user } = useAuth();
  
  if (context === undefined) {
    throw new Error('useForm must be used within a FormProvider');
  }

  const addSubmissionWithTasks = async (submission: Omit<FormSubmission, 'id'>, template: FormTemplate) => {
    if (!user) {
        console.error("Cannot add submission, user is not authenticated.");
        return;
    }
    
    let submissionStatus: 'completed' | 'in_progress' = 'completed';
    const tasksToCreate: Omit<Task, 'id' | 'origin'>[] = [];
    
    const allQuestions = getAllQuestions(template.sections);

    const findQuestion = (id: string): (FormQuestion | undefined) => {
        return allQuestions.find(q => q.id === id);
    };

    submission.answers.forEach(answer => {
        const question = findQuestion(answer.questionId);
        if (question && question.ramifications) {
            question.ramifications.forEach(ramification => {
                if (ramification.action === 'create_task' && ramification.taskAction) {
                    // Implement condition checking logic here
                    // For simplicity, let's assume a simple 'eq' check for now
                    const condition = ramification.conditions[0];
                    if (condition && String(answer.value) === String(condition.value)) {
                        submissionStatus = 'in_progress';
                        const now = new Date();
                        const historyItem: TaskHistoryItem = {
                            timestamp: now.toISOString(),
                            author: { id: user.id, name: user.username },
                            action: 'created',
                            details: `Criada a partir do formulário "${template.name}"`
                        };
                        
                        const taskPayload: Omit<Task, 'id' | 'origin'> & { origin: any } = {
                            ...ramification.taskAction,
                            status: 'pending',
                            origin: {
                                type: 'form_submission',
                                submissionId: '', // This will be set by the provider
                                questionId: question.id,
                            },
                            createdAt: now.toISOString(),
                            updatedAt: now.toISOString(),
                            history: [historyItem]
                        };

                        if (ramification.taskAction.dueInDays && ramification.taskAction.dueInDays > 0) {
                            taskPayload.dueDate = addDays(now, ramification.taskAction.dueInDays).toISOString();
                        }

                        tasksToCreate.push(taskPayload);
                    }
                }
            });
        }
    });

    const finalSubmission = { ...submission, status: submissionStatus };
    await context.addSubmission(finalSubmission, tasksToCreate);
  };
  
  const generateDailyChecklist = async (kioskId: string, kioskName: string, date: string, dailySchedule: any) => {
    // This is where the logic from "Etapa 7" would live.
    // For now, we'll keep it simple as the configuration UI doesn't exist yet.
    // A real implementation would:
    // 1. Fetch the "Regras de Montagem" from Firestore.
    // 2. Determine the number of shifts for the given kiosk from `dailySchedule`.
    // 3. Find the correct sequence of "momentos" from the rules.
    // 4. Fetch each "momento" template from the `templates` state.
    // 5. Assemble a new `FormSubmission` with the combined sections of all momentos.
    // 6. Call `context.addSubmission` to save it.
    console.log(`Placeholder: Gerar checklist para quiosque ${kioskName} na data ${date}`);
    // console.log("Schedule for the day:", dailySchedule);
  };

  return {
    ...context,
    addSubmission: addSubmissionWithTasks,
    generateDailyChecklist,
  };
};
