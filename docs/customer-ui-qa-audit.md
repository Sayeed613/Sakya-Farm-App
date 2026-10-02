# Customer UI QA Audit

**Date:** 2026-10-01  
**Scope:** Expo customer app UI and screen behavior only. Backend correctness is not reviewed.

## Summary

The guest auth, empty-cart, and retry states render at phone and desktop widths. The biggest visible issue is that the primary navigation renders four tabs although Categories is declared as a fifth tab. Checkout also has a non-actionable signed-out deep-link state, and Support has no configured contact channel.

Customer checks passed: typecheck, lint, and 63 tests. Selected screens had no horizontal overflow at 320, 390, or 1440 px. This is not a full sign-off: the browser session had no authenticated customer, and its origin was blocked by the API's CORS policy, so live catalog, authenticated account, and checkout content could not be exercised.

## Findings

### P2 — Categories is missing from the primary tab bar

**Observed:** At 320, 390, and 1440 px, the rendered bottom navigation contains Home, Fresh, Orders, and Account; Categories is absent. The Categories screen itself is directly reachable at `/categories`, but it has no primary navigation entry. The tab is declared in [the tabs layout](<../apps/customer/app/(shop)/(tabs)/_layout.tsx#L31>) and has a label/definition in [BottomTabBar](../apps/customer/src/components/navigation/BottomTabBar.tsx#L70), but it does not appear in the rendered route list.

**Impact:** Customers lose an expected browse destination and must find categories through Home content instead.

**Follow-up:** Check the route name Expo Router supplies for the nested `categories/index.tsx` route against the tab route name and the custom tab bar's filter.

### P2 — Signed-out checkout deep link has no next action

**Observed:** `/checkout` while signed out displays only “Verify your phone to continue.” and has zero interactive controls. This route guard is in [checkout.tsx](<../apps/customer/app/(shop)/checkout.tsx#L411>). Other personal screens use an AuthGate with a Continue with phone action.

**Impact:** A signed-out deep link or expired-session entry leaves the customer at a dead end.

**Follow-up:** Use the shared AuthGate or redirect to phone verification while preserving `/checkout` as the return destination.

### P2 — Support has no contact channel

**Observed:** The Support screen renders FAQs and an explicit “Contact options are being set up” placeholder ([support.tsx](<../apps/customer/app/(shop)/support.tsx#L172>)). No contact action was available in the current configuration.

**Impact:** Customers without an order-specific issue have no usable support contact path.

**Follow-up:** Configure a real contact action or clearly explain the available support route before release.

### P2 — Shared files under `app/` are being discovered as routes

**Observed:** Metro logs 18 warnings that files under `app/(shop)/components/` and `app/(shop)/(tabs)/components/` are routes without default exports. Examples include [AddressSelection.tsx](<../apps/customer/app/(shop)/components/AddressSelection.tsx>) and [HomeFooter.tsx](<../apps/customer/app/(shop)/(tabs)/components/HomeFooter.tsx>).

**Impact:** The route tree includes non-screen files, creating noisy startup logs and unintended route entries.

**Follow-up:** Move shared UI/helpers outside Expo Router's `app/` route tree, then confirm the warnings disappear.

### P3 — Browser document title stays generic

**Observed:** Across the sampled web routes, the document title stayed “Sakya Farms — Farm-Fresh Delivered” rather than the route-specific titles configured in [the shop layout](<../apps/customer/app/(shop)/_layout.tsx#L7>).

**Impact:** Browser tabs, history, and assistive technology do not identify the current screen.

**Follow-up:** Verify Expo Router's web title synchronization and set route titles explicitly where needed.

## Screen Coverage

| Screen / route                         | Result                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Home `/`                               | Rendered retry state; catalog content unavailable in this browser session. Four-tab nav observed.                |
| Categories `/categories`               | Route is reachable; loading/error state appeared while data requests were blocked. Missing from primary tab bar. |
| Sakya Fresh `/fresh`                   | Header and delivery-location label rendered; catalog content not verified.                                       |
| Orders `/orders`                       | Signed-out gate and phone-verification action rendered.                                                          |
| Account `/profile`                     | Signed-out gate and phone-verification action rendered.                                                          |
| Phone login `/phone`                   | Form rendered; no viewport overflow.                                                                             |
| OTP `/verify-otp`                      | Demo 4-digit state rendered; production 6-digit flow not exercised.                                              |
| Profile completion `/complete-profile` | Name/email fields and skip action rendered.                                                                      |
| Search `/search`                       | Empty-query state and search input rendered. Results not verified.                                               |
| Cart `/cart`                           | Guest empty-cart state and Start shopping action rendered. Non-empty cart not exercised.                         |
| Checkout `/checkout`                   | Signed-out deep link is a dead end; authenticated checkout not exercised.                                        |
| Product detail `/products/:slug`       | Retryable connection-error state rendered after loading.                                                         |
| Category detail `/categories/:slug`    | Retryable connection-error state rendered after loading.                                                         |
| Order detail `/orders/:id`             | Signed-out gate and phone-verification action rendered.                                                          |
| Wishlist `/wishlist`                   | Signed-out gate and phone-verification action rendered.                                                          |
| Address book `/address-book`           | Signed-out gate and phone-verification action rendered.                                                          |
| Edit profile `/edit-profile`           | Signed-out gate and phone-verification action rendered.                                                          |
| Settings `/settings`                   | Signed-out gate and phone-verification action rendered.                                                          |
| Notifications `/notifications`         | Signed-out gate and phone-verification action rendered.                                                          |
| Delete account `/delete-account`       | Signed-out gate and phone-verification action rendered.                                                          |
| Support `/support`                     | FAQ controls rendered; configured contact channel absent.                                                        |

## Verification and Limits

- `pnpm --filter @sakya/customer typecheck` — passed.
- `pnpm --filter @sakya/customer lint` — passed.
- `pnpm --filter @sakya/customer test` — 6 files and 63 tests passed.
- Browser inspection at 320×844, 390×844, and 1440×844 found no horizontal document overflow or sampled elements outside the viewport on Home, auth forms, Search, Cart, and Support.
- The browser QA origin `http://127.0.0.1:19007` was not allowed by the configured API CORS policy. API-backed screens therefore showed their UI fallback states; this is recorded as a test limitation, not a backend finding.
- Authenticated account/checkout states and shared product, variant, address, coupon, and payment sheets were not runtime-verified without a session and working catalog requests. Native iOS/Android rendering was not tested.
