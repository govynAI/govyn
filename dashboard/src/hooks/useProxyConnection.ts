import { useContext } from "react";
import {
  ProxyConnectionContext,
  type ProxyConnectionState,
} from "@/contexts/ProxyConnectionContext";

/**
 * Hook to access proxy connection state and actions.
 *
 * Must be used within a `<ProxyConnectionProvider>`.
 */
export function useProxyConnection(): ProxyConnectionState {
  const ctx = useContext(ProxyConnectionContext);
  if (!ctx) {
    throw new Error(
      "useProxyConnection must be used within a <ProxyConnectionProvider>"
    );
  }
  return ctx;
}
