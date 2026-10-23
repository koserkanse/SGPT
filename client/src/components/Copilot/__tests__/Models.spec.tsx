import { dataService } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import Models from '../Models';
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: { ...actual.dataService, getDotModels: jest.fn(), setDotModel: jest.fn() },
  };
});
const load = jest.mocked(dataService.getDotModels);
const save = jest.mocked(dataService.setDotModel);
const dot = { id: 'seko', name: 'Seko', instructions: 'Help', spaceId: 'space' };
const connections = [
  {
    id: 'home',
    name: 'Home',
    location: 'local' as const,
    models: ['qwen-a', 'qwen-b'],
    ready: true,
  },
  {
    id: 'cloud',
    name: 'Remote',
    location: 'remote' as const,
    models: ['cloud-model'],
    ready: true,
  },
];
let client: QueryClient;
function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Models dot={dot} userId="owner" />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  client?.clear();
  jest.clearAllMocks();
});
test('loads connections and saves a selected remote model without changing other specialists', async () => {
  load.mockResolvedValue(connections);
  save.mockResolvedValue({ ...dot, modelConnectionId: 'cloud', modelId: 'cloud-model' });
  mount();
  fireEvent.click(screen.getByText('com_copilot_model_settings'));
  fireEvent.change(await screen.findByLabelText('com_copilot_model_connection'), {
    target: { value: 'cloud' },
  });
  expect(screen.getByLabelText('com_copilot_model_name')).toHaveValue('cloud-model');
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      id: 'seko',
      modelConnectionId: 'cloud',
      modelId: 'cloud-model',
    }),
  );
  expect(await screen.findByText('com_copilot_model_saved')).toBeInTheDocument();
});
test('load failure retries and default selection restores inheritance', async () => {
  load.mockRejectedValueOnce(new Error('Fixture unavailable')).mockResolvedValue(connections);
  save.mockResolvedValue(dot);
  mount();
  fireEvent.click(screen.getByText('com_copilot_model_settings'));
  fireEvent.click(await screen.findByRole('button', { name: 'com_ui_retry' }));
  await screen.findByLabelText('com_copilot_model_connection');
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ id: 'seko', modelConnectionId: null, modelId: null }),
  );
});
test('save failure remains visible and preserves the selection for retry', async () => {
  load.mockResolvedValue(connections);
  save.mockRejectedValueOnce(new Error('Fixture save failed')).mockResolvedValue(dot);
  mount();
  fireEvent.click(screen.getByText('com_copilot_model_settings'));
  fireEvent.change(await screen.findByLabelText('com_copilot_model_connection'), {
    target: { value: 'home' },
  });
  fireEvent.change(screen.getByLabelText('com_copilot_model_name'), {
    target: { value: 'qwen-b' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('com_copilot_model_save_error');
  expect(screen.getByLabelText('com_copilot_model_name')).toHaveValue('qwen-b');
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
  expect(await screen.findByText('com_copilot_model_saved')).toBeInTheDocument();
});
