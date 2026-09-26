import { useEffect, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import { setConnectivityForHttpGate } from '../api/client';

/**
 * Connectivity state for the app shell.
 *
 * `isConnected` is the honest transport answer from the OS: true whenever any
 * network interface is up (Wi-Fi or cellular). The subscription lives for the
 * caller's lifetime and re-fires on every connectivity CHANGE event, so an
 * airplane-mode toggle or dead zone flips the offline banner immediately.
 *
 * Every change is also mirrored to the http layer's offline gate
 * (`setConnectivityForHttpGate`), so requests fail fast while offline.
 */
export function useConnectivity(): { isConnected: boolean | null } {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    const apply = (state: NetInfoState) => {
      const connected = state.isConnected ?? false;
      if (mounted) setIsConnected(connected);
      setConnectivityForHttpGate(connected);
    };

    // Subscribe first so no change event is missed, then seed the state.
    const unsubscribe = NetInfo.addEventListener(apply);

    void NetInfo.fetch()
      .then(apply)
      .catch(() => undefined);

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { isConnected };
}
