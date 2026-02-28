import { cn } from "@/lib/utils";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import type { ConnectionStatus as Status } from "@/contexts/ProxyConnectionContext";

const statusConfig: Record<
  Status,
  { color: string; label: string; pulse?: boolean }
> = {
  connected: { color: "bg-[#22c55e]", label: "Connected" },
  disconnected: { color: "bg-[#ef4444]", label: "Disconnected" },
  reconnecting: { color: "bg-[#eab308]", label: "Reconnecting...", pulse: true },
};

interface ConnectionStatusProps {
  collapsed: boolean;
  onClick?: () => void;
}

export default function ConnectionStatus({
  collapsed,
  onClick,
}: ConnectionStatusProps) {
  const { status, proxyUrl } = useProxyConnection();

  const isConfigured = !!proxyUrl;
  const config = isConfigured
    ? statusConfig[status]
    : { color: "bg-[#71717a]", label: "Not configured" };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs transition-colors",
        "text-[var(--sidebar-foreground)]/70 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]",
        collapsed && "justify-center px-0"
      )}
    >
      <span className="relative flex shrink-0">
        <span
          className={cn("block size-2 rounded-full", config.color)}
        />
        {config.pulse && (
          <span
            className={cn(
              "absolute inset-0 size-2 animate-ping rounded-full opacity-75",
              config.color
            )}
          />
        )}
      </span>
      {!collapsed && (
        <span className="truncate">{config.label}</span>
      )}
    </button>
  );
}
