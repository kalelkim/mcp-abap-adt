import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  type AxiosResponse,
  makeAdtRequestWithTimeout,
  return_error,
  return_response,
} from '../../../lib/utils';

export const TOOL_DEFINITION = {
  name: 'RunAtc',
  available_in: ['onprem'] as const,
  description:
    '[run] Start an ABAP Test Cockpit (ATC) check on the given ADT object URIs. Two-step ADT flow: POST /sap/bc/adt/atc/worklists?checkVariant=<variant> to create a worklist, then POST /sap/bc/adt/atc/runs?worklistId=<id> with an object-set XML body to trigger the run. Returns the worklist_id; read findings via GetAtcWorklist with worklist_id=<id>. GetAtcCheckFailureLogs is a separate ATC Result Browser feature (named/saved runs only) and will usually return empty for ad-hoc RunAtc runs.',
  inputSchema: {
    type: 'object',
    properties: {
      objects: {
        type: 'array',
        minItems: 1,
        description:
          "ABAP objects to check. Each entry needs an ADT URI (uri) and the matching ADT type token (type) — both are required because SAP's object reference XML expects adtcore:uri AND adtcore:type.",
        items: {
          type: 'object',
          properties: {
            uri: {
              type: 'string',
              description:
                'ADT object URI, e.g. /sap/bc/adt/oo/classes/ZCL_FOO or /sap/bc/adt/programs/programs/Z_MY_PROG.',
            },
            type: {
              type: 'string',
              description:
                'ADT type token matching the URI, e.g. CLAS/OC, PROG/P, FUGR/F, DDLS/DF. Use the same value the ADT object-info endpoint returns.',
            },
          },
          required: ['uri', 'type'],
        },
      },
      check_variant: {
        type: 'string',
        description:
          'Name of the ATC check variant configured on the SAP system. Defaults to DEFAULT.',
        default: 'DEFAULT',
      },
      maximum_verdicts: {
        type: 'number',
        description:
          'Optional cap on number of findings collected. Defaults to 100.',
        default: 100,
      },
    },
    required: ['objects'],
  },
} as const;

interface RunAtcArgs {
  objects: Array<{ uri: string; type: string }>;
  check_variant?: string;
  maximum_verdicts?: number;
}

const escapeXmlAttr = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const buildRunBody = (
  objects: Array<{ uri: string; type: string }>,
  maximumVerdicts: number,
): string => {
  const refs = objects
    .map(
      (o) =>
        `      <adtcore:objectReference adtcore:uri="${escapeXmlAttr(o.uri)}" adtcore:type="${escapeXmlAttr(o.type)}"/>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<atc:run xmlns:atc="http://www.sap.com/adt/atc" xmlns:adtcore="http://www.sap.com/adt/core" maximumVerdicts="${maximumVerdicts}">
  <objectSets>
    <objectSet kind="inclusive">
      <adtcore:objectReferences>
${refs}
      </adtcore:objectReferences>
    </objectSet>
  </objectSets>
</atc:run>`;
};

// Worklist id can come back either as the raw text body (UUID-like) or in
// the Location header (.../atc/worklists/<id>). Try body first, header next.
const extractWorklistId = (response: AxiosResponse): string | undefined => {
  const data = response.data;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed.length > 0 && trimmed.length < 200 && !trimmed.includes('<')) {
      return trimmed;
    }
  }
  const headers: any = response.headers ?? {};
  const location =
    headers.location ?? headers.Location ?? headers['content-location'];
  if (typeof location === 'string') {
    const match = location.match(/\/worklists\/([^/?#]+)/);
    if (match) return match[1];
  }
  return undefined;
};

// Run response is XML; the run id (when separately returned) usually appears
// as an attribute named id / atc:id on the root, or as a worklistId element.
const extractRunId = (response: AxiosResponse): string | undefined => {
  const data = response.data;
  if (typeof data !== 'string') return undefined;
  const idAttr = data.match(/\b(?:atc:)?id="([^"]+)"/);
  if (idAttr) return idAttr[1];
  const worklistAttr = data.match(/worklistId="([^"]+)"/);
  if (worklistAttr) return worklistAttr[1];
  return undefined;
};

export async function handleRunAtc(context: HandlerContext, args: RunAtcArgs) {
  const { connection, logger } = context;
  try {
    if (!args || !Array.isArray(args.objects) || args.objects.length === 0) {
      throw new Error(
        'objects is required and must be a non-empty array of { uri, type } entries',
      );
    }
    for (const [i, o] of args.objects.entries()) {
      if (!o || typeof o.uri !== 'string' || typeof o.type !== 'string') {
        throw new Error(
          `objects[${i}] must have string uri and type (e.g. { uri: '/sap/bc/adt/oo/classes/ZCL_FOO', type: 'CLAS/OC' })`,
        );
      }
    }

    const checkVariant = (args.check_variant ?? 'DEFAULT').trim();
    const maximumVerdicts =
      typeof args.maximum_verdicts === 'number' && args.maximum_verdicts > 0
        ? args.maximum_verdicts
        : 100;

    // Step 1 — create worklist.
    logger?.debug(`RunAtc: creating worklist for variant=${checkVariant}`);
    const worklistResponse = await makeAdtRequestWithTimeout(
      connection,
      `/sap/bc/adt/atc/worklists?checkVariant=${encodeURIComponent(checkVariant)}`,
      'POST',
      'long',
      undefined,
      undefined,
      {
        Accept: 'text/plain',
      },
    );
    const worklistId = extractWorklistId(worklistResponse);
    if (!worklistId) {
      throw new Error(
        `Failed to obtain worklist id from POST /sap/bc/adt/atc/worklists. status=${worklistResponse.status} body=${String(worklistResponse.data).slice(0, 300)}`,
      );
    }
    logger?.debug(`RunAtc: worklist_id=${worklistId}`);

    // Step 2 — trigger the run against the worklist.
    const body = buildRunBody(args.objects, maximumVerdicts);
    const runResponse = await makeAdtRequestWithTimeout(
      connection,
      `/sap/bc/adt/atc/runs?worklistId=${encodeURIComponent(worklistId)}`,
      'POST',
      'long',
      body,
      undefined,
      {
        'Content-Type': 'application/xml',
        Accept: 'application/xml',
      },
    );
    const runId = extractRunId(runResponse) ?? worklistId;
    logger?.info(
      `RunAtc: started. worklist_id=${worklistId} run_id=${runId} status=${runResponse.status}`,
    );

    return return_response({
      data: JSON.stringify(
        {
          success: true,
          worklist_id: worklistId,
          run_id: runId,
          check_variant: checkVariant,
          message: `ATC run started. Use GetAtcWorklist with worklist_id=${worklistId} to fetch findings.`,
        },
        null,
        2,
      ),
      status: runResponse.status,
      statusText: runResponse.statusText,
      headers: runResponse.headers,
      config: runResponse.config,
    } as AxiosResponse);
  } catch (error: any) {
    logger?.error('Error starting ATC run:', error);
    return return_error(error);
  }
}
