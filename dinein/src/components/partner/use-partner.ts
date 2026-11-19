'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@tixit/session';
import type { PartnerLive } from '@/lib/types';
import { usePartnerRestaurants } from '@/components/shell/account-menu';

export { usePartnerRestaurants };

export function usePartnerRestaurant(id: string) {
  const list = usePartnerRestaurants();
  return { ...list, restaurant: list.data?.find((r) => r.id === id) ?? null };
}

/** Everything on the Live screen, polled — robust behind any proxy, cheap on the API. */
export function useLive(id: string, enabled = true) {
  return useQuery({
    queryKey: ['partner-live', id],
    queryFn: async () => (await api.get<PartnerLive>(`/partner/r/${id}/live`)).data,
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
    enabled,
  });
}
