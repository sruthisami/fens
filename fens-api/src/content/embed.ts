import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { closeDb, openFindingWriter, openGraph } from '../graph/db.js';
import { contentTexts, EMBEDDING_DIMENSION } from './similarity.js';
import { runWithContext, systemContext } from '../tenancy/context.js';
const BATCH = 20;
async function main(): Promise<void> {
  const i = process.argv.indexOf('--graph');
  const graph = i > 0 ? process.argv[i + 1] : undefined;
  if (!graph) throw new Error('Usage: npm run embed -- --graph <name>');
  if (!env.GEMINI_API_KEY) {
    console.log(
      'No GEMINI_API_KEY in fens-api/.env: embeddings skipped. similar_screens and ia_mismatch use word overlap instead.',
    );
    return;
  }
  const g = await openGraph(graph);
  const screens = await g.read<{
    id: string;
    title: string | null;
    text: string | null;
  }>('MATCH (s:Screen) RETURN s.id AS id, s.title AS title, s.text AS text ORDER BY id');
  const missingText = screens.filter((s) => !s.text).length;
  if (missingText)
    console.log(
      `${missingText} screens have no stored text (crawl again to store it); their title is used.`,
    );
  const texts = contentTexts(screens);
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const w = await openFindingWriter(graph);
  await w
    .write(
      `CREATE VECTOR INDEX FOR (s:Screen) ON (s.embedding) OPTIONS {dimension: ${EMBEDDING_DIMENSION}, similarityFunction: 'cosine'}`,
    )
    .catch(() => {});
  let done = 0;
  for (let b = 0; b < screens.length; b += BATCH) {
    const batch = screens.slice(b, b + BATCH);
    const res = await ai.models.embedContent({
      model: env.GEMINI_EMBEDDING_MODEL,
      contents: batch.map((s) => (texts.get(s.id) || s.id).slice(0, 8000)),
      config: { outputDimensionality: EMBEDDING_DIMENSION, taskType: 'SEMANTIC_SIMILARITY' },
    });
    const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
    if (vectors.length !== batch.length)
      throw new Error('Gemini returned fewer embeddings than requested');
    await w.write(
      `UNWIND $rows AS r MATCH (s:Screen {id: r.id})
       SET s.embedding = vecf32(r.v), s.embedding_model = $model`,
      {
        rows: batch.map((s, k) => ({ id: s.id, v: vectors[k] })),
        model: env.GEMINI_EMBEDDING_MODEL,
      },
    );
    done += batch.length;
  }
  console.log(
    `Embedded ${done} screens of ${graph} with ${env.GEMINI_EMBEDDING_MODEL} (${EMBEDDING_DIMENSION} dimensions, cosine vector index).`,
  );
}
runWithContext(systemContext(), main)
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message.slice(0, 300) : err);
    process.exitCode = 1;
  })
  .finally(() => void closeDb());
