import { X } from "lucide-react";
import { cn } from "../../lib/utils";

interface SlashCommandFeedbackProps {
  feedback: string;
  onDismiss: () => void;
  className?: string;
}

function splitDetail(line: string): { label: string; detail: string } {
  const match = /\s(?:\u2014|-)\s/.exec(line);
  if (!match) return { label: line.trim(), detail: "" };
  return {
    label: line.slice(0, match.index).trim(),
    detail: line.slice(match.index + match[0].length).trim(),
  };
}

function renderLine(line: string, index: number) {
  const trimmed = line.trim();
  if (!trimmed) return <div key={index} className="h-1" />;

  if (trimmed.startsWith("Tip:")) {
    return (
      <p
        key={index}
        className="rounded-lg border border-amber-400/15 bg-amber-400/10 px-2.5 py-2 text-[0.6875rem] leading-relaxed text-[var(--foreground)]/85 [overflow-wrap:anywhere]"
      >
        {trimmed}
      </p>
    );
  }

  if (trimmed.endsWith(":") && !trimmed.startsWith("/") && !trimmed.startsWith("{{")) {
    return (
      <div key={index} className="pt-1 text-[0.6875rem] font-semibold text-[var(--foreground)]/85">
        {trimmed.slice(0, -1)}
      </div>
    );
  }

  if (trimmed.startsWith("/") || trimmed.startsWith("{{")) {
    const { label, detail } = splitDetail(trimmed);
    return (
      <div
        key={index}
        className="min-w-0 rounded-lg border border-[var(--border)]/70 bg-[var(--secondary)]/45 px-2.5 py-2"
      >
        <code className="block min-w-0 break-all font-mono text-[0.6875rem] font-semibold text-[var(--primary)]">
          {label}
        </code>
        {detail && (
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
            {detail}
          </p>
        )}
      </div>
    );
  }

  return (
    <p key={index} className="text-[0.6875rem] leading-relaxed text-[var(--foreground)]/80 [overflow-wrap:anywhere]">
      {trimmed}
    </p>
  );
}

export function SlashCommandFeedback({ feedback, onDismiss, className }: SlashCommandFeedbackProps) {
  const lines = feedback.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  const title = firstContentIndex >= 0 ? lines[firstContentIndex]!.trim().replace(/:$/, "") : "Slash command";
  const bodyLines = firstContentIndex >= 0 ? lines.slice(firstContentIndex + 1) : [];

  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] text-xs text-[var(--foreground)] shadow-xl",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)]/70 px-3 py-2">
        <h3 className="min-w-0 flex-1 truncate text-[0.75rem] font-semibold">{title}</h3>
        <button
          onClick={onDismiss}
          className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          aria-label="Dismiss"
        >
          <X size="0.875rem" />
        </button>
      </div>
      {bodyLines.length > 0 && (
        <div className="flex max-h-[min(26rem,58dvh)] flex-col gap-1.5 overflow-y-auto px-3 py-2.5 [-webkit-overflow-scrolling:touch]">
          {bodyLines.map(renderLine)}
        </div>
      )}
    </section>
  );
}
