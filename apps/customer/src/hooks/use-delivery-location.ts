import { useEffect, useState } from 'react';
import * as ExpoLocation from 'expo-location';

/**
 * Delivery location for the "Delivering to" line.
 *
 * Asks for permission ONCE per launch when a header first needs it, fixes the
 * device position, and reverse-geocodes to a short human label (area, city).
 * No foreground location watching, no polling — one fix, then idle.
 *
 * Denial is a normal state, not an error: the header falls back to the neutral
 * "India" label and the app stays fully usable.
 */
export interface DeliveryLocation {
  /** Short label like "Gachibowli, Hyderabad" — best available, never null-crashing. */
  label: string;
  status: 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable';
}

export function useDeliveryLocation(): DeliveryLocation {
  const [state, setState] = useState<DeliveryLocation>({ label: 'India', status: 'idle' });

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      setState({ label: 'India', status: 'locating' });
      try {
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (!cancelled) setState({ label: 'India', status: 'denied' });
          return;
        }

        const position = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });

        const fixtures = await ExpoLocation.reverseGeocodeAsync({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        const place = fixtures[0];

        if (!place) {
          if (!cancelled) setState({ label: 'India', status: 'ready' });
          return;
        }

        const area = place.subregion ?? place.district ?? place.city;
        const city = place.city ?? place.region;
        const label =
          area && city && area !== city ? `${area}, ${city}` : (city ?? place.region ?? 'India');

        if (!cancelled) setState({ label, status: 'ready' });
      } catch {
        // Service unavailable / timeout: neutral fallback, app stays usable.
        if (!cancelled) setState({ label: 'India', status: 'unavailable' });
      }
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
