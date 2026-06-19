// ──────────────────────────────────────────────
// Onboarding Tutorial — first-time guided tour
// ──────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from "react";
import { useUIStore, type ChatModeShortcut } from "../../stores/ui.store";
import { useTrackAchievement } from "../../hooks/use-achievements";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight } from "lucide-react";

// ─── Step definitions ─────────────────────────

type TourPanel =
  | "bot-browser"
  | "characters"
  | "lorebooks"
  | "presets"
  | "connections"
  | "agents"
  | "personas"
  | "settings";

interface TourStep {
  /** data-tour attribute value of the element to highlight, or null for centered modal */
  target: string | null;
  title: string;
  body: string;
  /** Preferred side for the tooltip relative to the highlighted element */
  side?: "top" | "bottom" | "left" | "right";
  /** Right-side panel to open while this step is active */
  openPanel?: TourPanel;
  /** Chat sidebar mode tab to open while this step is active */
  chatMode?: ChatModeShortcut;
  /** Open the chat sidebar without changing its mode */
  openSidebar?: boolean;
  /** Optional settings tab to show when the Settings panel is open */
  settingsTab?: string;
  /** Professor Mari sprite to display */
  sprite?: { src: string; flip?: boolean };
}

const STEPS: TourStep[] = [
  {
    target: null,
    title: "Welcome to Marinara Engine!",
    body: "Hi! I'm Professor Mari, and I will show you where the important pieces of Marinara live. This is a quick orientation tour, so you can skip it if you already know your way around.",
    sprite: { src: "/sprites/mari/Mari_wave.png" },
  },
  {
    target: "panel-bot-browser",
    title: "Browser",
    body: "The Browser helps you discover and import downloadable cards and resources. Start here when you want new characters or ready-made material to bring into your library.",
    side: "bottom",
    openPanel: "bot-browser",
    sprite: { src: "/sprites/mari/Mari_point_up_left.png", flip: true },
  },
  {
    target: "panel-characters",
    title: "Characters",
    body: "Characters are the cards your chats speak as. Create them, edit their metadata and writing fields, organize them into folders, or import cards from other tools.",
    side: "bottom",
    openPanel: "characters",
    sprite: { src: "/sprites/mari/Mari_point_up_left.png", flip: true },
  },
  {
    target: "panel-lorebooks",
    title: "Lorebooks",
    body: "Lorebooks hold reusable world facts, memories, rules, locations, and character details. Entries trigger when their keys appear, giving the model extra context only when it matters.",
    side: "bottom",
    openPanel: "lorebooks",
    sprite: { src: "/sprites/mari/Mari_point_up_left.png", flip: true },
  },
  {
    target: "panel-presets",
    title: "Presets",
    body: "Presets control prompt structure. Use them to decide how instructions, history, lore, agents, and output rules are assembled before a model receives a request.",
    side: "bottom",
    openPanel: "presets",
    sprite: { src: "/sprites/mari/Mari_point_up_left.png", flip: true },
  },
  {
    target: "panel-connections",
    title: "Connections",
    body: "Connections are the first thing to set up before chatting. Add your provider, model, endpoint, and API key here so Marinara knows where to send generations.",
    side: "bottom",
    openPanel: "connections",
    sprite: { src: "/sprites/mari/Mari_point_up_left.png", flip: true },
  },
  {
    target: "panel-agents",
    title: "Agents",
    body: "Agents add optional abilities on top of chats. They can track state, retrieve knowledge, process messages, trigger images, guide story events, and more depending on what you enable.",
    side: "bottom",
    openPanel: "agents",
    sprite: { src: "/sprites/mari/Mari_point_up_left.png", flip: true },
  },
  {
    target: "panel-personas",
    title: "Personas",
    body: "Personas define who you are in a chat. Give yourself a name, avatar, description, scenario details, and metadata so characters know who they are speaking to.",
    side: "bottom",
    openPanel: "personas",
    sprite: { src: "/sprites/mari/Mari_point_up_left.png", flip: true },
  },
  {
    target: "panel-settings",
    title: "Settings",
    body: "Settings control the whole app: appearance, behavior, imports, themes, image defaults, notifications, extensions, data tools, and other global preferences.",
    side: "bottom",
    openPanel: "settings",
    settingsTab: "general",
    sprite: { src: "/sprites/mari/Mari_point_up_left.png", flip: true },
  },
  {
    target: "sidebar-toggle",
    title: "Chats",
    body: "Now let's open the Chats tab. This is where your Conversations, Roleplays, and Games live, with folders, search, sorting, and branch-aware chat lists.",
    side: "right",
    openSidebar: true,
    sprite: { src: "/sprites/mari/Mari_point_middle_left.png" },
  },
  {
    target: "chat-mode-conversation",
    title: "Conversation Mode",
    body: "Conversation mode feels like private DMs. Use it for casual character chats, statuses, schedules, autonomous messages, commands, selfies, and quick back-and-forth texting.",
    side: "right",
    chatMode: "conversation",
    sprite: { src: "/sprites/mari/Mari_point_middle_left.png" },
  },
  {
    target: "chat-mode-roleplay",
    title: "Roleplay Mode",
    body: "Roleplay mode is for co-writing scenes and immersive stories. It supports richer narration, lorebooks, branches, summaries, author's notes, trackers, agents, galleries, and roleplay-focused controls.",
    side: "right",
    chatMode: "roleplay",
    sprite: { src: "/sprites/mari/Mari_point_middle_left.png" },
  },
  {
    target: "chat-mode-game",
    title: "Game Mode",
    body: "Game mode turns Marinara into an RPG-style adventure with an AI Game Master. Use it for party members, goals, maps, dice, session history, journals, combat, and custom HUD widgets.",
    side: "right",
    chatMode: "game",
    sprite: { src: "/sprites/mari/Mari_point_middle_left.png" },
  },
  {
    target: "panel-settings",
    title: "Migrating from SillyTavern?",
    body: "If you have characters, chats, or presets from SillyTavern, open Settings and use the Import tab. Marinara can bring those files in so you do not have to rebuild your library by hand.",
    side: "bottom",
    openPanel: "settings",
    settingsTab: "import",
    sprite: { src: "/sprites/mari/Mari_thinking.png" },
  },
  {
    target: "panel-connections",
    title: "You're All Set!",
    body: "Professor Mari is available from the Home page whenever you need help. For your first real step, set up a Connection so Marinara can talk to a model.\n\nThank you for trying Marinara Engine. Have fun, and please report bugs or rough edges through the ME Discord or GitHub so we can keep improving it.",
    side: "bottom",
    openPanel: "connections",
    sprite: { src: "/sprites/mari/Mari_greet.png" },
  },
];

