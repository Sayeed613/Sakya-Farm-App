import { Stack } from 'expo-router';

/**
 * Screen titles double as web document titles (expo-router syncs them to
 * document.title on web) — history entries, tabs and bookmarks read well.
 */
const SCREEN_TITLES: Record<string, string> = {
  cart: 'Your Cart',
  checkout: 'Checkout',
  'products/[slug]': 'Product',
  'categories/[slug]': 'Category',
  'orders/[id]': 'Order Details',
  notifications: 'Notifications',
  'edit-profile': 'Edit Profile',
  settings: 'Settings',
  support: 'Support',
  'delete-account': 'Delete Account',
  wishlist: 'Wishlist',
  'address-book': 'Address Book',
};

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
      <Stack.Screen name="(tabs)" options={{ title: 'Sakya Farms' }} />
      {Object.entries(SCREEN_TITLES).map(([name, title]) => (
        <Stack.Screen key={name} name={name} options={{ title }} />
      ))}
    </Stack>
  );
}
