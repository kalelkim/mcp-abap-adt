import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  ErrorCode,
  McpError,
  makeAdtRequestWithTimeout,
  return_error,
  return_response,
} from '../../../lib/utils';

export const TOOL_DEFINITION = {
  name: 'GetReleasedApiRich',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description:
    '[read-only] Day 62 variant of GetReleasedApi. Same endpoint POST /sap/bc/abap/ZADT/getreleasedapi, same (tabname, fieldname) input, but sends richMetadata=true in the body so the ABAP class ZCL_ZADT_GETRELEASEDAPI returns the v6 payload — each match carries application_component (TADIR.DEVCLASS), api_release_state (ARS_W_API_STATE.release_state for compatibility_contract=C1) and successor_chain (recursive ARS_W_API_STATE successor walk, depth≤5). The LLM judge consumes this payload to disambiguate polymorphic tables (AUFK→PM/PP/CO orders) and follow deprecation chains.',
  inputSchema: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        description:
          'List of table/field pairs to query. Each entry: { tabname, fieldname }. Example: [{"tabname":"AUFK","fieldname":"AUFNR"}].',
        items: {
          type: 'object',
          properties: {
            tabname: {
              type: 'string',
              description: 'ABAP dictionary table name (e.g., AUFK).',
            },
            fieldname: {
              type: 'string',
              description: 'Field name within the table (e.g., AUFNR).',
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

interface GetReleasedApiRichArgs {
  fields: ReleasedApiField[];
  topN?: number;
}

const ENDPOINT_PATH = '/sap/bc/abap/ZADT/getreleasedapi';

export async function handleGetReleasedApiRich(
  context: HandlerContext,
  args: GetReleasedApiRichArgs,
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

    // Same endpoint as GetReleasedApi — the ABAP class branches on
    // richMetadata=true in the request body to produce the v6 response
    // (ty_response_rich). The legacy strict response is unchanged.
    const payload = {
      fields: args.fields.map((f) => ({
        tabname: f.tabname.toUpperCase(),
        fieldname: f.fieldname.toUpperCase(),
      })),
      topN,
      richMetadata: true,
    };

    logger?.debug(
      `GetReleasedApiRich POST ${ENDPOINT_PATH} fields=${payload.fields.length} topN=${topN}`,
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

    logger?.debug(`GetReleasedApiRich response status: ${response.status}`);

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
    logger?.error('GetReleasedApiRich failed', error as any);
    return return_error(error);
  }
}
