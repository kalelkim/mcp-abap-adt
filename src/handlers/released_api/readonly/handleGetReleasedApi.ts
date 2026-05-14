import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  ErrorCode,
  McpError,
  makeAdtRequestWithTimeout,
  return_error,
  return_response,
} from '../../../lib/utils';

export const TOOL_DEFINITION = {
  name: 'GetReleasedApi',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description:
    '[read-only] Query released SAP APIs by table/field via custom ABAP endpoint POST /sap/bc/abap/ZADT/getreleasedapi. Sends a JSON payload with a list of (tabname, fieldname) pairs and an optional topN limit, and returns whatever the endpoint produces. Endpoint must be deployed on the target system (custom Z service).',
  inputSchema: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        description:
          'List of table/field pairs to query. Each entry: { tabname, fieldname }. Example: [{"tabname":"MARA","fieldname":"MATNR"}].',
        items: {
          type: 'object',
          properties: {
            tabname: {
              type: 'string',
              description: 'ABAP dictionary table name (e.g., MARA).',
            },
            fieldname: {
              type: 'string',
              description: 'Field name within the table (e.g., MATNR).',
            },
          },
          required: ['tabname', 'fieldname'],
        },
        minItems: 1,
      },
      topN: {
        type: 'number',
        description: 'Maximum number of results to return. Default: 10.',
        default: 10,
      },
    },
    required: ['fields'],
  },
} as const;

interface ReleasedApiField {
  tabname: string;
  fieldname: string;
}

interface GetReleasedApiArgs {
  fields: ReleasedApiField[];
  topN?: number;
}

const ENDPOINT_PATH = '/sap/bc/abap/ZADT/getreleasedapi';

export async function handleGetReleasedApi(
  context: HandlerContext,
  args: GetReleasedApiArgs,
) {
  const { connection, logger } = context;
  try {
    if (!args || !Array.isArray(args.fields) || args.fields.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'fields is required and must be a non-empty array of { tabname, fieldname } entries',
      );
    }

    for (const [i, f] of args.fields.entries()) {
      if (
        !f ||
        typeof f.tabname !== 'string' ||
        typeof f.fieldname !== 'string'
      ) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `fields[${i}] must have string tabname and fieldname`,
        );
      }
    }

    const topN =
      typeof args.topN === 'number' && args.topN > 0 ? args.topN : 10;

    const payload = {
      fields: args.fields.map((f) => ({
        tabname: f.tabname.toUpperCase(),
        fieldname: f.fieldname.toUpperCase(),
      })),
      topN,
    };

    logger?.debug(
      `GetReleasedApi POST ${ENDPOINT_PATH} fields=${payload.fields.length} topN=${topN}`,
    );

    const response = await makeAdtRequestWithTimeout(
      connection,
      ENDPOINT_PATH,
      'POST',
      'default',
      payload,
      undefined,
      {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    );

    logger?.debug(`GetReleasedApi response status: ${response.status}`);

    // Endpoint is custom; tolerate both JSON-object and raw-string responses.
    const data = response.data;
    const text =
      typeof data === 'string' ? data : JSON.stringify(data, null, 2);

    return return_response({
      ...response,
      data: text,
    });
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    logger?.error('GetReleasedApi failed', error as any);
    return return_error(error);
  }
}
