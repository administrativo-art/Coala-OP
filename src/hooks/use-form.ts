"use client";

import { useContext } from 'react';
import { FormContext, type FormContextType } from '@/components/form-provider';
import { useAuth } from './use-auth';
import { useTasks } from './use-tasks';
import { type FormSubmission, type FormTemplate, type TaskHistoryItem, type FormQuestion } from '@/types';

type EnrichedFormContextType = Omit<FormContextType, 'addSubmission'> & {
    addSubmission: (submission: Omit<FormSubmission, 'id'>, template: FormTemplate) => Promise<void>;
};

export const useForm = (): EnrichedFormContextType => {
  const context = useContext(FormContext);
  const { user } = useAuth();
  const { addTask } = useTasks();

  if (context === undefined) {
    throw new Error('useForm must be used within a FormProvider');
  }

  const addSubmissionWithTasks = async (submission: Omit<FormSubmission, 'id'>, template: FormTemplate) => {
    if (!user) {
        console.error("Cannot add submission, user is not authenticated.");
        return;
    }
    
    let submissionStatus: 'completed' | 'in_progress' = 'completed';
    const tasksToCreate: any[] = [];
    const allQuestions: FormQuestion[] = template.sections.flatMap(s => {
      const getQuestions = (q_list: FormQuestion[]): FormQuestion[] => {
          return q_list.flatMap(q => [q, ...(q.options ? q.options.flatMap(opt => getQuestions(opt.subQuestions || [])) : [])]);
      };
      return getQuestions(s.questions);
    });

    const findQuestion = (id: string, questions: FormQuestion[]): (FormQuestion | undefined) => {
        return questions.find(q => q.id === id);
    };

    submission.answers.forEach(answer => {
        const question = findQuestion(answer.questionId, allQuestions);
        if (question && question.options) {
            const selectedValues = Array.isArray(answer.value) ? answer.value : [answer.value];
            question.options.forEach(option => {
                if (selectedValues.includes(option.value) && option.action) {
                    submissionStatus = 'in_progress';
                    const historyItem: TaskHistoryItem = {
                        timestamp: new Date().toISOString(),
                        author: { id: user.id, name: user.username },
                        action: 'created',
                        details: `Criada a partir do formulário "${template.name}"`
                    };
                    tasksToCreate.push({
                        ...option.action,
                        status: 'pending',
                        origin: {
                            type: 'form_submission',
                            submissionId: '', // Will be filled after submission is created
                            questionId: question.id,
                            optionId: option.id,
                        },
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        history: [historyItem]
                    });
                }
            });
        }
    });

    const finalSubmission = { ...submission, status: submissionStatus };
    const submissionId = await context.addSubmission(finalSubmission, template);

    if (submissionId && tasksToCreate.length > 0) {
        for (const task of tasksToCreate) {
            task.origin.submissionId = submissionId;
            await addTask(task);
        }
    }
  };

  return {
    ...context,
    addSubmission: addSubmissionWithTasks,
  };
};
