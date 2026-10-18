import { env } from '../config/env.js';
import { checkLinear, linearClient, linearHttpError, writeTest } from './linear.js';
async function main(): Promise<number> {
  if (!env.LINEAR_API_KEY) {
    console.log(
      'LINEAR_API_KEY is not set in fens-api/.env. Create a personal API key in Linear (Settings, Security & access, Personal API keys) and add it.',
    );
    return 1;
  }
  const client = linearClient();
  const report = await checkLinear(client, env.LINEAR_TEAM_ID);
  for (const line of report.lines) console.log(line);
  if (!process.argv.includes('--write-test')) {
    console.log('No writes made (add -- --write-test to create and delete a test issue).');
    return report.ok ? 0 : 1;
  }
  if (!report.team) {
    console.log('Write test skipped: LINEAR_TEAM_ID must match a team first.');
    return 1;
  }
  for (const line of await writeTest(client, report.team.id)) console.log(line);
  return 0;
}
main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(linearHttpError(err, 'checking the setup').message);
    process.exit(1);
  });
