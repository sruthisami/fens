import type { Octokit } from 'octokit';
import type { ReadOnlyGraph } from '../graph/db.js';
import { badRequest } from '../http/errors.js';
import { suggestAssignee, suggestionLine, suggestTarget } from './suggest.js';
type Ref = {
  finding_id?: string;
  decision_id?: string;
};
export async function suggestionText(g: ReadOnlyGraph, ref: Ref): Promise<string> {
  try {
    return suggestionLine(await suggestAssignee(await suggestTarget(g, ref)));
  } catch (err) {
    return `Suggested assignee: unavailable (${(err as Error).message}).`;
  }
}
export async function confirmedAssignee(
  g: ReadOnlyGraph,
  ref: Ref,
  assignee: string | undefined,
): Promise<string | null> {
  if (!assignee) return null;
  const top = (await suggestAssignee(await suggestTarget(g, ref))).ranking[0];
  if (!top?.github || top.github !== assignee)
    throw badRequest(
      'Only the suggested assignee (with a known GitHub login) can be assigned, and only after confirming.',
    );
  return assignee;
}
export async function assignAfterCreate(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  login: string | null,
): Promise<{
  assigned: boolean;
  assign_note?: string;
}> {
  if (!login) return { assigned: false };
  try {
    await octokit.rest.issues.addAssignees({
      owner,
      repo,
      issue_number: issueNumber,
      assignees: [login],
    });
    return { assigned: true };
  } catch (err) {
    return {
      assigned: false,
      assign_note: `The issue was created, but GitHub refused to assign ${login} (${
        (
          err as {
            status?: number;
          }
        ).status ?? 'error'
      }).`,
    };
  }
}
