import { z } from 'zod';
import { suggestAssignee, suggestTarget } from '../history/suggest.js';
import { badRequest } from '../http/errors.js';
import { defineTool } from './types.js';
export const suggestAssigneeTool = defineTool({
  name: 'suggest_assignee',
  title: 'Suggest who should fix it',
  description:
    'Ranks people by how many similar issues they resolved before (issue history: same component, same guideline, same lens; recent ones count more) and returns the evidence path for each. A suggestion only: nothing is assigned. Give finding_id, issue_key or decision_id.',
  input: {
    finding_id: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional()
      .describe('A Finding id'),
    issue_key: z
      .string()
      .max(400)
      .optional()
      .describe('An Issue key, e.g. "axe|color-contrast|SignInButton"'),
    decision_id: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional()
      .describe('A Decision id'),
  },
  async run(g, args) {
    if (!args.finding_id && !args.issue_key && !args.decision_id)
      throw badRequest('Give finding_id, issue_key or decision_id');
    const result = await suggestAssignee(await suggestTarget(g, args));
    return { result, screens: [], edges: [] };
  },
});
