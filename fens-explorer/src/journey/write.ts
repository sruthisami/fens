import type { FalkorDB } from 'falkordb';
import type { JourneyResult } from './run.js';
export async function writeTask(
  db: FalkorDB,
  graphName: string,
  run: JourneyResult,
): Promise<void> {
  const graph = db.selectGraph(graphName);
  const { task } = run;
  await graph.query(
    `MERGE (t:Task {id: $id})
     SET t.name = $name, t.clicks = $clicks, t.steps = $steps
     WITH t
     OPTIONAL MATCH (t)-[old:STARTS_AT|ENDS_AT]->()
     DELETE old`,
    { params: { id: task.id, name: task.name, clicks: run.clicks, steps: task.steps } as never },
  );
  await graph.query(
    `MATCH (t:Task {id: $id}) MATCH (s:Screen {id: $start}) MATCH (e:Screen {id: $end})
     MERGE (t)-[:STARTS_AT]->(s)
     MERGE (t)-[:ENDS_AT]->(e)`,
    { params: { id: task.id, start: task.start, end: task.end } as never },
  );
  await graph.query(`MATCH (t:Task {id: $id})-[v:VISITS]->() WHERE v.order > $clicks DELETE v`, {
    params: { id: task.id, clicks: run.clicks } as never,
  });
  for (const step of run.steps) {
    await graph.query(
      `MATCH (t:Task {id: $id})
       OPTIONAL MATCH (t)-[old:VISITS {order: $order}]->()
       DELETE old`,
      { params: { id: task.id, order: step.order } as never },
    );
    await graph.query(
      `MATCH (t:Task {id: $id}) MATCH (s:Screen {id: $to})
       MERGE (t)-[v:VISITS {order: $order}]->(s)
       SET v.action = $action`,
      { params: { id: task.id, to: step.to, order: step.order, action: step.action } as never },
    );
  }
}
