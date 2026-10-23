import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChoiceCard, TableCard } from '../Cards';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));

test('streaming partial arguments render a loading state instead of a broken table', () => {
  render(<TableCard args={{ title: 'Still arriving' }} />);
  expect(screen.getByRole('status')).toHaveTextContent('com_copilot_preparing');
});

test('model-provided table cells render as text, with semantic headers', () => {
  render(
    <TableCard
      args={{
        title: 'Comparison',
        columns: ['Product', 'Feature'],
        rows: [['LibreChat', '<script>alert(1)</script>']],
      }}
    />,
  );
  expect(screen.getByRole('columnheader', { name: 'Product' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '<script>alert(1)</script>' })).toBeInTheDocument();
  expect(document.querySelector('script')).toBeNull();
});

test('human selection waits for a click, blocks duplicate decisions, and recovers from a failed response', async () => {
  let fail: (reason: Error) => void = () => {};
  const respond = jest.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  render(
    <ChoiceCard
      args={{ title: 'Choose a base', options: ['LibreChat', 'Jan'] }}
      respond={respond}
    />,
  );
  expect(respond).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'LibreChat' }));
  expect(respond).toHaveBeenCalledWith({ selected: 'LibreChat' });
  expect(screen.getByRole('button', { name: 'Jan' })).toBeDisabled();
  fail(new Error('Network error'));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Jan' })).toBeEnabled();
});
