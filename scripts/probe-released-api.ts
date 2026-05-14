/**
 * Smoke check for the GetReleasedApi MCP handler. Calls the handler in-process
 * using a real AbapConnection loaded from an .env file.
 *
 * Usage:
 *   npx tsx scripts/probe-released-api.ts --env ha3.env
 */
import * as path from 'node:path';
import { createAbapConnection } from '@mcp-abap-adt/connection';
import * as dotenv from 'dotenv';
import { getSapConfigFromEnv } from '../src/__tests__/integration/helpers/configHelpers';
import { handleGetReleasedApi } from '../src/handlers/released_api/readonly/handleGetReleasedApi';

async function main() {
  const args = process.argv.slice(2);
  const get = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const envFile = path.resolve(
    get('--env') || path.join(__dirname, '..', 'ha3.env'),
  );
  dotenv.config({ path: envFile, override: true });
  console.log(`env: ${envFile}`);

  const connection = createAbapConnection(getSapConfigFromEnv()) as any;

  const logger = {
    info: (...a: any[]) => console.log('[info]', ...a),
    warn: (...a: any[]) => console.warn('[warn]', ...a),
    error: (...a: any[]) => console.error('[error]', ...a),
    debug: (...a: any[]) => console.log('[debug]', ...a),
  };

  const cases: { label: string; args: any }[] = [
    {
      label: 'happy path: MARA/MATNR, MARA/MTART, topN=10',
      args: {
        fields: [
          { tabname: 'MARA', fieldname: 'MATNR' },
          { tabname: 'MARA', fieldname: 'MTART' },
        ],
        topN: 10,
      },
    },
    {
      label: 'default topN (omitted) with single field',
      args: {
        fields: [{ tabname: 'MARA', fieldname: 'MATNR' }],
      },
    },
    {
      label: 'invalid: empty fields array — should fail validation',
      args: { fields: [] },
    },
    {
      label: 'invalid: missing fields — should fail validation',
      args: {},
    },
  ];

  for (const c of cases) {
    console.log(`\n--- ${c.label} ---`);
    console.log('args:', JSON.stringify(c.args));
    try {
      const result = await handleGetReleasedApi(
        { connection, logger } as any,
        c.args,
      );
      const text = result?.content?.[0]?.text ?? '';
      console.log('isError:', (result as any)?.isError ?? false);
      console.log('content (first 1500 chars):');
      console.log(text.slice(0, 1500));
    } catch (e: any) {
      console.error('threw:', e?.message ?? String(e));
    }
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
