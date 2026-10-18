import { env } from '../config/env.js';
import { ensureLabels, LABELS, linearClient, linearHttpError } from './linear.js';
async function main(): Promise<number> {
  if (!env.LINEAR_API_KEY || !env.LINEAR_TEAM_ID) {
    console.log(
      'Set LINEAR_API_KEY and LINEAR_TEAM_ID in fens-api/.env first (npm run linear:check lists the team ids).',
    );
    return 1;
  }
  const { created, existing } = await ensureLabels(linearClient(), env.LINEAR_TEAM_ID);
  console.log(`Labels for team ${env.LINEAR_TEAM_ID}: ${LABELS.map((l) => l.name).join(', ')}`);
  console.log(`  created: ${created.length ? created.join(', ') : 'none'}`);
  console.log(`  already there: ${existing.length ? existing.join(', ') : 'none'}`);
  return 0;
}
main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(linearHttpError(err, 'setting up the labels').message);
    process.exit(1);
  });
