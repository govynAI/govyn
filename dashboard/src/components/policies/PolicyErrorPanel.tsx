import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle2 } from "lucide-react";
import type { PolicyValidationError } from "@/types/api";

interface PolicyErrorPanelProps {
  errors: PolicyValidationError[];
  onClickError: (line: number) => void;
}

/**
 * Collapsible error panel below the YAML editor.
 *
 * Shows validation errors with clickable line numbers that
 * jump the editor cursor to the affected line. Displays a
 * green "no errors" message when validation passes.
 */
export function PolicyErrorPanel({ errors, onClickError }: PolicyErrorPanelProps) {
  const [isExpanded, setIsExpanded] = useState(errors.length > 0);

  // Auto-expand when errors appear, auto-collapse when they clear
  useEffect(() => {
    if (errors.length > 0) {
      setIsExpanded(true);
    }
  }, [errors.length]);

  const hasErrors = errors.length > 0;

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      {/* Header bar */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className={`
          w-full flex items-center gap-2 px-3 py-2 text-sm font-medium
          transition-colors select-none
          ${
            hasErrors
              ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
          }
        `}
      >
        {isExpanded ? (
          <ChevronDown className="size-4 shrink-0" />
        ) : (
          <ChevronRight className="size-4 shrink-0" />
        )}
        {hasErrors ? (
          <>
            <AlertCircle className="size-4 shrink-0" />
            <span>
              {errors.length} error{errors.length === 1 ? "" : "s"}
            </span>
          </>
        ) : (
          <>
            <CheckCircle2 className="size-4 shrink-0" />
            <span>No validation errors</span>
          </>
        )}
      </button>

      {/* Error list */}
      {isExpanded && hasErrors && (
        <ul className="divide-y divide-[var(--border)] bg-[var(--background)]">
          {errors.map((error, i) => (
            <li key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
              {error.line ? (
                <button
                  type="button"
                  onClick={() => onClickError(error.line!)}
                  className="shrink-0 font-mono text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:underline cursor-pointer"
                >
                  L{error.line}
                </button>
              ) : (
                <span className="shrink-0 font-mono text-xs px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
                  --
                </span>
              )}
              <span className="text-red-700 dark:text-red-400">
                {error.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
