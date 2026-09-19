import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { BottomTabBar } from '../../src/components/navigation/BottomTabBar';

/**
 * Shop tabs: Home | Categories | Sakya Fresh | Orders | Account.
 *
 * The tab bar is the custom Sakya component. Cart has NO tab — cart state is
 * reached through the green View Cart pill, so the bottom bar stays pure
 * navigation (Blinkit pattern). Detail routes are part of the navigator for
 * stack history but render no tab (`href: null`, honoured by the custom bar).
 */
export default function ShopLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
      }}
      tabBar={(props) => <BottomTabBar {...props} />}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="categories"
        options={{
          title: 'Categories',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="fresh"
        options={{
          title: 'Sakya Fresh',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="leaf" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="receipt-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          href: null,
          // Cart is a focused review step: the floating nav bar hides here so
          // the list and checkout CTA own the bottom of the screen.
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="checkout"
        options={{
          href: null,
          // Checkout is a focused flow: the floating nav bar stays hidden.
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="products/[slug]"
        options={{
          href: null,
          // Full-bleed product experience: the floating nav bar hides for the
          // detail page and returns on back (custom bar honours this option).
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen name="categories/[slug]" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
  );
}
