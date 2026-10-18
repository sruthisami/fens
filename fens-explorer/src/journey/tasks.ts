import { readFile } from 'node:fs/promises';
import { z } from 'zod';
const taskSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'task ids are lowercase words joined by "-"'),
  name: z.string().min(1).max(120),
  start: z.string().startsWith('/'),
  end: z.string().startsWith('/'),
  steps: z.array(z.string().min(1).max(200)).min(1).max(100),
});
const fileSchema = z.object({ tasks: z.array(taskSchema).min(1) });
export type TaskDef = z.infer<typeof taskSchema>;
export async function readTasks(file: string): Promise<TaskDef[]> {
  const parsed = fileSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
  if (!parsed.success)
    throw new Error(`Invalid tasks file ${file}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data.tasks;
}