// ─── Spotlight overlay helpers ────────────────

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8; // px padding around the spotlight cutout

function getTargetRect(target: string): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function _buildClipPath(rect: Rect): string {
  const t = Math.max(0, rect.top - PAD);
  const l = Math.max(0, rect.left - PAD);
  const b = rect.top + rect.height + PAD;
  const r = rect.left + rect.width + PAD;
  const rad = 12; // border-radius in px for the cutout
  // Use inset with round for a nice cutout
  return `polygon(
    0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
    ${l}px ${t + rad}px,
    ${l + rad}px ${t}px,
    ${r - rad}px ${t}px,
    ${r}px ${t + rad}px,
    ${r}px ${b - rad}px,
    ${r - rad}px ${b}px,
    ${l + rad}px ${b}px,
    ${l}px ${b - rad}px,
    ${l}px ${t + rad}px
  )`;
}

// ─── Tooltip position ─────────────────────────

function computeTooltipStyle(rect: Rect, side: "top" | "bottom" | "left" | "right" = "right"): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isMobile = vw < 640;
  const VIEWPORT_MARGIN = isMobile ? 12 : 16;
  const TOOLTIP_W = isMobile ? Math.min(vw - VIEWPORT_MARGIN * 2, 320) : Math.min(320, vw - VIEWPORT_MARGIN * 2);
  const GAP = isMobile ? 8 : 16;
  const available = {
    right: vw - (rect.left + rect.width + GAP + PAD) - VIEWPORT_MARGIN,
    left: rect.left - GAP - PAD - VIEWPORT_MARGIN,
    bottom: vh - (rect.top + rect.height + GAP + PAD) - VIEWPORT_MARGIN,
    top: rect.top - GAP - PAD - VIEWPORT_MARGIN,
  };

  // On small screens, always center horizontally and position below target
  if (isMobile) {
    const top = Math.min(rect.top + rect.height + GAP + PAD, vh * 0.55);
    return {
      position: "fixed",
      top,
      left: (vw - TOOLTIP_W) / 2,
      width: TOOLTIP_W,
      maxHeight: `${Math.max(200, vh - top - VIEWPORT_MARGIN)}px`,
      overflowY: "auto" as const,
      overflowX: "hidden" as const,
      overscrollBehavior: "contain" as const,
    };
  }

  const minScrollableHeight = isMobile ? 220 : 340;
  const preferredVerticalSide = available.bottom >= available.top ? "bottom" : "top";
  let placement = side;

  if (side === "right" && available.right < TOOLTIP_W && available.left >= TOOLTIP_W) {
    placement = "left";
  } else if (side === "left" && available.left < TOOLTIP_W && available.right >= TOOLTIP_W) {
    placement = "right";
  } else if (side === "bottom" && available.bottom < minScrollableHeight && available.top >= minScrollableHeight) {
    placement = "top";
  } else if (side === "top" && available.top < minScrollableHeight && available.bottom >= minScrollableHeight) {
    placement = "bottom";
  } else if ((side === "right" || side === "left") && available.right < TOOLTIP_W && available.left < TOOLTIP_W) {
    placement = preferredVerticalSide;
  } else if (
    (side === "top" || side === "bottom") &&
    available.top < minScrollableHeight &&
    available.bottom < minScrollableHeight
  ) {
    placement = available.right >= available.left ? "right" : "left";
  }

  let maxHeight = vh - VIEWPORT_MARGIN * 2;

  let top = 0;
  let left = 0;

  if (placement === "right") {
    maxHeight = Math.max(minScrollableHeight, vh - VIEWPORT_MARGIN * 2);
    top = rect.top + rect.height / 2 - maxHeight / 2;
    left = rect.left + rect.width + GAP + PAD;
    if (left + TOOLTIP_W > vw - VIEWPORT_MARGIN) {
      left = rect.left - TOOLTIP_W - GAP - PAD;
    }
  } else if (placement === "left") {
    maxHeight = Math.max(minScrollableHeight, vh - VIEWPORT_MARGIN * 2);
    top = rect.top + rect.height / 2 - maxHeight / 2;
    left = rect.left - TOOLTIP_W - GAP - PAD;
    if (left < VIEWPORT_MARGIN) {
      left = rect.left + rect.width + GAP + PAD;
    }
  } else if (placement === "bottom") {
    maxHeight = Math.max(minScrollableHeight, Math.min(vh - VIEWPORT_MARGIN * 2, available.bottom));
    top = rect.top + rect.height + GAP + PAD;
    left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
  } else {
    maxHeight = Math.max(minScrollableHeight, Math.min(vh - VIEWPORT_MARGIN * 2, available.top));
    top = rect.top - GAP - PAD - maxHeight;
    left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
  }

  // Clamp within viewport
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - TOOLTIP_W - VIEWPORT_MARGIN));
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - maxHeight - VIEWPORT_MARGIN));

  return {
    position: "fixed",
    top,
    left,
    width: TOOLTIP_W,
    maxHeight: `${maxHeight}px`,
    overflowY: "auto",
    overflowX: "hidden",
    overscrollBehavior: "contain",
  };
}

