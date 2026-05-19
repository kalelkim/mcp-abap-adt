import { AdtRuntimeClient } from '@mcp-abap-adt/adt-clients';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import { return_error, return_response } from '../../../lib/utils';

export const TOOL_DEFINITION = {
  name: 'GetAtcCheckFailureLogs',
  available_in: ['onprem'] as const,
  description:
    '[read-only] Fetch ABAP Test Cockpit (ATC) check failure logs via GET /sap/bc/adt/atc/checkfailures/logs. All filters are optional; pass display_id (the run id returned by RunAtc) to scope the response to a specific run. Returns the raw ATC XML payload.',
  inputSchema: {
    type: 'object',
    properties: {
      display_id: {
        type: 'string',
        description:
          'Run / display ID. Pass the value returned by RunAtc to filter findings for that run.',
      },
      obj_name: {
        type: 'string',
        description: 'Filter findings by object name (e.g. ZCL_FOO).',
      },
      obj_type: {
        type: 'string',
        description: 'Filter findings by object type (e.g. CLAS, PROG).',
      },
      module_id: {
        type: 'string',
        description: 'Filter findings by ATC module id.',
      },
      phase_key: {
        type: 'string',
        description: 'Filter findings by ATC phase key.',
      },
    },
  },
} as const;

interface GetAtcCheckFailureLogsArgs {
  display_id?: string;
  obj_name?: string;
  obj_type?: string;
  module_id?: string;
  phase_key?: string;
}

export async function handleGetAtcCheckFailureLogs(
  context: HandlerContext,
  args: GetAtcCheckFailureLogsArgs,
) {
  const { connection, logger } = context;
  try {
    const options = {
      displayId: args?.display_id,
      objName: args?.obj_name,
      objType: args?.obj_type,
      moduleId: args?.module_id,
      phaseKey: args?.phase_key,
    };

    const runtimeClient = new AdtRuntimeClient(connection, logger);
    const response = await runtimeClient
      .getAtcLog()
      .getCheckFailureLogs(options);

    const data = response.data;
    const text =
      typeof data === 'string' ? data : JSON.stringify(data, null, 2);

    return return_response({
      ...response,
      data: text,
    });
  } catch (error: any) {
    logger?.error('Error reading ATC check failure logs:', error);
    return return_error(error);
  }
}
