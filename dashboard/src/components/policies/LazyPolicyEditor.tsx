import { forwardRef, useEffect, useState, type Ref } from "react";
import { Loader2 } from "lucide-react";
import { loadPolicyEditorModule } from "@/lib/dashboard-imports";
import type { PolicyValidationError } from "@/types/api";
import type { PolicyEditorHandle } from "@/components/policies/PolicyEditor";

interface LazyPolicyEditorProps {
  value: string;
  onChange: (value: string) => void;
  errors: PolicyValidationError[];
  readOnly?: boolean;
}

type PolicyEditorComponent = typeof import("@/components/policies/PolicyEditor").default;

function EditorSkeleton() {
  return (
    <div className="flex min-h-[400px] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background)]">
      <div className="border-b border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3">
        <div className="h-3 w-40 animate-pulse rounded bg-[var(--muted)]" />
      </div>
      <div className="flex flex-1 items-center justify-center gap-3 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="size-4 animate-spin" />
        Loading YAML editor...
      </div>
    </div>
  );
}

const LazyPolicyEditor = forwardRef(function LazyPolicyEditor(
  props: LazyPolicyEditorProps,
  ref: Ref<PolicyEditorHandle>,
) {
  const [Editor, setEditor] = useState<PolicyEditorComponent | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadPolicyEditorModule().then((module) => {
      if (!cancelled) {
        setEditor(() => module.default);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!Editor) {
    return <EditorSkeleton />;
  }

  return <Editor ref={ref} {...props} />;
});

export default LazyPolicyEditor;
