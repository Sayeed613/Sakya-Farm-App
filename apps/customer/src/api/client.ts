import { createSakyaApiClient } from '@sakya/api-client';
import { useAuthStore } from '../stores/auth-store';

const baseUrl = process.env.EXPO_PUBLIC_API_URL;

export const apiClient = baseUrl
  ? createSakyaApiClient({
      baseUrl,
      getAccessToken: () => useAuthStore.getState().session?.accessToken ?? null,
    })
  : null;

export function requireApiClient() {
  if (!apiClient) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not configured. Copy apps/customer/.env.example to apps/customer/.env and set the API URL.',
    );
  }

  return apiClient;
}
