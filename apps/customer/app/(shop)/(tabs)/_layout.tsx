import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { BottomTabBar } from '../../../src/components/navigation/BottomTabBar';

/**
 * The five real tabs: Home | Categories | Sakya Fresh | Orders | Account.
 *
 * Everything that is a *destination* (cart, checkout, product, category
 * listing, order detail, settings, wishlist, …) lives one level up in the
 * (shop) Stack, NOT here. Being a tab is what broke Android back: a tab
 * navigator pops to its first route, so every "back" landed on Home. As stack
 * screens they now pop to the exact previous screen, and the floating nav bar
 * is covered naturally by the pushed screen instead of needing
 * `tabBarStyle: { display: 'none' }` on a dozen routes.
 */
export default function ShopTabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <BottomTabBar {...props} />}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="categories"
        options={{
          title: 'Categories',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="fresh"
        options={{
          title: 'Sakya Fresh',
          tabBarIcon: ({ color, size }) => <Ionicons name="leaf" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
