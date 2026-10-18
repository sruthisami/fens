import { FalkorDB } from 'falkordb';
import { env } from '../config/env.js';
export async function connect(): Promise<FalkorDB> {
  try {
    return await FalkorDB.connect({ url: env.FALKORDB_URL });
  } catch (err) {
    throw new Error(
      `Could not connect to FalkorDB (FALKORDB_URL). Is it running? Try: cd ../fens-api && docker compose up -d. (${(err as Error).message})`,
    );
  }
}
