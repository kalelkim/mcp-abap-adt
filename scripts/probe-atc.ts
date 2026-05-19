/**
 * Smoke check for the ATC MCP handlers (RunAtc, GetAtcCheckFailureLogs,
 * GetAtcExecutionLog). Calls each handler in-process against a real
 * AbapConnection loaded from an .env file.
 *
 * Usage:
 *   npx tsx scripts/probe-atc.ts --env ha3.env --uri /sap/bc/adt/oo/classes/ZCL_FOO --type CLAS/OC
 *   npx tsx scripts/probe-atc.ts --env ha3.env --variant DEFAULT --uri ... --type ...
 *
 * The probe is intentionally narrow — one object per run — so we can inspect
 * the raw worklist / run / log responses and lock down the parser before any
 * broader integration test is added.
 */
import * as path from 'node:path';
import { createAbapConnection } from '@mcp-abap-adt/connection';
import * as dotenv from 'dotenv';
import { getSapConfigFromEnv } from '../src/__tests__/integration/helpers/configHelpers';
import { handleGetAtcCheckFailureLogs } from '../src/handlers/system/readonly/handleGetAtcCheckFailureLogs';
import { handleGetAtcExecutionLog } from '../src/handlers/system/readonly/handleGetAtcExecutionLog';
import { handleGetAtcWorklist } from '../src/handlers/system/readonly/handleGetAtcWorklist';
import { handleRunAtc } from '../src/handlers/system/readonly/handleRunAtc';

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

  const uri = get('--uri') ?? '/sap/bc/adt/oo/classes/ZCL_ZADT_GETRELEASEDAPI';
  const type = get('--type') ?? 'CLAS/OC';
  const variant = get('--variant') ?? 'DEFAULT';

  const connection = createAbapConnection(getSapConfigFromEnv()) as any;
  const logger = {
    info: (...a: any[]) => console.log('[info]', ...a),
    warn: (...a: any[]) => console.warn('[warn]', ...a),
    error: (...a: any[]) => console.error('[error]', ...a),
    debug: (...a: any[]) => console.log('[debug]', ...a),
  };
  const ctx = { connection, logger } as any;

  const dump = (label: string, result: any) => {
    const text = result?.content?.[0]?.text ?? '';
    console.log(`\n--- ${label} ---`);
    console.log('isError:', result?.isError ?? false);
    console.log(text.slice(0, 2500));
  };

  // Step 1 — start a run.
  console.log(
    `\n=== RunAtc variant=${variant} uri=${uri} type=${type} ===`,
  );
  const runResult = await handleRunAtc(ctx, {
    objects: [{ uri, type }],
    check_variant: variant,
    maximum_verdicts: 50,
  });
  dump('RunAtc', runResult);

  // Best-effort parse of the run response so we can chain the read calls.
  let worklistId: string | undefined;
  let runId: string | undefined;
  try {
    const parsed = JSON.parse(runResult?.content?.[0]?.text ?? '{}');
    worklistId = parsed.worklist_id;
    runId = parsed.run_id;
  } catch {
    /* leave undefined; subsequent steps will be skipped */
  }

  if (!worklistId) {
    console.error('No worklist_id in RunAtc response — aborting probe.');
    process.exit(1);
  }

  // Give SAP a few seconds to actually finish the check before polling.
  await new Promise((r) => setTimeout(r, 5000));

  // Step 2 — canonical worklist read (this is where the findings live).
  const worklist = await handleGetAtcWorklist(ctx, {
    worklist_id: worklistId,
    include_exempted: false,
  });
  dump(`GetAtcWorklist worklist_id=${worklistId}`, worklist);

  // Step 3 — failure logs (separate ATC Result Browser feature; displayId is
  // a different concept than worklist id, so this often returns empty unless
  // the run was saved as a named result).
  const failures = await handleGetAtcCheckFailureLogs(ctx, {
    display_id: worklistId,
  });
  dump(`GetAtcCheckFailureLogs display_id=${worklistId}`, failures);

  // Step 4 — execution log (only works when SAP returned a separate
  // execution id; for run-time errors during the run itself).
  if (runId) {
    const execLog = await handleGetAtcExecutionLog(ctx, {
      execution_id: runId,
    });
    dump(`GetAtcExecutionLog execution_id=${runId}`, execLog);
  }

  // Sanity — validation paths.
  console.log('\n=== validation: missing objects ===');
  dump('RunAtc (no objects)', await handleRunAtc(ctx, {} as any));
  console.log('\n=== validation: missing execution_id ===');
  dump(
    'GetAtcExecutionLog (no id)',
    await handleGetAtcExecutionLog(ctx, {} as any),
  );
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
