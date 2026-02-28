import {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { getBaseUrl, setBaseUrl, ping } from "@/lib/api-client";

export type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

export interface ProxyConnectionState {
  status: ConnectionStatus;
  proxyUrl: string | null;
  latencyMs: number;
  lastPingAt: Date | null;
  version: string | null;
  reconnect: () => void;
  setProxyUrl: (url: string) => void;
  isConnected: boolean;
  isDisconnected: boolean;
}

export const ProxyConnectionContext =
  createContext<ProxyConnectionState | null>(null);

const CONNECTED_INTERVAL_MS = 15_000;
const DISCONNECTED_INTERVAL_MS = 5_000;

export function ProxyConnectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [proxyUrl, setProxyUrlState] = useState<string | null>(getBaseUrl);
  const [latencyMs, setLatencyMs] = useState(0);
  const [lastPingAt, setLastPingAt] = useState<Date | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  const failureCount = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkHealth = useCallback(async () => {
    if (!proxyUrl) {
      setStatus("disconnected");
      return;
    }

    const result = await ping(proxyUrl);

    if (result.ok) {
      failureCount.current = 0;
      setStatus("connected");
      setLatencyMs(result.latencyMs);
      setLastPingAt(new Date());
      if (result.data?.version) {
        setVersion(result.data.version);
      }
    } else {
      failureCount.current += 1;
      if (failureCount.current >= 3) {
        setStatus("disconnected");
      } else {
        setStatus("reconnecting");
      }
    }
  }, [proxyUrl]);

  // Start/restart ping interval when status or proxyUrl changes
  useEffect(() => {
    if (!proxyUrl) {
      setStatus("disconnected");
      return;
    }

    // Initial ping
    checkHealth();

    const intervalMs =
      status === "connected" ? CONNECTED_INTERVAL_MS : DISCONNECTED_INTERVAL_MS;

    intervalRef.current = setInterval(checkHealth, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [proxyUrl, status, checkHealth]);

  const reconnect = useCallback(() => {
    failureCount.current = 0;
    setStatus("reconnecting");
    checkHealth();
  }, [checkHealth]);

  const setProxyUrl = useCallback(
    (url: string) => {
      setBaseUrl(url);
      setProxyUrlState(url);
      failureCount.current = 0;
      setStatus("reconnecting");
    },
    []
  );

  return (
    <ProxyConnectionContext.Provider
      value={{
        status,
        proxyUrl,
        latencyMs,
        lastPingAt,
        version,
        reconnect,
        setProxyUrl,
        isConnected: status === "connected",
        isDisconnected: status === "disconnected",
      }}
    >
      {children}
    </ProxyConnectionContext.Provider>
  );
}
