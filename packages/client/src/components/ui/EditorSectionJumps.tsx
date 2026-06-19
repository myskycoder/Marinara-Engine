import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

export type EditorSectionJump = {
  id: string;
  label: string;
};

export function EditorSectionJumps({
  items,
  className,
}: {
  items: readonly EditorSectionJump[];
  className?: string;
}) {
  const scrollToSection = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  };

  return (
    <nav
      aria-label="Card sections"
      className={cn("mb-6 flex flex-wrap gap-1.5 text-xs text-[var(--muted-foreground)]", className)}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => scrollToSection(item.id)}
          className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 font-medium transition-colors hover:border-[var(--primary)]/35 hover:bg-[var(--accent)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/35"
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export function EditorSectionAnchor({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-6", className)}>
      {children}
    </section>
  );
}
