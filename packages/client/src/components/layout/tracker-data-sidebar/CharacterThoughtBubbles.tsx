import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { TrackerPanelSide } from "../../../stores/ui.store";
import { cn } from "../../../lib/utils";
import { visibleText } from "./tracker-data-sidebar.helpers";
import { InlineEdit } from "./tracker-data-sidebar.controls";

function ThoughtBubble({
  value,
  onSave,
  tailSide = "left",
}: {
  value: string | null | undefined;
  onSave?: (value: string) => void;
  tailSide?: "left" | "right";
}) {
  const tailOnLeft = tailSide === "left";
  const thoughtText = visibleText(value, "Thoughts").replace(/\s+/g, " ");
  const thoughtBubbleSize = thoughtText.length <= 38 ? "short" : thoughtText.length <= 116 ? "medium" : "long";
  const compactThoughtBubble = thoughtBubbleSize !== "long";
  const thoughtDots = tailOnLeft
    ? ["h-1.5 w-1.5 opacity-55", "h-2 w-2 opacity-70", "h-2.5 w-2.5 opacity-85"]
    : ["h-2.5 w-2.5 opacity-85", "h-2 w-2 opacity-70", "h-1.5 w-1.5 opacity-55"];

  return (
    <div className={cn("relative flex max-w-full", tailOnLeft ? "justify-start pl-3.5" : "justify-end pr-3.5")}>
      <div
        className={cn(
          "pointer-events-none absolute top-2.5 flex items-center gap-1",
          tailOnLeft ? "left-0 -translate-x-[calc(100%-0.125rem)]" : "right-0 translate-x-[calc(100%-0.125rem)]",
        )}
      >
        {thoughtDots.map((sizeClass, index) => (
          <span
            key={sizeClass}
            className={cn(
              "animate-pulse rounded-full bg-[color-mix(in_srgb,var(--background)_74%,transparent)] ring-1 ring-[var(--primary)]/24 shadow-[0_0_8px_color-mix(in_srgb,var(--primary)_18%,transparent)] backdrop-blur-md",
              sizeClass,
            )}
            style={{ animationDelay: `${index * 140}ms` }}
          />
        ))}
      </div>
      <span
        className={cn(
          "pointer-events-none absolute top-[0.8125rem] z-[1] h-4 w-4 rounded-full bg-[color-mix(in_srgb,var(--background)_74%,transparent)] ring-1 ring-[var(--primary)]/24 shadow-[0_0_10px_color-mix(in_srgb,var(--primary)_18%,transparent)] backdrop-blur-xl",
          tailOnLeft ? "left-[0.4375rem]" : "right-[0.4375rem]",
        )}
      />
      <span
        className={cn(
          "pointer-events-none absolute top-[0.875rem] z-[1] h-3.5 w-3.5 rounded-full bg-[color-mix(in_srgb,var(--background)_74%,transparent)] backdrop-blur-xl",
          tailOnLeft ? "left-2" : "right-2",
        )}
      />
      <div
        className={cn(
          "relative z-[2] overflow-hidden border border-[var(--primary)]/22 bg-[color-mix(in_srgb,var(--background)_74%,transparent)] text-[var(--foreground)] shadow-[0_0_18px_color-mix(in_srgb,var(--primary)_16%,transparent)] backdrop-blur-xl",
          thoughtBubbleSize === "short" &&
            "inline-flex min-h-10 w-fit min-w-[4.5rem] max-w-[9.5rem] rounded-full px-4 py-2",
          thoughtBubbleSize === "medium" &&
            "inline-flex min-h-11 w-fit min-w-[8.5rem] max-w-[13.5rem] rounded-full px-4 py-2",
          thoughtBubbleSize === "long" && "max-h-[4.75rem] min-h-12 w-full rounded-[1.25rem] px-3 py-2",
        )}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_12%,transparent),transparent_46%,color-mix(in_srgb,var(--accent)_12%,transparent))]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--foreground)]/12" />
        <div
          className={cn(
            "relative z-[1]",
            compactThoughtBubble && "flex min-h-6 w-fit max-w-full items-center justify-center",
          )}
        >
          {onSave ? (
            <InlineEdit
              value={value ?? ""}
              onSave={onSave}
              placeholder="Thoughts"
              className={cn(
                "px-0 py-0 text-[0.625rem] font-medium italic leading-[1.15] [--foreground:color-mix(in_srgb,var(--foreground)_94%,var(--primary)_6%)] [--muted-foreground:color-mix(in_srgb,var(--muted-foreground)_82%,var(--foreground)_18%)] hover:bg-[var(--primary)]/12",
                compactThoughtBubble && "w-fit max-w-full",
                thoughtBubbleSize === "short" && "min-h-6 min-w-0 text-center",
                thoughtBubbleSize === "medium" && "min-h-7 min-w-0",
                thoughtBubbleSize === "long" && "min-h-[3.25rem]",
              )}
              showEditHint={false}
              threeLinePreview
            />
          ) : (
            <p
              className={cn(
                "text-[0.625rem] font-medium italic leading-[1.15] text-[color-mix(in_srgb,var(--foreground)_94%,var(--primary)_6%)]",
                compactThoughtBubble && "w-fit max-w-full",
                thoughtBubbleSize === "short" ? "line-clamp-2 text-center" : "line-clamp-3",
              )}
            >
              {thoughtText}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function InlineThoughtBubble({
  value,
  onSave,
}: {
  value: string | null | undefined;
  onSave?: (value: string) => void;
}) {
  return (
    <div className="relative mx-1 mt-1 min-w-0 overflow-hidden rounded-sm border border-[var(--primary)]/20 bg-[color-mix(in_srgb,var(--background)_58%,transparent)] px-1 py-1 text-[var(--foreground)] shadow-[0_0_14px_color-mix(in_srgb,var(--primary)_12%,transparent)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_48%,color-mix(in_srgb,var(--accent)_10%,transparent))]" />
      <div className="relative z-[1] min-w-0">
        {onSave ? (
          <InlineEdit
            value={value ?? ""}
            onSave={onSave}
            placeholder="Thoughts"
            className="min-h-[2rem] w-full px-0 py-0 text-[0.625rem] font-medium italic leading-[1.15] [--foreground:color-mix(in_srgb,var(--foreground)_94%,var(--primary)_6%)] [--muted-foreground:color-mix(in_srgb,var(--muted-foreground)_82%,var(--foreground)_18%)] hover:bg-[var(--primary)]/12"
            showEditHint={false}
            threeLinePreview
          />
        ) : (
          <p className="line-clamp-3 text-[0.625rem] font-medium italic leading-[1.15] text-[color-mix(in_srgb,var(--foreground)_94%,var(--primary)_6%)]">
            {visibleText(value, "Thoughts")}
          </p>
        )}
      </div>
    </div>
  );
}

export function ExternalThoughtBubble({
  anchorRef,
  value,
  onSave,
  panelSide,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  value: string | null | undefined;
  onSave?: (value: string) => void;
  panelSide: TrackerPanelSide;
}) {
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    outsideSide: "left" | "right";
  } | null>(null);

  useLayoutEffect(() => {
    if (!value && !onSave) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        setPosition((current) => (current === null ? current : null));
        return;
      }

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const outsideSide = panelSide === "left" ? "right" : "left";
      const overlap = 4;
      const viewportMargin = 6;
      const preferredWidth = Math.min(240, Math.max(184, rect.width * 0.72));
      const outsideLaneWidth =
        outsideSide === "left"
          ? rect.left + overlap - viewportMargin
          : viewportWidth - rect.right + overlap - viewportMargin;
      const width = Math.round(
        Math.min(
          preferredWidth,
          viewportWidth - viewportMargin * 2,
          outsideLaneWidth >= 148 ? outsideLaneWidth : preferredWidth,
        ),
      );
      const desiredLeft = outsideSide === "left" ? rect.left - width + overlap : rect.right - overlap;
      const desiredTop = rect.top + Math.min(48, Math.max(28, rect.height * 0.18));
      const maxLeft = Math.max(viewportMargin, viewportWidth - width - viewportMargin);
      const maxTop = Math.max(viewportMargin, viewportHeight - 88);
      const left = Math.round(Math.max(viewportMargin, Math.min(maxLeft, desiredLeft)));
      const top = Math.round(Math.max(viewportMargin, Math.min(maxTop, desiredTop)));
      setPosition((current) =>
        current?.left === left && current.top === top && current.width === width && current.outsideSide === outsideSide
          ? current
          : { left, top, width, outsideSide },
      );
    };

    updatePosition();
    const anchor = anchorRef.current;
    const resizeObserver = anchor ? new ResizeObserver(updatePosition) : null;
    if (anchor) resizeObserver?.observe(anchor);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, onSave, panelSide, value]);

  if (!position || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[60] drop-shadow-[0_8px_14px_rgba(0,0,0,0.24)]"
      style={{ left: position.left, top: position.top, width: position.width }}
    >
      <ThoughtBubble value={value} onSave={onSave} tailSide={position.outsideSide === "left" ? "right" : "left"} />
    </div>,
    document.body,
  );
}