// ─── Card content (shared between centered & positioned variants) ──

function TourCardContent({
  step,
  currentStep,
  isLast,
  onNext,
  onSkip,
}: {
  step: number;
  currentStep: TourStep;
  isLast: boolean;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      {/* Professor Mari sprite */}
      {currentStep.sprite && (
        <div className="mb-2 flex justify-center">
          <img
            src={currentStep.sprite.src}
            alt="Professor Mari"
            className="h-32 max-h-[15vh] w-auto object-contain drop-shadow-lg"
            style={currentStep.sprite.flip ? { transform: "scaleX(-1)" } : undefined}
            draggable={false}
          />
        </div>
      )}

      {/* Header */}
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">{currentStep.title}</h3>
      </div>

      {/* Body */}
      <p className="mb-4 break-words text-xs leading-relaxed text-[var(--muted-foreground)]">
        {currentStep.body.split("\n").map((line, i, arr) => (
          <span key={i}>
            {line.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <strong key={j} className="font-semibold text-[var(--foreground)]">
                  {part.slice(2, -2)}
                </strong>
              ) : (
                <span key={j}>{part}</span>
              ),
            )}
            {i < arr.length - 1 && <br />}
          </span>
        ))}
      </p>

      {/* Progress dots */}
      <div className="mb-3 flex items-center justify-center gap-1.5">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === step
                ? "w-4 bg-[var(--primary)]"
                : i < step
                  ? "w-1.5 bg-[var(--primary)]/40"
                  : "w-1.5 bg-[var(--muted-foreground)]/20"
            }`}
          />
        ))}
      </div>

      {/* Buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={onSkip}
          className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          {step === 0 ? "Skip Tutorial" : "Skip"}
        </button>
        <button
          onClick={onNext}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-1.5 text-xs font-medium text-[var(--primary-foreground)] shadow-sm transition-all hover:opacity-90 active:scale-95"
        >
          {isLast ? "Get Started" : "Next"}
          {!isLast && <ChevronRight size="0.75rem" />}
        </button>
      </div>
    </>
  );
}

// ─── Main component ───────────────────────────

export function OnboardingTutorial() {
  const hasCompleted = useUIStore((s) => s.hasCompletedOnboarding);
  if (hasCompleted) return null;
  return <OnboardingTutorialInner />;
}

function OnboardingTutorialInner() {
  const setCompleted = useUIStore((s) => s.setHasCompletedOnboarding);
  const openRightPanel = useUIStore((s) => s.openRightPanel);
  const closeRightPanel = useUIStore((s) => s.closeRightPanel);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const requestChatModeShortcut = useUIStore((s) => s.requestChatModeShortcut);
  const trackAchievement = useTrackAchievement();

  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const rafRef = useRef<number>(0);

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // ── Side-effects when step changes ──
  useEffect(() => {
    if (currentStep.chatMode) {
      closeRightPanel();
      requestChatModeShortcut(currentStep.chatMode);
      return;
    }

    if (currentStep.openSidebar) {
      closeRightPanel();
      setSidebarOpen(true);
      return;
    }

    if (currentStep.openPanel) {
      setSidebarOpen(false);
      openRightPanel(currentStep.openPanel);
      if (currentStep.settingsTab) {
        setSettingsTab(currentStep.settingsTab);
      }
    }
  }, [closeRightPanel, currentStep, openRightPanel, requestChatModeShortcut, setSettingsTab, setSidebarOpen]);

  // Track the target element position (handles resize/scroll)
  const lastRectRef = useRef<Rect | null>(null);
  const updateRect = useCallback(() => {
    if (!currentStep?.target) {
      if (lastRectRef.current !== null) {
        lastRectRef.current = null;
        setTargetRect(null);
      }
      return;
    }
    const r = getTargetRect(currentStep.target);
    // Only update state if the rect actually changed
    const prev = lastRectRef.current;
    if (!r && prev) {
      lastRectRef.current = null;
      setTargetRect(null);
    } else if (
      r &&
      (!prev || r.top !== prev.top || r.left !== prev.left || r.width !== prev.width || r.height !== prev.height)
    ) {
      lastRectRef.current = r;
      setTargetRect(r);
    }
    rafRef.current = requestAnimationFrame(updateRect);
  }, [currentStep?.target]);

  useEffect(() => {
    updateRect();
    return () => cancelAnimationFrame(rafRef.current);
  }, [updateRect]);

  const finish = useCallback(() => {
    setCompleted(true);
    trackAchievement.mutate("tutorial_completed");
  }, [setCompleted, trackAchievement]);

  const next = useCallback(() => {
    if (isLast) {
      finish();
    } else {
      setStep((s) => s + 1);
    }
  }, [isLast, finish]);

  const isCentered = !currentStep.target || !targetRect;

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]">
      {/* Pulsing highlight ring around the target element */}
      {targetRect && (
        <div
          className="pointer-events-none fixed rounded-xl ring-2 ring-[var(--primary)] animate-pulse"
          style={{
            top: targetRect.top - PAD,
            left: targetRect.left - PAD,
            width: targetRect.width + PAD * 2,
            height: targetRect.height + PAD * 2,
            boxShadow: "0 0 16px 4px color-mix(in srgb, var(--primary) 40%, transparent)",
          }}
        />
      )}

      {/* Centered steps use a flex wrapper so Framer Motion transforms don't override CSS centering */}
      {isCentered ? (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto rounded-2xl border border-[var(--border)] bg-[var(--popover)] p-5 shadow-2xl ring-1 ring-[var(--primary)]/20 max-h-[90vh] overflow-x-hidden overflow-y-auto"
              style={{ width: Math.min(380, window.innerWidth - 32) }}
            >
              <TourCardContent step={step} currentStep={currentStep} isLast={isLast} onNext={next} onSkip={finish} />
            </motion.div>
          </AnimatePresence>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto rounded-2xl border border-[var(--border)] bg-[var(--popover)] p-5 shadow-2xl ring-1 ring-[var(--primary)]/20"
            style={computeTooltipStyle(targetRect!, currentStep.side)}
          >
            <TourCardContent step={step} currentStep={currentStep} isLast={isLast} onNext={next} onSkip={finish} />
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
