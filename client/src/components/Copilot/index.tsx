import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { useAuthContext, useLocalize } from '~/hooks';
import { useCopilotStatus } from './api';
import Evolution from './Evolution';
import Chat from './Chat';

function Dots({
  token,
  userId,
  generativeUI,
}: {
  token: string;
  userId: string;
  generativeUI: boolean;
}) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const selected = search.get('thread');
  const workspace = useQuery({
    queryKey: [QueryKeys.dotWorkspace, userId],
    queryFn: dataService.getDotWorkspace,
    retry: false,
  });
  const create = useMutation(dataService.createDotConversation, {
    onSuccess: (thread) => {
      void queryClient.invalidateQueries([QueryKeys.dotWorkspace, userId]);
      setSearch({ mode: 'dots', thread: thread.id });
    },
  });
  const thread = workspace.data?.conversations.find((value) => value.id === selected);
  const dot = workspace.data?.dots.find((value) => value.id === thread?.dotId);
  if (workspace.isLoading)
    return (
      <div role="status" className="p-6">
        <Spinner />
        <span className="sr-only">{localize('com_copilot_loading')}</span>
      </div>
    );
  if (workspace.isError)
    return (
      <div className="space-y-3 p-6" role="alert">
        <p>{localize('com_copilot_dots_error')}</p>
        <Button onClick={() => void workspace.refetch()}>{localize('com_ui_retry')}</Button>
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside
        className="border-border-light max-h-64 w-full shrink-0 space-y-4 overflow-y-auto border-b p-4 md:max-h-none md:w-64 md:border-r md:border-b-0"
        aria-label={localize('com_copilot_dots')}
      >
        {workspace.data?.setup.missing.length ? (
          <p role="status" className="text-text-secondary text-sm">
            {localize('com_copilot_dots_setup')}
          </p>
        ) : null}
        {workspace.data?.dots.length === 0 && <p>{localize('com_copilot_no_dots')}</p>}
        {workspace.data?.dots.map((item) => (
          <div key={item.id} className="space-y-2">
            <h2 className="font-semibold">{item.name}</h2>
            <Button
              variant="outline"
              size="sm"
              disabled={create.isLoading || !!workspace.data?.setup.missing.length}
              onClick={() => create.mutate(item.id)}
            >
              {localize('com_copilot_new_chat')}
            </Button>
            {workspace.data?.conversations
              .filter((value) => value.dotId === item.id)
              .map((conversation) => (
                <Button
                  key={conversation.id}
                  variant="nav"
                  className="w-full justify-start"
                  aria-pressed={conversation.id === selected}
                  onClick={() => setSearch({ mode: 'dots', thread: conversation.id })}
                >
                  <span className="truncate">{conversation.title}</span>
                </Button>
              ))}
          </div>
        ))}
        {create.isError && <p role="alert">{localize('com_copilot_error')}</p>}
      </aside>
      {thread && dot ? (
        <Chat
          key={thread.id}
          token={token}
          threadId={thread.id}
          dotId={dot.id}
          generativeUI={generativeUI}
        />
      ) : (
        <p className="text-text-secondary m-auto max-w-lg p-6">
          {localize('com_copilot_select_dot')}
        </p>
      )}
    </div>
  );
}

export default function Copilot() {
  const localize = useLocalize();
  const { token, user } = useAuthContext();
  const status = useCopilotStatus();
  const [search, setSearch] = useSearchParams();
  const [session, setSession] = useState(() => crypto.randomUUID());
  const dots = search.get('mode') === 'dots';
  const evolution = search.get('mode') === 'evolution';
  if (status.isLoading)
    return (
      <div className="m-auto" role="status">
        <Spinner />
        <span className="sr-only">{localize('com_copilot_loading')}</span>
      </div>
    );
  if (status.isError)
    return (
      <div className="m-auto space-y-3 p-6" role="alert">
        <p>{localize('com_copilot_error')}</p>
        <Button onClick={() => void status.refetch()}>{localize('com_ui_retry')}</Button>
      </div>
    );
  if (!status.data?.enabled || !token || !user)
    return <p className="m-auto p-6">{localize('com_copilot_disabled')}</p>;
  let content;
  if (evolution && status.data.evolution) {
    content = <Evolution userId={user.id} />;
  } else if (evolution) {
    content = <p className="m-auto p-6">{localize('com_copilot_disabled')}</p>;
  } else if (dots && status.data.openDots) {
    content = <Dots token={token} userId={user.id} generativeUI={status.data.generativeUI} />;
  } else if (dots) {
    content = <p className="m-auto p-6">{localize('com_copilot_disabled')}</p>;
  } else if (status.data.ready) {
    content = (
      <Chat
        key={`${user.id}:${session}`}
        token={token}
        threadId={`${status.data.threadPrefix}${session}`}
        generativeUI={status.data.generativeUI}
      />
    );
  } else {
    content = (
      <div className="m-auto max-w-xl space-y-3 p-6">
        <h2 className="text-xl font-semibold">{localize('com_copilot_setup_title')}</h2>
        <p className="text-text-secondary">{localize('com_copilot_setup')}</p>
        <Button variant="outline" onClick={() => void status.refetch()}>
          {localize('com_ui_retry')}
        </Button>
      </div>
    );
  }
  return (
    <main className="bg-surface-primary text-text-primary flex h-full min-h-0 flex-col">
      <header className="border-border-light flex min-h-14 flex-wrap items-center gap-3 border-b px-4 py-2">
        <OpenSidebar className="size-9 shrink-0 md:hidden" />
        <h1 className="mr-auto text-lg font-semibold">{localize('com_copilot_title')}</h1>
        <Button
          variant={!dots && !evolution ? 'default' : 'outline'}
          aria-pressed={!dots && !evolution}
          onClick={() => setSearch({})}
        >
          {localize('com_copilot_title')}
        </Button>
        {status.data.openDots && (
          <Button
            variant={dots ? 'default' : 'outline'}
            aria-pressed={dots}
            onClick={() => setSearch({ mode: 'dots' })}
          >
            {localize('com_copilot_dots')}
          </Button>
        )}
        {status.data.evolution && (
          <Button
            variant={evolution ? 'default' : 'outline'}
            aria-pressed={evolution}
            onClick={() => setSearch({ mode: 'evolution' })}
          >
            {localize('com_evolution_title')}
          </Button>
        )}
        {!dots && !evolution && (
          <Button variant="outline" onClick={() => setSession(crypto.randomUUID())}>
            {localize('com_copilot_new_chat')}
          </Button>
        )}
      </header>
      {content}
    </main>
  );
}
