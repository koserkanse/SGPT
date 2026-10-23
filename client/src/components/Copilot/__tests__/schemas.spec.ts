import { of } from 'rxjs';
import { AbstractAgent, CopilotKitCore, EventType } from '@copilotkit/react-core/v2';
import type { RunAgentInput } from '@copilotkit/react-core/v2';
import { tableSchema, choiceSchema, reviewSchema, actionSchema } from '../schemas';

test('the real SDK sends structured frontend tool fields to the runtime', async () => {
  let tools: RunAgentInput['tools'] = [];
  class FixtureAgent extends AbstractAgent {
    run(input: RunAgentInput) {
      tools = input.tools;
      return of(
        { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId },
        { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId },
      );
    }
  }
  const agent = new FixtureAgent({ agentId: 'fixture' });
  const core = new CopilotKitCore({});
  core.addAgent__unsafe_dev_only({ id: 'fixture', agent });
  const handler = async () => ({ displayed: true });
  core.addTool({ name: 'show_table', parameters: tableSchema, handler });
  core.addTool({ name: 'choose_option', parameters: choiceSchema, handler });
  core.addTool({ name: 'review', parameters: reviewSchema, handler });
  core.addTool({ name: 'action', parameters: actionSchema, handler });
  await core.runAgent({ agent });
  expect(tools).toHaveLength(4);
  const schemas = Object.fromEntries(tools.map((tool) => [tool.name, tool.parameters]));
  expect(schemas.show_table).toMatchObject({
    type: 'object',
    required: ['title', 'columns', 'rows'],
    properties: {
      rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    },
  });
  expect(schemas.choose_option).toMatchObject({ required: ['title', 'options'] });
  expect(schemas.review).toMatchObject({ required: ['title', 'content', 'spaceId'] });
  expect(schemas.action).toMatchObject({ required: ['approvalId', 'summary'] });
});
