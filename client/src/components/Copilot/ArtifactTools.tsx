import { z } from 'zod';
import { useRenderTool } from '@copilotkit/react-core/v2';
import { ArtifactDownload } from './Evolution';
import { useLocalize } from '~/hooks';

const resultSchema = z.object({
  ok: z.literal(true),
  files: z.array(z.object({ id: z.string().uuid(), name: z.string().max(100) })).max(5),
});
function ArtifactCard({ result, status }: { result: unknown; status: string }) {
  const localize = useLocalize();
  const parsed = resultSchema.safeParse(result);
  if (status !== 'complete')
    return <p role="status">{localize('com_evolution_preparing_artifact')}</p>;
  if (!parsed.success) return <p role="alert">{localize('com_evolution_artifact_error')}</p>;
  return (
    <section className="border-border-light my-3 space-y-2 rounded-lg border p-4">
      <h3 className="font-semibold">{localize('com_evolution_verified_artifacts')}</h3>
      <div className="flex flex-wrap gap-2">
        {parsed.data.files.map((file) => (
          <ArtifactDownload key={file.id} id={file.id} name={file.name} />
        ))}
      </div>
    </section>
  );
}
export default function ArtifactTools() {
  useRenderTool(
    {
      name: 'create_verified_artifact',
      parameters: z.object({ topic: z.enum(['presentations', 'finance']), content: z.unknown() }),
      render: ({ result, status }) => <ArtifactCard result={result} status={status} />,
    },
    [],
  );
  return null;
}
