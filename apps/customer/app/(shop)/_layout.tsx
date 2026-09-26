import { Stack } from 'expo-router';

/**
 * Shop stack.
 *
 * Structure: this Stack wraps the (tabs) navigator and every pushed
 * destination. That is the fix for the long-standing back-button defect — in
 * the previous layout every detail screen was a *tab* (`href: null`), and a
 * tab navigator resolves back to its first route, so back from cart, product,
 * order detail, settings, … always dumped the customer on Home.
 *
 * With a Stack above the tabs:
 *   Home → product → back            → Home
 *   Home → category → product → back → category
 *   Home → cart → checkout → back    → cart
 *   Orders → order detail → back     → Orders
 *
 * Pushed screens also cover the floating tab bar automatically, so no route
 * needs `tabBarStyle: { display: 'none' }` any more.
 */
export default function ShopLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="cart" />
      <Stack.Screen name="checkout" />
      <Stack.Screen name="products/[slug]" />
      <Stack.Screen name="categories/[slug]" />
      <Stack.Screen name="orders/[id]" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="support" />
      <Stack.Screen name="delete-account" />
      <Stack.Screen name="wishlist" />
      <Stack.Screen name="address-book" />
    </Stack>
  );
}
