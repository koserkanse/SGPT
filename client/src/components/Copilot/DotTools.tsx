import { useState } from 'react';
import { Button } from '@librechat/client';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useHumanInTheLoop, useRenderTool } from '@copilotkit/react-core/v2';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DotDraft } from 'librechat-data-provider';
import { actionSchema, reviewSchema } from './schemas';
import { useLocalize } from '~/hooks';

type ReviewProps = {
  args: unknown;
  threadId: string;
  toolCallId: string;
  respond?: (value: unknown) => Promise<void>;
};

function ReviewCard({ args, threadId, toolCallId, respond }: ReviewProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const draft = reviewSchema.safeParse(args);
  const key = [QueryKeys.dotReview, threadId, toolCallId];
  const receipt = useQuery({
    queryKey: key,
    queryFn: () => dataService.getDotReview(threadId, toolCallId),
    retry: false,
  });
  const decision = useMutation(
    async (approved: boolean) => {
      if (!respond || !draft.success) return;
      setFailed(false);
      const previous = await dataService.getDotReview(threadId, toolCallId);
      const original = previous?.reviewDraft;
      if (
        original &&
        (original.title !== draft.data.title ||
          original.content !== draft.data.content ||
          original.spaceId !== draft.data.spaceId)
      )
        throw new Error('REVIEW_CONFLICT');
      if (!approved && !previous) {
        await respond({ approved: false, message: 'The owner declined. Do not save this draft.' });
        return;
      }
      const page = previous ?? (await dataService.saveDotReview(threadId, toolCallId, draft.data));
      queryClient.setQueryData(key, page);
      await respond({
        approved: true,
        pageId: page.id ?? page.pageId,
        spaceId: page.spaceId,
        deleted: page.deleted === true,
      });
    },
    { onError: () => setFailed(true) },
  );
  return (
    <section className="border-border-light my-3 space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">
        {draft.success ? draft.data.title : localize('com_copilot_preparing')}
      </h3>
      {draft.success && (
        <pre className="max-h-80 overflow-auto text-sm whitespace-pre-wrap">
          {draft.data.content}
        </pre>
      )}
      {(failed || receipt.isError) && <p role="alert">{localize('com_copilot_error')}</p>}
      {receipt.isError && (
        <Button variant="outline" onClick={() => void receipt.refetch()}>
          {localize('com_ui_retry')}
        </Button>
      )}
      <div className="flex gap-2">
        <Button
          disabled={!respond || !draft.success || !receipt.isSuccess || decision.isLoading}
          onClick={() => decision.mutate(true)}
        >
          {localize('com_copilot_approve_save')}
        </Button>
        <Button
          variant="outline"
          disabled={!respond || decision.isLoading || !receipt.isSuccess}
          onClick={() => decision.mutate(false)}
        >
          {localize('com_copilot_decline')}
        </Button>
      </div>
      {receipt.data && (
        <p role="status">
          {localize(receipt.data.deleted ? 'com_copilot_deleted' : 'com_copilot_saved')}
        </p>
      )}
    </section>
  );
}

function ActionCard({ args, threadId, toolCallId, respond }: ReviewProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const parsed = actionSchema.safeParse(args);
  const approvalId = parsed.success ? parsed.data.approvalId : '';
  const approval = useQuery({
    queryKey: [QueryKeys.dotApproval, threadId, approvalId],
    queryFn: () => dataService.getDotApproval(threadId, approvalId),
    enabled: !!approvalId,
    retry: false,
  });
  const key = [QueryKeys.dotActionReceipt, threadId, toolCallId];
  const receipt = useQuery({
    queryKey: key,
    queryFn: () => dataService.getDotActionReceipt(threadId, toolCallId),
    refetchInterval: (value) => (value?.status === 'running' ? 2000 : false),
    retry: false,
  });
  const decision = useMutation(async (approve: boolean) => {
    if (!respond) return;
    const prior = await dataService.getDotActionReceipt(threadId, toolCallId);
    if (prior && prior.approvalId !== approvalId) throw new Error('APPROVAL_CONFLICT');
    if (prior?.status === 'running') {
      await receipt.refetch();
      return;
    }
    if (!approve && !prior?.result) {
      await respond({
        approved: false,
        message: 'The owner declined. Do not perform this action.',
      });
      return;
    }
    const value =
      prior?.result ?? (await dataService.runDotAction(threadId, toolCallId, approvalId));
    queryClient.setQueryData(key, { approvalId, status: 'done', result: value });
    await respond({ approved: true, ...value });
  });
  const loading = decision.isLoading || receipt.data?.status === 'running';
  return (
    <section className="border-border-light my-3 space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">
        {approval.data
          ? `${approval.data.connection}: ${approval.data.title}`
          : localize('com_copilot_preparing')}
      </h3>
      {approval.data && (
        <>
          <p>{approval.data.description}</p>
          <pre className="max-h-64 overflow-auto text-sm whitespace-pre-wrap">
            {JSON.stringify(approval.data.arguments, null, 2)}
          </pre>
        </>
      )}
      {(approval.isError || receipt.isError || decision.isError) && (
        <p role="alert">{localize('com_copilot_error')}</p>
      )}
      {(approval.isError || receipt.isError) && (
        <Button
          variant="outline"
          onClick={() => {
            void approval.refetch();
            void receipt.refetch();
          }}
        >
          {localize('com_ui_retry')}
        </Button>
      )}
      <div className="flex gap-2">
        <Button
          disabled={
            !respond ||
            !approval.isSuccess ||
            !receipt.isSuccess ||
            loading ||
            (!receipt.data?.result && (approval.data?.expiresAt ?? 0) < Date.now())
          }
          onClick={() => decision.mutate(true)}
        >
          {localize('com_copilot_approve_run')}
        </Button>
        <Button
          variant="outline"
          disabled={!respond || loading}
          onClick={() => decision.mutate(false)}
        >
          {localize('com_copilot_decline')}
        </Button>
      </div>
      {receipt.data?.result && <p role="status">{receipt.data.result.text}</p>}
    </section>
  );
}

export default function DotTools({ threadId }: { threadId: string }) {
  useHumanInTheLoop<DotDraft>(
    {
      name: 'review_space_page',
      description: 'Present a Markdown draft for owner approval before saving it into a Space.',
      parameters: reviewSchema,
      render: (props) => <ReviewCard {...props} threadId={threadId} />,
    },
    [threadId],
  );
  useHumanInTheLoop(
    {
      name: 'request_connection_action',
      description:
        'Ask the owner to approve a pending connected-service action. Wait for the review result.',
      parameters: actionSchema,
      render: (props) => <ActionCard {...props} threadId={threadId} />,
    },
    [threadId],
  );
  useRenderTool(
    {
      name: '*',
      render: ({ name, args, result }) => (
        <details className="border-border-light my-2 rounded-lg border p-3">
          <summary>{name}</summary>
          <pre className="max-h-64 overflow-auto text-sm whitespace-pre-wrap">
            {JSON.stringify(result ?? args, null, 2)}
          </pre>
        </details>
      ),
    },
    [],
  );
  return null;
}
