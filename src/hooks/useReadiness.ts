import { useEffect, useState } from "react";
import { useBridge } from "../services/bridge";

export function useReadiness(
  host: string,
  port: number | null,
  enabled: boolean,
  intervalMs = 3000,
): boolean {
  const bridge = useBridge();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || port == null) {
      return;
    }
    const targetPort = port;
    let cancelled = false;

    const probe = () => {
      void bridge.probeTcp(host, targetPort, 1000).then(
        (result) => {
          if (!cancelled) {
            setReady(result);
          }
        },
        () => {},
      );
    };

    probe();
    const interval = setInterval(probe, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [bridge, host, port, enabled, intervalMs]);

  return ready;
}
