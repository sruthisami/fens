import type { ReadOnlyGraph } from '../graph/db.js';
export const EMBEDDING_DIMENSION = 768;
export interface Neighbour {
  id: string;
  similarity: number;
}
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
export const BOILERPLATE_SHARE = 0.6;
export function contentTexts(
  rows: {
    id: string;
    title: string | null;
    text: string | null;
  }[],
): Map<string, string> {
  const docs = rows.map((r) => ({ id: r.id, words: words(`${r.title ?? ''} ${r.text ?? ''}`) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d.words)) df.set(w, (df.get(w) ?? 0) + 1);
  const limit = Math.max(2, Math.ceil(rows.length * BOILERPLATE_SHARE));
  return new Map(
    docs.map((d) => [d.id, d.words.filter((w) => (df.get(w) ?? 0) < limit).join(' ')]),
  );
}
function counts(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of words(text)) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [w, x] of a) {
    na += x * x;
    dot += x * (b.get(w) ?? 0);
  }
  for (const x of b.values()) nb += x * x;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
export async function hasEmbeddings(g: ReadOnlyGraph): Promise<boolean> {
  const rows = await g.read<{
    n: number;
  }>('MATCH (s:Screen) WHERE s.embedding IS NOT NULL RETURN count(s) AS n');
  return (rows[0]?.n ?? 0) > 0;
}
export async function neighbours(
  g: ReadOnlyGraph,
  screen: string,
  k: number,
  method?: 'embedding' | 'lexical',
): Promise<{
  method: 'embedding' | 'lexical';
  neighbours: Neighbour[];
}> {
  const use = method ?? ((await hasEmbeddings(g)) ? 'embedding' : 'lexical');
  if (use === 'embedding') {
    const rows = await g.read<{
      id: string;
      score: number;
    }>(
      `MATCH (q:Screen {id: $id})
       CALL db.idx.vector.queryNodes('Screen', 'embedding', ${k + 1}, q.embedding) YIELD node, score
       RETURN node.id AS id, score`,
      { id: screen },
    );
    return {
      method: 'embedding',
      neighbours: rows
        .filter((r) => r.id !== screen)
        .map((r) => ({ id: r.id, similarity: Math.round((1 - r.score) * 1000) / 1000 }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, k),
    };
  }
  const rows = await g.read<{
    id: string;
    title: string | null;
    text: string | null;
  }>('MATCH (s:Screen) RETURN s.id AS id, s.title AS title, s.text AS text');
  const texts = contentTexts(rows);
  const vec = new Map(rows.map((r) => [r.id, counts(texts.get(r.id) ?? '')]));
  const q = vec.get(screen);
  if (!q) return { method: 'lexical', neighbours: [] };
  return {
    method: 'lexical',
    neighbours: rows
      .filter((r) => r.id !== screen)
      .map((r) => ({
        id: r.id,
        similarity: Math.round(cosine(q, vec.get(r.id) ?? new Map()) * 1000) / 1000,
      }))
      .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
      .slice(0, k),
  };
}
export interface MenuCategories {
  categories: string[];
  of: Map<string, string[]>;
}
export async function menuCategories(g: ReadOnlyGraph): Promise<MenuCategories> {
  const start =
    (
      await g.read<{
        id: string;
      }>(
        "MATCH (s:Screen) WHERE s.discovered_via = 'start' RETURN s.id AS id ORDER BY s.depth LIMIT 1",
      )
    )[0]?.id ?? '/';
  const rows = await g.read<{
    c: string;
    m: string;
    fp: string | null;
  }>(
    `MATCH (:Screen {id: $start})-[e:NAVIGATES_TO]->(c:Screen)
     WHERE e.shared = true AND c.id <> $start
     MATCH (c)-[:FLOWS_TO]->(m:Screen) WHERE m.id <> $start
     RETURN DISTINCT c.id AS c, m.id AS m, m.fingerprint AS fp`,
    { start },
  );
  const byPage = new Map<
    string,
    {
      members: Set<string>;
      templates: Map<string, number>;
    }
  >();
  for (const r of rows) {
    const page = byPage.get(r.c) ?? {
      members: new Set<string>(),
      templates: new Map<string, number>(),
    };
    page.members.add(r.m);
    page.templates.set(r.fp ?? '', (page.templates.get(r.fp ?? '') ?? 0) + 1);
    byPage.set(r.c, page);
  }
  const menu = [...byPage]
    .filter(([, p]) => Math.max(...p.templates.values()) >= 2)
    .map(([id, p]) => ({ id, members: [...p.members] }));
  const categories = menu.map((m) => m.id).sort();
  const of = new Map<string, string[]>();
  for (const c of categories) of.set(c, [c]);
  for (const m of menu)
    for (const s of m.members)
      if (!categories.includes(s)) of.set(s, [...(of.get(s) ?? []), m.id].sort());
  return { categories, of };
}
