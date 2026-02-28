import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: EmptyStateAction;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-24">
      <Icon className="size-12 text-[var(--muted-foreground)]/40" strokeWidth={1.5} />
      <h2 className="mt-4 text-lg font-medium text-[var(--foreground)]">
        {title}
      </h2>
      <p className="mt-1.5 max-w-sm text-center text-sm text-[var(--muted-foreground)]">
        {description}
      </p>
      {action && (
        <div className="mt-5">
          {action.href ? (
            <Button variant="outline" size="sm" asChild>
              <Link to={action.href}>{action.label}</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
