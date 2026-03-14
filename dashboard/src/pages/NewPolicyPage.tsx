import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Shield, Clock, Zap, DollarSign, Filter, Route, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { parseDocument } from "yaml";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import LazyPolicyEditor from "@/components/policies/LazyPolicyEditor";
import type { PolicyEditorHandle } from "@/components/policies/PolicyEditor";
import { PolicyErrorPanel } from "@/components/policies/PolicyErrorPanel";
import {
  POLICY_TEMPLATES,
  POLICY_TYPE_DESCRIPTIONS,
} from "@/components/policies/PolicyTemplates";
import { apiFetch } from "@/lib/api-client";
import { loadPolicyEditorModule } from "@/lib/dashboard-imports";
import type { PolicyType, PolicyValidationError } from "@/types/api";
import type { LucideIcon } from "lucide-react";

/** Badge color mapping for each policy type */
const TYPE_COLORS: Record<PolicyType, string> = {
  block: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  rate_limit:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  budget_limit:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  content_filter:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  time_window:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  model_route:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  require_approval:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
};

const TYPE_LABELS: Record<PolicyType, string> = {
  block: "Block",
  rate_limit: "Rate Limit",
  budget_limit: "Budget Limit",
  content_filter: "Content Filter",
  time_window: "Time Window",
  model_route: "Model Route",
  require_approval: "Require Approval",
};

const TYPE_ICONS: Record<PolicyType, LucideIcon> = {
  block: Shield,
  rate_limit: Zap,
  budget_limit: DollarSign,
  content_filter: Filter,
  time_window: Clock,
  model_route: Route,
  require_approval: UserCheck,
};

/**
 * Extract the policy name from a YAML string.
 */
function extractPolicyName(yamlStr: string): string | null {
  try {
    const doc = parseDocument(yamlStr);
    const parsed = doc.toJSON() as Record<string, unknown>;
    if (
      parsed &&
      Array.isArray(parsed.policies) &&
      parsed.policies.length > 0
    ) {
      const policy = parsed.policies[0] as Record<string, unknown>;
      if (typeof policy.name === "string") return policy.name;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/**
 * New policy creation page.
 *
 * Step 1: Select a policy type from a card grid.
 * Step 2: Edit the pre-filled template in the CodeMirror editor, then save.
 */
export default function NewPolicyPage() {
  const navigate = useNavigate();
  const editorRef = useRef<PolicyEditorHandle>(null);

  const [selectedType, setSelectedType] = useState<PolicyType | null>(null);
  const [currentYaml, setCurrentYaml] = useState("");
  const [validationErrors, setValidationErrors] = useState<PolicyValidationError[]>([]);
  const [saving, setSaving] = useState(false);

  const handleTypeSelect = useCallback((type: PolicyType) => {
    void loadPolicyEditorModule();
    setSelectedType(type);
    setCurrentYaml(POLICY_TEMPLATES[type]);
    setValidationErrors([]);
  }, []);

  const handleChange = useCallback((value: string) => {
    setCurrentYaml(value);
    // Simple client-side validation not debounced for new policy
    // (the template starts valid, quick feedback is fine)
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const response = await apiFetch("/api/policies", {
        method: "POST",
        body: JSON.stringify({ yaml: currentYaml }),
      });

      if (response.status === 400) {
        const data = (await response.json()) as {
          errors?: PolicyValidationError[];
          error?: { message: string };
        };
        if (data.errors) {
          setValidationErrors(data.errors);
        } else if (data.error?.message) {
          setValidationErrors([{ message: data.error.message }]);
        }
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to create policy: ${response.status}`);
      }

      toast.success("Policy created");

      // Navigate to the newly created policy's detail page
      const policyName = extractPolicyName(currentYaml);
      if (policyName) {
        navigate(`/policies/${encodeURIComponent(policyName)}`);
      } else {
        navigate("/policies");
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error creating policy";
      setValidationErrors([{ message }]);
    } finally {
      setSaving(false);
    }
  }, [currentYaml, navigate]);

  const handleErrorClick = useCallback((line: number) => {
    editorRef.current?.scrollToLine(line);
  }, []);

  // Step 1: Type picker
  if (!selectedType) {
    return (
      <div className="flex flex-col h-full">
        <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/80 px-6 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/policies")}
            >
              <ArrowLeft className="size-4" />
              <span className="hidden sm:inline">Policies</span>
            </Button>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              New Policy
            </h2>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6">
          <p className="mb-6 text-sm text-[var(--muted-foreground)]">
            Select a policy type to get started with a pre-filled template.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(POLICY_TEMPLATES) as PolicyType[]).map((type) => {
              const Icon = TYPE_ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleTypeSelect(type)}
                  className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 text-left transition-all hover:border-[var(--foreground)]/20 hover:shadow-md"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="size-5 text-[var(--muted-foreground)]" />
                    <Badge variant="secondary" className={TYPE_COLORS[type]}>
                      {TYPE_LABELS[type]}
                    </Badge>
                  </div>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {POLICY_TYPE_DESCRIPTIONS[type]}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Step 2: Editor with template
  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/80 px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedType(null)}
          >
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Back</span>
          </Button>

          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            New Policy
          </h2>

          <Badge variant="secondary" className={TYPE_COLORS[selectedType]}>
            {TYPE_LABELS[selectedType]}
          </Badge>

          <div className="flex-1" />

          <Button
            size="sm"
            disabled={validationErrors.length > 0 || saving}
            onClick={handleSave}
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Policy"
            )}
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <LazyPolicyEditor
          ref={editorRef}
          value={currentYaml}
          onChange={handleChange}
          errors={validationErrors}
        />

        <PolicyErrorPanel
          errors={validationErrors}
          onClickError={handleErrorClick}
        />
      </div>
    </div>
  );
}
