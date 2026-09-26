import { beforeEach, describe, expect, it, vi } from 'vitest';

import { goBackOrHome, HOME_ROUTE } from './navigation';

/**
 * The back-button fix in one place.
 *
 * Screens must pop exactly one screen when there is history, and fall back to
 * Home only on a cold entry (deep link / notification). The old code called a
 * bare `router.back()`, which did nothing on a cold entry, and the even older
 * navigation *structure* made back resolve to the first tab — so this helper's
 * contract is what stops "back always goes Home".
 */
const canGoBack = vi.fn();
const back = vi.fn();
const replace = vi.fn();

vi.mock('expo-router', () => ({
  router: {
    canGoBack: () => canGoBack(),
    back: () => back(),
    replace: (route: string) => replace(route),
  },
}));

describe('goBackOrHome', () => {
  beforeEach(() => {
    canGoBack.mockReset();
    back.mockReset();
    replace.mockReset();
  });

  it('pops exactly one screen when there is history', () => {
    canGoBack.mockReturnValue(true);

    goBackOrHome();

    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('falls back to Home on a cold entry instead of doing nothing', () => {
    canGoBack.mockReturnValue(false);

    goBackOrHome();

    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(HOME_ROUTE);
  });

  it('points the fallback at the shop Home tab', () => {
    expect(HOME_ROUTE).toBe('/(shop)');
  });
});
