import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Octokit } from 'octokit';
import { env } from '../config/env.js';
import { closeDb, HISTORY_GRAPH, openHistoryWriter } from '../graph/db.js';
import { runWithContext, systemContext } from '../tenancy/context.js';
export interface PastIssue {
  id: string;
  title: string;
  component: string | null;
  guideline: string | null;
  lens: string | null;
  assignee: string;
  github: string | null;
  team: string | null;
  closed_at: string;
  source: 'fixture' | 'github';
  url: string | null;
}
const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);
async function fromFixture(file: string): Promise<PastIssue[]> {
  const data = JSON.parse(await readFile(file, 'utf8')) as {
    people: {
      name: string;
      team: string;
      github: string | null;
    }[];
    issues: {
      title: string;
      component: string | null;
      guideline: string | null;
      lens: string | null;
      assignee: string;
      closed_at: string;
    }[];
  };
  const people = new Map(data.people.map((p) => [p.name, p]));
  return data.issues.map((i) => ({
    ...i,
    id: hash(`fixture|${i.title}`),
    github: people.get(i.assignee)?.github ?? null,
    team: people.get(i.assignee)?.team ?? null,
    source: 'fixture' as const,
    url: null,
  }));
}
const label = (labels: string[], prefix: string) =>
  labels
    .find((l) => l.startsWith(`${prefix}:`))
    ?.slice(prefix.length + 1)
    .trim() || null;
async function fromGithub(): Promise<PastIssue[]> {
  if (!env.GITHUB_REPO || !env.GITHUB_TOKEN)
    throw new Error('--github needs GITHUB_REPO and GITHUB_TOKEN in fens-api/.env');
  const [owner, repo] = env.GITHUB_REPO.split('/') as [string, string];
  const octokit = new Octokit({ auth: env.GITHUB_TOKEN });
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'closed',
    per_page: 100,
  });
  const out: PastIssue[] = [];
  for (const i of issues) {
    if (i.pull_request) continue;
    const labels = i.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? '')));
    const category = label(labels, 'category');
    const lens =
      label(labels, 'lens') ??
      (category === 'seo' ? 'SEO' : category === 'aeo' ? 'AEO' : category ? 'UX' : null);
    for (const a of i.assignees ?? []) {
      out.push({
        id: hash(`github|${env.GITHUB_REPO}|${i.number}|${a.login}`),
        title: i.title,
        component: label(labels, 'component'),
        guideline: label(labels, 'guideline'),
        lens,
        assignee: a.login,
        github: a.login,
        team: label(labels, 'team'),
        closed_at: i.closed_at ?? i.updated_at,
        source: 'github',
        url: i.html_url,
      });
    }
  }
  return out;
}
export async function importHistory(issues: PastIssue[]): Promise<void> {
  const w = await openHistoryWriter();
  await w.write(
    `UNWIND $rows AS r
     MERGE (p:Person {name: r.assignee}) SET p.github = coalesce(r.github, p.github)
     MERGE (i:PastIssue {id: r.id})
     SET i.title = r.title, i.closed_at = r.closed_at, i.lens = r.lens, i.source = r.source, i.url = r.url,
         i.component = r.component, i.guideline = r.guideline
     MERGE (p)-[:RESOLVED]->(i)`,
    { rows: issues },
  );
  await w.write(
    `UNWIND $rows AS r MATCH (p:Person {name: r.assignee})
     MERGE (t:Team {name: r.team}) MERGE (p)-[:MEMBER_OF]->(t)`,
    { rows: issues.filter((i) => i.team) },
  );
  await w.write(
    `UNWIND $rows AS r MATCH (i:PastIssue {id: r.id})
     MERGE (c:DesignSystemComponent {name: r.component}) MERGE (i)-[:IN_COMPONENT]->(c)`,
    { rows: issues.filter((i) => i.component) },
  );
  await w.write(
    `UNWIND $rows AS r MATCH (i:PastIssue {id: r.id})
     MERGE (g:Guideline {id: r.guideline}) SET g.lens = coalesce(r.lens, g.lens)
     MERGE (i)-[:VIOLATES]->(g)`,
    { rows: issues.filter((i) => i.guideline) },
  );
}
async function main(): Promise<void> {
  const github = process.argv.includes('--github');
  const issues = github
    ? await fromGithub()
    : await fromFixture(resolve('history', 'past-issues.json'));
  await importHistory(issues);
  const people = new Set(issues.map((i) => i.assignee));
  console.log(
    `Imported ${issues.length} resolved issues by ${people.size} people from ${github ? env.GITHUB_REPO : 'history/past-issues.json'} into graph ${HISTORY_GRAPH}.`,
  );
  if (issues.length === 0) console.log('Nothing to import (no closed issues with an assignee).');
}
runWithContext(systemContext(), main)
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void closeDb());
