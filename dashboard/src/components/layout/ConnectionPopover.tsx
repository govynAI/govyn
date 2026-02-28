import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import ConnectionStatus from "./ConnectionStatus";
import type { ConnectionStatus as Status } from "@/contexts/ProxyConnectionContext";

const statusBadge: Record<
  Status,
  { label: string; className: string }
> = {
  connected: {
    label: "Connected",
    className:
      "border-[#22c55e]/30 bg-[#22c55e]/10 text-[#22c55e]",
  },
  disconnected: {
    label: "Disconnected",
    className:
      "border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444]",
  },
  reconnecting: {
    label: "Reconnecting",
    className:
      "border-[#eab308]/30 bg-[#eab308]/10 text-[#eab308]",
  },
};

function formatRelativeTime(date: Date | null): string {
  if (!date) return "Never";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

interface ConnectionPopoverProps {
  collapsed: boolean;
}

export default function ConnectionPopover({ collapsed }: ConnectionPopoverProps) {
  const { status, proxyUrl, latencyMs, lastPingAt, version, reconnect } =
    useProxyConnection();

  const [open, setOpen] = useState(false);
  const badge = statusBadge[status];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <ConnectionStatus
            collapsed={collapsed}
            onClick={() => setOpen((o) => !o)}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-64 p-0"
      >
        <div className="space-y-3 p-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--foreground)]">
              Proxy Connection
            </span>
            <Badge variant="outline" className={cn("text-[10px]", badge.className)}>
              {badge.label}
            </Badge>
          </div>

          {/* Details */}
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">URL</span>
              <span className="max-w-[140px] truncate font-mono text-[var(--foreground)]">
                {proxyUrl || "Not configured"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">Latency</span>
              <span className="font-mono text-[var(--foreground)]">
                {status === "connected" ? `${latencyMs}ms` : "--"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">Last ping</span>
              <span className="text-[var(--foreground)]">
                {formatRelativeTime(lastPingAt)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">Version</span>
              <span className="font-mono text-[var(--foreground)]">
                {version || "--"}
              </span>
            </div>
          </div>

          {/* Actions */}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={status === "reconnecting"}
            onClick={() => reconnect()}
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                status === "reconnecting" && "animate-spin"
              )}
            />
            Reconnect
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
