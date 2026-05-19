import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  makeAdtRequestWithTimeout,
  return_error,
  return_response,
} from '../../../lib/utils';

export const TOOL_DEFINITION = {
  name: 'GetAtcWorklist',
  available_in: ['onprem'] as const,
  description:
    '[read-only] Fetch the contents (findings, status, scope) of an ATC worklist via GET /sap/bc/adt/atc/worklists/{worklist_id}. This is the canonical way to read the result of a run started by RunAtc — pass the worklist_id RunAtc returned. By default returns the full ATC worklist XML; set timestamp to only fetch entries changed after a given epoch ms (for polling).',
  inputSchema: {
    type: 'object',
    properties: {
      worklist_id: {
        type: 'string',
        description:
          'Worklist id returned by RunAtc (e.g. 0213E9106CB21FD194E9A539E95CC153).',
      },
      include_exempted: {
        type: 'boolean',
        description:
          'Include exempted findings in the response. Defaults to false.',
        default: false,
      },
      timestamp: {
        type: 'number',
        description:
          'Optional epoch-ms threshold; only findings updated after this time are returned. Useful when polling.',
      },
    },
    required: ['worklist_id'],
  },
} as const;

interface GetAtcWorklistArgs {
  worklist_id: string;
  include_exempted?: boolean;
  timestamp?: number;
}

export async function handleGetAtcWorklist(
  context: HandlerContext,
  args: GetAtcWorklistArgs,
) {
  const { connection, logger } = context;
  try {
    const worklistId = args?.worklist_id?.trim();
    if (!worklistId) {
      throw new Error('worklist_id is required');
    }

    const query: Record<string, string> = {
      includeExemptedFindings: String(args.include_exempted === true),
    };
    if (typeof args.timestamp === 'number') {
      query.timestamp = String(args.timestamp);
    }
    const qs = new URLSearchParams(query).toString();

    logger?.debug(`GetAtcWorklist GET worklist_id=${worklistId}`);
    const response = await makeAdtRequestWithTimeout(
      connection,
      `/sap/bc/adt/atc/worklists/${encodeURIComponent(worklistId)}?${qs}`,
      'GET',
      'long',
      undefined,
      undefined,
      {
        Accept:
          'application/atc.worklist.v1+xml, application/xml, text/xml;q=0.5',
      },
    );

    const data = response.data;
    const text =
      typeof data === 'string' ? data : JSON.stringify(data, null, 2);

    return return_response({
      ...response,
      data: text,
    });
  } catch (error: any) {
    logger?.error('Error reading ATC worklist:', error);
    return return_error(error);
  }
}
