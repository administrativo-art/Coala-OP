
'use server';
/**
 * @fileOverview An AI flow for automatically generating a monthly work schedule.
 *
 * - generateSchedule - A function that handles the schedule generation process.
 * - GenerateScheduleInput - The input type for the generateSchedule function.
 * - GenerateScheduleOutput - The return type for the generateSchedule function.
 */
import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { eachDayOfInterval, endOfMonth, format, startOfMonth } from 'date-fns';

const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  turno: z.enum(['T1', 'T2']).nullable(),
  folguista: z.boolean(),
});

const KioskSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const GenerateScheduleInputSchema = z.object({
  month: z.number().min(1).max(12).describe('The month for which to generate the schedule (1-12).'),
  year: z.number().describe('The year for which to generate the schedule.'),
  users: z.array(UserSchema).describe('The list of available employees.'),
  kiosks: z.array(KioskSchema).describe('The list of kiosks that need to be staffed.'),
});
export type GenerateScheduleInput = z.infer<typeof GenerateScheduleInputSchema>;


const GenerateScheduleOutputSchema = z.record(z.string(), z.record(z.string(), z.string().optional()))
  .describe('The complete monthly schedule. The top-level key is the date string "YYYY-MM-DD". The nested value is an object where the key is a string like "Kiosk Name T1" or "Kiosk Name T2", and the value is the assigned employee\'s username.');
export type GenerateScheduleOutput = z.infer<typeof GenerateScheduleOutputSchema>;


export async function generateSchedule(input: GenerateScheduleInput): Promise<GenerateScheduleOutput> {
  // Add day of the week to the prompt context
  const start = startOfMonth(new Date(input.year, input.month - 1));
  const end = endOfMonth(new Date(input.year, input.month - 1));
  const days = eachDayOfInterval({ start, end }).map(day => ({
    date: format(day, 'yyyy-MM-dd'),
    dayOfWeek: format(day, 'EEEE', { locale: { code: 'en-US' } }), // Use English for the model
  }));

  const extendedInput = { ...input, days };

  return generateScheduleFlow(extendedInput);
}

const prompt = ai.definePrompt({
  name: 'generateSchedulePrompt',
  input: {
    schema: GenerateScheduleInputSchema.extend({
      days: z.array(z.object({ date: z.string(), dayOfWeek: z.string() })),
    }),
  },
  output: { schema: GenerateScheduleOutputSchema },
  prompt: `You are an expert shift scheduler for a chain of kiosks. Your task is to generate a fair and balanced monthly work schedule.

  **Input Data:**
  - **Month/Year:** {{month}}/{{year}}
  - **Employees:**
  {{#each users}}
    - {{this.username}} (Shift: {{#if this.turno}}{{this.turno}}{{else}}N/A{{/if}}, Folguista: {{this.folguista}})
  {{/each}}
  - **Kiosks to staff:**
  {{#each kiosks}}
    - {{this.name}}
  {{/each}}
  - **Days in the month:**
  {{#each days}}
    - {{this.date}} ({{this.dayOfWeek}})
  {{/each}}

  **Rules:**
  1.  **Coverage:** Every kiosk must have one employee assigned to Turno 1 (T1) and one to Turno 2 (T2) for every single day of the month.
  2.  **Standard Shifts:** Employees with a fixed 'turno' (T1 or T2) should primarily work that shift.
  3.  **Folguistas:** Employees marked as 'folguista' (floater) do not have a fixed shift and should be used to cover the days off of other employees. They are essential for filling gaps.
  4.  **Work Schedule:** The work schedule is flexible. The ideal is for employees to work about 6 days before a day off, but this is not a strict rule. The most important goal is to ensure full shift coverage. Days off can be granted in shorter intervals if necessary to complete the monthly schedule. **Hard Rule:** No employee can work more than 7 consecutive days without a day off. A day off is represented by the employee's name not being assigned to any shift on that day.
  5.  **No Back-to-Backs:** An employee cannot work T2 on one day and T1 the very next day.
  6.  **Fairness:** Distribute the workload and days off as evenly as possible among all employees. Every employee should have a similar number of work days.
  7.  **Output Format:** You MUST provide a complete schedule for every day of the month. The output must be a JSON object. The keys of this object are date strings in "YYYY-MM-DD" format. The value for each date is another object where keys are strings in the format "Kiosk Name T1" or "Kiosk Name T2", and the value is the username of the assigned employee.

  Generate the complete schedule for the month now.
  `,
});

const generateScheduleFlow = ai.defineFlow(
  {
    name: 'generateScheduleFlow',
    inputSchema: GenerateScheduleInputSchema.extend({
      days: z.array(z.object({ date: z.string(), dayOfWeek: z.string() })),
    }),
    outputSchema: GenerateScheduleOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
