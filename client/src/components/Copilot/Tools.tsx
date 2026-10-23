import { useFrontendTool, useHumanInTheLoop } from '@copilotkit/react-core/v2';
import { tableSchema, choiceSchema } from './schemas';
import { TableCard, ChoiceCard } from './Cards';

export default function GenerativeTools() {
  useFrontendTool(
    {
      name: 'show_table',
      description:
        'Render a structured comparison or dataset as a table in the conversation. Each row must have one string cell per column. Do not invent live data.',
      parameters: tableSchema,
      handler: async () => ({ displayed: true }),
      render: ({ args }) => <TableCard args={args} />,
    },
    [],
  );
  useHumanInTheLoop(
    {
      name: 'choose_option',
      description:
        'Ask the user to select one option using interactive buttons. Wait for their decision.',
      parameters: choiceSchema,
      render: ({ args, respond }) => <ChoiceCard args={args} respond={respond} />,
    },
    [],
  );
  return null;
}
