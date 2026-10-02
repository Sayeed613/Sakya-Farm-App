import { useAuthStore } from '../../src/stores/auth-store';

import { AuthenticatedCartScreen } from './components/AuthenticatedCartScreen';
import { GuestCartScreen } from './components/GuestCartScreen';

/**
 * Cart route.
 *
 * Guests render GuestCartScreen (the local guest store) and never touch the
 * server cart; signed-in customers render AuthenticatedCartScreen, which owns
 * the shared `['cart']` query. The split lives here so no unauthenticated
 * request is ever fired from this route.
 */
export default function CartScreen() {
  const session = useAuthStore((state) => state.session);

  if (session === null) {
    return <GuestCartScreen />;
  }

  return <AuthenticatedCartScreen />;
}
