import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { dataService, emptyEvolutionState } from 'librechat-data-provider';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { EvolutionStatus } from 'librechat-data-provider';
import Evolution from '../Evolution';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getEvolutionStatus: jest.fn(),
      runEvolution: jest.fn(),
      pauseEvolution: jest.fn(),
      learnEvolution: jest.fn(),
    },
  };
});
const load = jest.mocked(dataService.getEvolutionStatus);
const state = (): EvolutionStatus => ({
  enabled: true,
  ready: false,
  timezone: 'Europe/Istanbul',
  days: [1, 4],
  hour: 9,
  minute: 0,
  topics: ['presentations', 'finance', 'memory'],
  running: false,
  setup: ['MODEL_SETUP_REQUIRED'],
  state: { ...emptyEvolutionState(), nextRunAt: '2026-10-22T06:00:00Z' },
});
let client: QueryClient;
function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Evolution userId="owner" />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  client?.clear();
  jest.clearAllMocks();
});

test('loading state and then configured priorities, setup and empty history are visible', async () => {
  let resolve: (value: EvolutionStatus) => void = () => {};
  load.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mount();
  expect(screen.getByRole('status')).toBeInTheDocument();
  resolve(state());
  expect(
    await screen.findByRole('heading', { name: 'com_evolution_presentations' }),
  ).toBeInTheDocument();
  expect(screen.getAllByText('com_evolution_priority')).toHaveLength(2);
  expect(screen.getByText('com_evolution_model_setup')).toBeInTheDocument();
  expect(screen.getByText('com_evolution_no_runs')).toBeInTheDocument();
});
test('load failure offers retry and recovers', async () => {
  load.mockRejectedValueOnce(new Error('Fixture outage')).mockResolvedValue(state());
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('com_evolution_load_error');
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
  expect(await screen.findByText('com_evolution_description')).toBeInTheDocument();
});
test('research action reports failure and retains the saved schedule', async () => {
  load.mockResolvedValue(state());
  jest.mocked(dataService.runEvolution).mockRejectedValueOnce(new Error('Fixture conflict'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'com_evolution_run' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('com_evolution_action_error');
  expect(screen.getByText(/com_evolution_next/)).toBeInTheDocument();
});
test('retained method is submitted for the chosen topic and the query refreshes', async () => {
  load.mockResolvedValue(state());
  jest.mocked(dataService.learnEvolution).mockResolvedValue({ ok: true });
  mount();
  fireEvent.change(await screen.findByRole('textbox'), {
    target: { value: 'Keep financial period labels.' },
  });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'finance' } });
  fireEvent.click(screen.getByRole('button', { name: 'com_evolution_save_method' }));
  await waitFor(() =>
    expect(dataService.learnEvolution).toHaveBeenCalledWith({
      topic: 'finance',
      text: 'Keep financial period labels.',
    }),
  );
});

test('a correction carries the original method identity instead of appending contradictory guidance', async () => {
  const data = state();
  const id = '11111111-1111-4111-8111-111111111111';
  data.state.lessons = [
    {
      id,
      topic: 'finance',
      text: 'Prefer USD.',
      source: 'owner',
      createdAt: '2026-10-21T10:00:00Z',
      validated: false,
    },
  ];
  load.mockResolvedValue(data);
  jest.mocked(dataService.learnEvolution).mockResolvedValue({ ok: true });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'com_evolution_correct_method' }));
  expect(screen.getByRole('textbox')).toHaveFocus();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Prefer TRY.' } });
  fireEvent.click(screen.getByRole('button', { name: 'com_evolution_save_correction' }));
  await waitFor(() =>
    expect(dataService.learnEvolution).toHaveBeenCalledWith({
      topic: 'finance',
      text: 'Prefer TRY.',
      supersedes: id,
    }),
  );
});
