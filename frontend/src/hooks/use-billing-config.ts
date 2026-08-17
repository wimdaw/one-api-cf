import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { BillingConfig } from "@/types";
import {
  DEFAULT_BILLING_DISPLAY_DECIMALS,
  normalizeBillingConfig,
} from "@/lib/billing";

export const BILLING_CONFIG_QUERY_KEY = ["billing-config"] as const;

export function useBillingConfig() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const isAdminUser = (currentUser?.role ?? 0) >= 10;
  return useQuery({
    queryKey: [BILLING_CONFIG_QUERY_KEY, isAdminUser],
    queryFn: async () => {
      const response = isAdminUser ? await apiClient.getBillingConfig() : await apiClient.myBilling();
      return normalizeBillingConfig(response.data as BillingConfig | undefined);
    },
    staleTime: 60_000,
    placeholderData: {
      displayDecimals: DEFAULT_BILLING_DISPLAY_DECIMALS,
    },
  });
}
