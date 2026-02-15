import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, DynamicQueryKeys, dataService } from 'librechat-data-provider';

export const useAdminBalancesQuery = (
  params?: {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortDirection?: string;
  },
  enabled = true,
) =>
  useQuery({
    queryKey: [QueryKeys.adminBalances, params],
    queryFn: () => dataService.getAdminBalances(params),
    enabled,
  });

export const useAdminTopUpMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { email?: string; userId?: string; amount: number }) =>
      dataService.topUpBalance(payload),
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.adminBalances]);
    },
  });
};

export const useAdminUpdateUserRoleMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      dataService.updateUserRole(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.adminBalances]);
    },
  });
};

export const useAdminConversationsQuery = (
  params?: {
    limit?: number;
    cursor?: string;
    sortBy?: string;
    sortDirection?: string;
    search?: string;
  },
  enabled = true,
) =>
  useQuery({
    queryKey: [QueryKeys.adminConversations, params],
    queryFn: () => dataService.getAdminConversations(params),
    enabled,
  });

export const useAdminConversationMessagesQuery = (conversationId: string | null, enabled = true) =>
  useQuery({
    queryKey: DynamicQueryKeys.adminConversationMessages(conversationId ?? ''),
    queryFn: () => dataService.getAdminConversationMessages(conversationId!),
    enabled: enabled && !!conversationId,
  });

export const useAdminMetricsQuery = (enabled = true) =>
  useQuery({
    queryKey: [QueryKeys.adminMetrics],
    queryFn: () => dataService.getAdminMetrics(),
    enabled,
  });
