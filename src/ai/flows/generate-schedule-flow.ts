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
import { enUS } from 'date-fns/locale';

// Keep old input/output types for external compatibility
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

// -- NEW AI-specific schemas --
const AiShiftSchema = z.object({
  kioskName: z.string().describe("The name of the kiosk."),
  turn: z.enum(['T1', 'T2']).describe("The shift turn, either T1 or T2."),
  employeeUsername: z.string().describe("The username of the assigned employee."),
});

const AiDailyScheduleSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The date for this schedule in YYYY-MM-DD format."),
  shifts: z.array(AiShiftSchema).describe("A list of all shifts for this date."),
});

const GenerateScheduleInputSchema = z.object({
  month: z.number().min(1).max(12).describe('The month for which to generate the schedule (1-12).'),
  year: z.number().describe('The year for which to generate the schedule.'),
  users: z.array(UserSchema).describe('The list of available employees.'),
  kiosks: z.array(KioskSchema).describe('The list of kiosks that need to be staffed.'),
  partialSchedule: z.array(AiDailyScheduleSchema).optional().describe("An optional partial schedule. If provided, treat this as a fixed history and generate the schedule only for the remaining days of the month."),
});
export type GenerateScheduleInput = z.infer<typeof GenerateScheduleInputSchema>;


// This is the output type that the rest of the app expects.
const GenerateScheduleOutputSchema = z.record(z.string(), z.record(z.string(), z.string().optional()));
export type GenerateScheduleOutput = z.infer<typeof GenerateScheduleOutputSchema>;

const AiScheduleOutputSchema = z.object({
  schedule: z.array(AiDailyScheduleSchema).describe("The complete monthly schedule as an array of daily schedules."),
});
type AiScheduleOutput = z.infer<typeof AiScheduleOutputSchema>;
// -- END NEW SCHEMAS --

export async function generateSchedule(input: GenerateScheduleInput): Promise<GenerateScheduleOutput> {
  // Add day of the week to the prompt context
  const start = startOfMonth(new Date(input.year, input.month - 1));
  const end = endOfMonth(new Date(input.year, input.month - 1));
  const days = eachDayOfInterval({ start, end }).map(day => ({
    date: format(day, 'yyyy-MM-dd'),
    dayOfWeek: format(day, 'EEEE', { locale: enUS }), // Use English for the model
  }));

  const extendedInput = { ...input, days };

  const aiOutput = await generateScheduleFlow(extendedInput);

  // Transform the AI's array-based output into the record-based format the app expects
  const transformedSchedule: GenerateScheduleOutput = {};
  if (aiOutput && aiOutput.schedule) {
    aiOutput.schedule.forEach(dailySchedule => {
      const dateKey = dailySchedule.date;
      if (!transformedSchedule[dateKey]) {
        transformedSchedule[dateKey] = {};
      }
      dailySchedule.shifts.forEach(shift => {
        const shiftKey = `${shift.kioskName} ${shift.turn}`;
        transformedSchedule[dateKey][shiftKey] = shift.employeeUsername;
      });
    });
  }

  return transformedSchedule;
}

const prompt = ai.definePrompt({
  name: 'generateSchedulePrompt',
  input: {
    schema: GenerateScheduleInputSchema.extend({
      days: z.array(z.object({ date: z.string(), dayOfWeek: z.string() })),
    }),
  },
  output: { schema: AiScheduleOutputSchema }, // Use new schema here
  prompt: `You are an expert shift scheduler for a chain of kiosks.
  {{#if partialSchedule}}
  **IMPORTANT: REORGANIZATION TASK**
  You have been provided with a partial schedule that is already fixed. Your task is to generate the schedule ONLY for the remaining days of the month, starting from the day after the last day in the partial schedule.

  - **Fixed History:** The following days are already scheduled and MUST NOT be changed.
  {{#each partialSchedule}}
    - **Date: {{this.date}}**
    {{#each this.shifts}}
      - {{this.kioskName}} {{this.turn}}: {{this.employeeUsername}}
    {{/each}}
  {{/each}}

  - **Analyze Employee State:** Before you begin, analyze the provided partial schedule to determine the number of consecutive days each employee has worked leading up to the first day you need to schedule. This is crucial for respecting the 6-day work limit.

  - **Generate Remaining Days:** Now, generate the schedule for all subsequent days in the month, following all the rules below.
  {{else}}
  **IMPORTANT: FULL SCHEDULE GENERATION**
  You are generating a complete schedule for the entire month from scratch.
  {{/if}}
  
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
  1.  **Coverage:** Every kiosk must have one employee assigned to Turno 1 (T1) and one to Turno 2 (T2) for every single day of the month. This is the top priority.
  2.  **Strict 6-Day Work Limit:** No employee can work more than 6 consecutive days. After working for 6 days in a row, an employee MUST receive at least one day off. This is a non-negotiable rule. A day off is represented by the employee's name not being assigned to any shift on that day. Folgas can be given before 6 days.
  3.  **Standard Shifts:** Employees with a fixed 'turno' (T1 or T2) should primarily work that shift.
  4.  **Folguistas:** Employees marked as 'folguista' (floater) do not have a fixed shift and should be used to cover the days off of other employees. They are essential for filling gaps.
  5.  **No Back-to-Backs:** An employee cannot work T2 on one day and T1 the very next day.
  6.  **Fairness:** Distribute the workload and days off as evenly as possible among all employees. Every employee should have a similar number of work days.
  7.  **Output Format:** You MUST provide a complete schedule. {{#if partialSchedule}}Your output MUST include both the original partial schedule and the new days you have generated, combined into a single complete schedule array for the whole month.{{else}}You MUST provide a complete schedule for every day of the month.{{/if}} The output must be a single JSON object with a key "schedule". The value of "schedule" must be an array of objects, where each object represents a single day. Each day object must have a "date" (string in "YYYY-MM-DD" format) and a "shifts" key. "shifts" must be an array of shift objects. Each shift object must have "kioskName" (string), "turn" (string, "T1" or "T2"), and "employeeUsername" (string, the employee's username).

  Generate the schedule now.
  `,
});

const generateScheduleFlow = ai.defineFlow(
  {
    name: 'generateScheduleFlow',
    inputSchema: GenerateScheduleInputSchema.extend({
      days: z.array(z.object({ date: z.string(), dayOfWeek: z.string() })),
    }),
    outputSchema: AiScheduleOutputSchema, // Use new schema here
  },
  async (input): Promise<AiScheduleOutput> => {
    const { output } = await prompt(input);
    if (!output) {
      throw new Error("AI did not return a schedule.");
    }
    return output;
  }
);
