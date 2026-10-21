import { useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks';

export function useCopilotStatus() {
  const { user, isAuthenticated } = useAuthContext();
  return useQuery({
    queryKey: [QueryKeys.copilotStatus, user?.id],
    queryFn: dataService.getCopilotStatus,
    enabled: isAuthenticated,
    staleTime: 60_000,
    retry: false,
  });
}
