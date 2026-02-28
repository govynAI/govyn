import { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import Sidebar from "./Sidebar";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : true
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

function DisconnectedBanner() {
  const [dismissed, setDismissed] = useState(false);
  const location = useLocation();

  // Reset dismissal on navigation
  useEffect(() => {
    setDismissed(false);
  }, [location.pathname]);

  if (dismissed) return null;

  return (
    <div className="flex items-center justify-between border-b border-[#eab308]/20 bg-[#eab308]/10 px-4 py-2 text-sm text-[#eab308]">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        <span>Proxy disconnected -- data may be stale</span>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="rounded p-0.5 hover:bg-[#eab308]/20 transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export default function AppLayout() {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [collapsed, setCollapsed] = useState(!isDesktop);
  const { isDisconnected, proxyUrl } = useProxyConnection();

  // Auto-collapse when viewport shrinks below desktop
  useEffect(() => {
    setCollapsed(!isDesktop);
  }, [isDesktop]);

  return (
    <div className="flex h-screen bg-[var(--background)] text-[var(--foreground)]">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <main className="flex-1 overflow-y-auto">
        {isDisconnected && proxyUrl && <DisconnectedBanner />}
        <Outlet />
      </main>
    </div>
  );
}
