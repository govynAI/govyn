import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  DollarSign,
  Shield,
  CheckCircle,
  Bell,
  Settings,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import UserMenu from "./UserMenu";
import ConnectionPopover from "./ConnectionPopover";

const navItems = [
  { path: "/", label: "Overview", icon: LayoutDashboard },
  { path: "/costs", label: "Costs", icon: DollarSign },
  { path: "/policies", label: "Policies", icon: Shield },
  { path: "/approvals", label: "Approvals", icon: CheckCircle },
  { path: "/alerts", label: "Alerts", icon: Bell },
  { path: "/settings", label: "Settings", icon: Settings },
] as const;

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

function NavItem({
  path,
  label,
  icon: Icon,
  collapsed,
}: {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  collapsed: boolean;
}) {
  const location = useLocation();
  const isActive =
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const link = (
    <NavLink
      to={path}
      className={cn(
        "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
          : "text-[var(--sidebar-foreground)]/70 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          isActive
            ? "text-[var(--color-accent)]"
            : "text-[var(--sidebar-foreground)]/50 group-hover:text-[var(--sidebar-foreground)]"
        )}
      />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-background)] transition-[width] duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex h-14 items-center border-b border-[var(--sidebar-border)]",
          collapsed ? "justify-center px-2" : "justify-between px-4"
        )}
      >
        {!collapsed && (
          <span className="text-lg font-semibold tracking-tight text-[var(--sidebar-foreground)]">
            Govyn
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          className="text-[var(--sidebar-foreground)]/50 hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]"
        >
          <ChevronLeft
            className={cn(
              "size-4 transition-transform duration-200",
              collapsed && "rotate-180"
            )}
          />
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
        {navItems.map((item) => (
          <NavItem
            key={item.path}
            path={item.path}
            label={item.label}
            icon={item.icon}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* Connection status */}
      <div className="px-2">
        <ConnectionPopover collapsed={collapsed} />
      </div>

      {/* User menu at bottom */}
      <div className="border-t border-[var(--sidebar-border)]/50 px-2 py-3">
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
