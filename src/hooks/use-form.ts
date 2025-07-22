
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
    
    const allQuestions: FormQuestion[] = template.sections.flatMap(s => {
      const getQuestions = (q_list: FormQuestion[]): FormQuestion[] => {
          return q_list.flatMap(q => [q, ...(q.options ? q.options.flatMap(opt => getQuestions(opt.subQuestions || [])) : [])]);
      };
      return getQuestions(s.questions);
    });

    const findQuestion = (id: string): (FormQuestion | undefined) => {
        return allQuestions.find(q => q.id === id);
    };

    submission.answers.forEach(answer => {
        const question = findQuestion(answer.questionId);
        if (question && question.options) {
            const selectedValues = Array.isArray(answer.value) ? answer.value : [answer.value];
            question.options.forEach(option => {
                if (selectedValues.includes(option.value) && option.action) {
                    submissionStatus = 'in_progress';
                    const now = new Date();
                    const historyItem: TaskHistoryItem = {
                        timestamp: now.toISOString(),
                        author: { id: user.id, name: user.username },
                        action: 'created',
                        details: `Criada a partir do formulário "${template.name}"`
                    };
                    
                    const taskPayload: Omit<Task, 'id' | 'origin'> & { origin: any } = {
                        ...option.action,
                        status: 'pending',
                        origin: {
                            questionId: question.id,
                            optionId: option.id,
                        },
                        createdAt: now.toISOString(),
                        updatedAt: now.toISOString(),
                        history: [historyItem]
                    };

                    if (option.action.dueInDays && option.action.dueInDays > 0) {
                        taskPayload.dueDate = addDays(now, option.action.dueInDays).toISOString();
                    }

                    tasksToCreate.push(taskPayload);
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
