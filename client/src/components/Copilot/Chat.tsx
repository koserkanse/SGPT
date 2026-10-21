import { useState } from 'react';
import { Button } from '@librechat/client';
import { apiBaseUrl } from 'librechat-data-provider';
import { CopilotChat, CopilotKitProvider } from '@copilotkit/react-core/v2';
import GenerativeTools from './Tools';
import { useLocalize } from '~/hooks';
import DotTools from './DotTools';
import '@copilotkit/react-core/v2/styles.css';
import './theme.css';

export default function Chat({
  token,
  threadId,
  dotId,
  generativeUI,
}: {
  token: string;
  threadId: string;
  dotId?: string;
  generativeUI: boolean;
}) {
  const localize = useLocalize();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <div data-copilot-workspace className="flex min-h-0 flex-1 flex-col">
      {error && (
        <div
          role="alert"
          className="border-border-light flex items-center justify-between gap-3 border-b p-3"
        >
          <p>{localize('com_copilot_error')}</p>
          <Button
            variant="outline"
            onClick={() => {
              setError(false);
              setAttempt((value) => value + 1);
            }}
          >
            {localize('com_ui_retry')}
          </Button>
        </div>
      )}
      <CopilotKitProvider
        key={`${threadId}:${attempt}`}
        runtimeUrl={`${apiBaseUrl()}/api/copilot/${dotId ? 'dots/runtime' : 'runtime'}`}
        headers={{ Authorization: `Bearer ${token}` }}
        useSingleEndpoint={false}
        enableInspector={false}
        agentId={dotId ?? 'default'}
        openGenerativeUI={generativeUI ? {} : undefined}
        onError={() => setError(true)}
      >
        {generativeUI && <GenerativeTools />}
        {dotId && <DotTools threadId={threadId} />}
        <CopilotChat
          agentId={dotId ?? 'default'}
          threadId={threadId}
          className="h-full min-h-0 flex-1"
          labels={{
            chatInputPlaceholder: localize('com_copilot_placeholder'),
            welcomeMessageText: localize(dotId ? 'com_copilot_dot_welcome' : 'com_copilot_welcome'),
            chatDisclaimerText: localize(
              dotId ? 'com_copilot_dot_history' : 'com_copilot_session_history',
            ),
            assistantMessageToolbarCopyMessageLabel: localize('com_ui_copy'),
            assistantMessageToolbarCopyCodeLabel: localize('com_ui_copy'),
            assistantMessageToolbarCopyCodeCopiedLabel: localize('com_ui_copied'),
            userMessageToolbarCopyMessageLabel: localize('com_ui_copy'),
            userMessageToolbarEditMessageLabel: localize('com_ui_edit'),
            assistantMessageToolbarRegenerateLabel: localize('com_ui_retry'),
            modalHeaderTitle: localize('com_copilot_title'),
          }}
          onError={() => setError(true)}
        />
      </CopilotKitProvider>
    </div>
  );
}
