import { requireApiClient } from './client';

export const cartApi = {
  getCart: () => requireApiClient().cart.getCart(),
  updateItem: (itemId: string, input: { quantity: number }) =>
    requireApiClient().cart.updateItem(itemId, input),
  removeItem: (itemId: string) => requireApiClient().cart.removeItem(itemId),
};
