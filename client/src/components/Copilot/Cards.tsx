import { useState } from 'react';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@librechat/client';
import { tableSchema, choiceSchema } from './schemas';
import { useLocalize } from '~/hooks';

export function TableCard({ args }: { args: unknown }) {
  const localize = useLocalize();
  const parsed = tableSchema.safeParse(args);
  if (!parsed.success) return <p role="status">{localize('com_copilot_preparing')}</p>;
  const { title, columns, rows } = parsed.data;
  return (
    <section className="my-3 overflow-x-auto" aria-label={title}>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column, index) => (
              <TableHead key={index}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              {columns.map((_column, columnIndex) => (
                <TableCell key={columnIndex}>{row[columnIndex] ?? ''}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

export function ChoiceCard({
  args,
  respond,
}: {
  args: unknown;
  respond?: (value: unknown) => Promise<void>;
}) {
  const localize = useLocalize();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const parsed = choiceSchema.safeParse(args);
  if (!parsed.success) return <p role="status">{localize('com_copilot_preparing')}</p>;
  return (
    <section className="my-3 space-y-3" aria-label={parsed.data.title}>
      <h3 className="font-semibold">{parsed.data.title}</h3>
      <div className="flex flex-wrap gap-2">
        {parsed.data.options.map((option, index) => (
          <Button
            key={index}
            variant="outline"
            disabled={!respond || pending}
            onClick={async () => {
              if (!respond || pending) return;
              setPending(true);
              setError(false);
              try {
                await respond({ selected: option });
              } catch {
                setError(true);
              } finally {
                setPending(false);
              }
            }}
          >
            {option}
          </Button>
        ))}
      </div>
      {error && <p role="alert">{localize('com_copilot_error')}</p>}
    </section>
  );
}
