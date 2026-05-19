import { AdtRuntimeClient } from '@mcp-abap-adt/adt-clients';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import { return_error, return_response } from '../../../lib/utils';

export const TOOL_DEFINITION = {
  name: 'GetAtcExecutionLog',
  available_in: ['onprem'] as const,
  description:
    '[read-only] Fetch the execution log of a specific ABAP Test Cockpit (ATC) run via GET /sap/bc/adt/atc/results/{execution_id}/log. Returns the raw ATC XML payload describing run phases, durations, and errors.',
  inputSchema: {
    type: 'object',
    properties: {
      execution_id: {
        type: 'string',
        description:
          'ATC execution / run id. Use the id returned by RunAtc, or one taken from a check-failure-logs entry.',
      },
    },
    required: ['execution_id'],
  },
} as const;

interface GetAtcExecutionLogArgs {
  execution_id: string;
}

export async function handleGetAtcExecutionLog(
  context: HandlerContext,
  args: GetAtcExecutionLogArgs,
) {
  const { connection, logger } = context;
  try {
    const executionId = args?.execution_id?.trim();
    if (!executionId) {
      throw new Error('execution_id is required');
    }

    const runtimeClient = new AdtRuntimeClient(connection, logger);
    const response = await runtimeClient
      .getAtcLog()
      .getExecutionLog(executionId);

    const data = response.data;
    const text =
      typeof data === 'string' ? data : JSON.stringify(data, null, 2);

    return return_response({
      ...response,
      data: text,
    });
  } catch (error: any) {
    logger?.error('Error reading ATC execution log:', error);
    return return_error(error);
  }
}
