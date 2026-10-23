import { useEffect, useId, useState } from 'react';
import { Button } from '@librechat/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataService, MutationKeys, QueryKeys } from 'librechat-data-provider';
import type { DotWorkspace } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

export default function Models({
  dot,
  userId,
}: {
  dot: DotWorkspace['dots'][number];
  userId: string;
}) {
  const localize = useLocalize();
  const id = useId();
  const [opened, setOpened] = useState(false);
  const client = useQueryClient();
  const [connectionId, setConnectionId] = useState(dot.modelConnectionId ?? '');
  const [modelId, setModelId] = useState(dot.modelId ?? '');
  const connections = useQuery({
    queryKey: [QueryKeys.dotModels, userId],
    queryFn: dataService.getDotModels,
    enabled: opened,
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    setConnectionId(dot.modelConnectionId ?? '');
    setModelId(dot.modelId ?? '');
  }, [dot.modelConnectionId, dot.modelId]);
  const save = useMutation(dataService.setDotModel, {
    mutationKey: [MutationKeys.dotModel, userId, dot.id],
    onSuccess: () => {
      void client.invalidateQueries([QueryKeys.dotWorkspace, userId]);
    },
  });
  const selected = connections.data?.find((item) => item.id === connectionId);
  return (
    <details
      className="space-y-2 text-sm"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary className="cursor-pointer">{localize('com_copilot_model_settings')}</summary>
      <p className="text-text-secondary">{localize('com_copilot_model_help')}</p>
      {connections.isLoading && <p role="status">{localize('com_copilot_loading')}</p>}
      {connections.isError && (
        <div role="alert">
          <p>{localize('com_copilot_model_load_error')}</p>
          <Button size="sm" onClick={() => void connections.refetch()}>
            {localize('com_ui_retry')}
          </Button>
        </div>
      )}
      {connections.data && (
        <>
          <label className="block" htmlFor={`${id}-connection`}>
            {localize('com_copilot_model_connection')}
          </label>
          <select
            id={`${id}-connection`}
            className="bg-surface-primary border-border-light w-full rounded border p-2"
            value={connectionId}
            disabled={save.isLoading}
            onChange={(event) => {
              setConnectionId(event.target.value);
              setModelId(
                connections.data.find((item) => item.id === event.target.value)?.models[0] ?? '',
              );
              save.reset();
            }}
          >
            <option value="">{localize('com_copilot_model_default')}</option>
            {connectionId && !selected && (
              <option value={connectionId}>{localize('com_copilot_model_unavailable')}</option>
            )}
            {connections.data.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.ready}>
                {item.name} —{' '}
                {localize(
                  (
                    {
                      local: 'com_copilot_model_local',
                      remote: 'com_copilot_model_remote',
                      default: 'com_copilot_model_default',
                    } as const
                  )[item.location],
                )}
                {!item.ready ? ` (${localize('com_copilot_model_unavailable')})` : ''}
              </option>
            ))}
          </select>
          {connectionId && (
            <>
              <label className="block" htmlFor={`${id}-model`}>
                {localize('com_copilot_model_name')}
              </label>
              <select
                id={`${id}-model`}
                className="bg-surface-primary border-border-light w-full rounded border p-2"
                value={modelId}
                disabled={save.isLoading}
                onChange={(event) => {
                  setModelId(event.target.value);
                  save.reset();
                }}
              >
                {!selected?.models.includes(modelId) && (
                  <option value={modelId}>{localize('com_copilot_model_unavailable')}</option>
                )}
                {selected?.models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={
              save.isLoading ||
              (!!connectionId && (!selected?.ready || !selected.models.includes(modelId)))
            }
            onClick={() =>
              save.mutate({
                id: dot.id,
                modelConnectionId: connectionId || null,
                modelId: connectionId ? modelId : null,
              })
            }
          >
            {localize(save.isLoading ? 'com_copilot_model_saving' : 'com_ui_save')}
          </Button>
        </>
      )}
      {save.isError && <p role="alert">{localize('com_copilot_model_save_error')}</p>}
      {save.isSuccess && <p role="status">{localize('com_copilot_model_saved')}</p>}
    </details>
  );
}
