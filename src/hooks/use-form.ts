

"use client";

import { useContext } from 'react';
import { FormContext, type FormContextType } from '@/components/form-provider';
import { useAuth } from './use-auth';
import { type FormSubmission, type FormTemplate, type TaskHistoryItem, type FormQuestion, type Task } from '@/types';
import { addDays } from 'date-fns';

type EnrichedFormContextType = Omit<FormContextType, 'addSubmission'> & {
    addSubmission: (submission: Omit<FormSubmission, 'id'>, template: FormTemplate) => Promise<void>;
    generateDailyChecklist: (kioskId: string, kioskName: string, dateISO: string, schedule: any) => Promise<void>;
};

const getAllQuestionsFromTemplate = (template: FormTemplate): FormQuestion[] => {
    return template.questions || [];
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
    
    const allQuestions = getAllQuestionsFromTemplate(template);
    const questionMap = new Map(allQuestions.map(q => [q.id, q]));

    submission.answers.forEach(answer => {
        const question = questionMap.get(answer.questionId);
        if (question?.options) {
          const matchedOption = question.options.find(opt => opt.value === answer.value);
          if (matchedOption?.ramification) {
              const ramification = matchedOption.ramification;
               if (ramification.action === 'create_task' && ramification.taskAction) {
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
                            submissionId: '',
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
        }
    });

    const finalSubmission = { ...submission, status: submissionStatus };
    await context.addSubmission(finalSubmission, tasksToCreate);
  };
  
   const generateDailyChecklist = async (kioskId: string, kioskName: string, dateISO: string, schedule: any) => {
        const checklistTemplate = context.templates.find(t => 
            t.type === 'operational_checklist' && t.moment === 'ABERTURA'
        );

        if (!checklistTemplate) return;

        const submissionId = `daily-${kioskId}-${dateISO}`;
        const existingSubmission = context.submissions.find(s => s.id === submissionId);
        if (existingSubmission) return;

        const employeeName = schedule[`${kioskName} T1`] || 'Não definido';

        const newSubmission: Omit<FormSubmission, 'id'> = {
            templateId: checklistTemplate.id,
            templateName: checklistTemplate.name,
            title: `Checklist Abertura ${kioskName} - ${dateISO}`,
            status: 'in_progress',
            userId: 'system',
            username: employeeName,
            kioskId: kioskId,
            kioskName: kioskName,
            createdAt: new Date().toISOString(),
            answers: [],
        };
        
        // Using a custom hook here since we need to bypass the task creation logic for automatic submissions.
        await context.addSubmission(newSubmission, []);
    };


  return {
    ...context,
    addSubmission: addSubmissionWithTasks,
    generateDailyChecklist,
  };
};
