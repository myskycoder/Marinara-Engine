// ──────────────────────────────────────────────
// Game: Turn-Based Combat UI
//
// Classic JRPG/FF-style battle screen with:
// - Party members (left/bottom) vs. Enemies (right/top)
// - HP/MP bars with animated depletion
// - Turn order timeline
// - Action menu (Attack, Skill, Defend, Item, Flee)
// - Floating damage numbers
// - Status effect icons
// - Victory / defeat overlays
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { audioManager } from "../../lib/game-audio";
import { useGameAssetStore } from "../../stores/game-asset.store";
import { useCombatRound, useCombatLoot } from "../../hooks/use-game";
import { AnimatedText } from "./AnimatedText";
import type {
  Combatant,
  CombatAttackResult,
  CombatRoundResult,
  CombatPlayerAction,
  CombatSummary,
} from "@marinara-engine/shared";
import {
  Heart,
  Droplets,
  Sword,
  Shield,
  Sparkles,
  Backpack,
  Wind,
  Skull,
  Zap,
  ChevronRight,
  Trophy,
  SkullIcon,
} from "lucide-react";

// ── Types ──

type CombatPhase =
  | "intro"
  | "player-turn"
  | "skill-select"
  | "item-select"
  | "target-select"
  | "resolving"
  | "animating"
  | "round-end"
  | "victory"
  | "defeat";

interface DamagePopup {
  id: string;
  targetId: string;
  amount: number;
  isCritical: boolean;
  isMiss: boolean;
  isHeal?: boolean;
  /** Elemental reaction label shown above the damage number */
  reactionLabel?: string;
}

interface GameCombatUIProps {
  chatId: string;
  /** Player party combatants. */
  party: Combatant[];
  /** Enemy combatants. */
  enemies: Combatant[];
  /** Player inventory items available during combat. */
  inventoryItems?: Array<{ name: string; quantity: number; description?: string }>;
  /** Called when combat ends (victory, defeat, or flee). Receives a summary for GM narration. */
  onCombatEnd: (outcome: "victory" | "defeat" | "flee", summary: CombatSummary) => void;
  /** Called after a combat item successfully resolves so the used item can be consumed. */
  onInventoryItemUsed?: (itemName: string) => void | Promise<void>;
  /** Opens the full inventory panel for inspection/management. */
  onOpenInventory?: () => void;
  /** GM narration to display alongside combat. */
  narration?: string;
  /** Optional controls rendered immediately above the bottom combat panel. */
  combatControlsSlot?: ReactNode;
  /** Suggested sprite focus for the full-body overlay. */
  onSpriteSuggestionChange?: (suggestion: { name: string; pose: string } | null) => void;
  /** Whether we're waiting for a GM response. */
  _isStreaming?: boolean;
}

// ── Constants ──

const ACTION_MENU = [
  { id: "attack", label: "Attack", icon: Sword, color: "text-red-400" },
  { id: "skill", label: "Skills", icon: Sparkles, color: "text-blue-400" },
  { id: "defend", label: "Defend", icon: Shield, color: "text-amber-400" },
  { id: "item", label: "Items", icon: Backpack, color: "text-green-400" },
  { id: "flee", label: "Flee", icon: Wind, color: "text-gray-400" },
] as const;

const COMBAT_SFX = {
  attack: "sfx/combat/sword-swing",
  criticalHit: "sfx/combat/sword-swing-2",
  miss: "sfx/combat/sword-swing-3",
  defend: "sfx/combat/chainmail",
  magic: "sfx/combat/magic-cast",
  hit: "sfx/combat/spell-hit",
  menuSelect: "sfx/ui/menu-confirm",
  menuHover: "sfx/ui/menu-hover",
  victory: "sfx/ui/coin-pickup",
} as const;

const DAMAGE_DISPLAY_MS = 1200;
const INTRO_DURATION_MS = 1500;

/** Element‐to‐color mapping for aura badges. */
const ELEMENT_AURA_COLORS: Record<string, string> = {
  fire: "#ff4500",
  pyro: "#ff4500",
  ice: "#00bfff",
  cryo: "#00bfff",
  lightning: "#8b5cf6",
  electro: "#9b59b6",
  hydro: "#4169e1",
  anemo: "#77dd77",
  wind: "#77dd77",
  geo: "#daa520",
  dendro: "#228b22",
  poison: "#9400d3",
  holy: "#fffacd",
  shadow: "#4a0080",
  physical: "#c0c0c0",
  quantum: "#6a0dad",
  imaginary: "#ffd700",
};

const STATUS_EFFECT_EMOJI_RULES: Array<{ pattern: RegExp; emoji: string }> = [
  { pattern: /bleed|hemorrhage/i, emoji: "🩸" },
  { pattern: /poison|venom|toxin/i, emoji: "☠️" },
  { pattern: /burn|ignite|scorch/i, emoji: "🔥" },
  { pattern: /bless|holy|radiant/i, emoji: "✨" },
  { pattern: /regen|recover|mend|heal/i, emoji: "💚" },
  { pattern: /shield|barrier|ward|guard|fortify/i, emoji: "🛡️" },
  { pattern: /haste|swift|quick/i, emoji: "💨" },
  { pattern: /slow|chill|freeze/i, emoji: "🧊" },
  { pattern: /stun|shock|paraly/i, emoji: "⚡" },
  { pattern: /curse|weaken|blind|fear/i, emoji: "💀" },
];

function getStatusEffectEmoji(effect: NonNullable<Combatant["statusEffects"]>[number]): string {
  for (const rule of STATUS_EFFECT_EMOJI_RULES) {
    if (rule.pattern.test(effect.name)) return rule.emoji;
  }

  if (effect.modifier > 0) {
    if (effect.stat === "attack") return "⚔️";
    if (effect.stat === "defense") return "🛡️";
    if (effect.stat === "speed") return "💨";
    return "💚";
  }

  if (effect.stat === "attack") return "⚔️";
  if (effect.stat === "defense") return "🪨";
  if (effect.stat === "speed") return "⚡";
  return "💥";
}

// ── Component ──

export function GameCombatUI({
  chatId,
  party: initialParty,
  enemies: initialEnemies,
  inventoryItems = [],
  onCombatEnd,
  onInventoryItemUsed,
  onOpenInventory,
  narration,
  combatControlsSlot,
  onSpriteSuggestionChange,
}: GameCombatUIProps) {
  // Combat state
  const [phase, setPhase] = useState<CombatPhase>("intro");
  const [round, setRound] = useState(1);
  const [party, setParty] = useState<Combatant[]>(initialParty);
  const [enemies, setEnemies] = useState<Combatant[]>(initialEnemies);
  const [activePlayerIndex, setActivePlayerIndex] = useState(0);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [turnOrder, setTurnOrder] = useState<Array<{ id: string; name: string }>>([]);
  const [damagePopups, setDamagePopups] = useState<DamagePopup[]>([]);
  const [roundResult, setRoundResult] = useState<CombatRoundResult | null>(null);
  const [animatingActionIndex, setAnimatingActionIndex] = useState(-1);
  const [loot, setLoot] = useState<Array<{ name: string; quantity?: number }> | null>(null);
  const [actionMenuIndex, setActionMenuIndex] = useState(0);

  const combatRound = useCombatRound();
  const combatLoot = useCombatLoot();
  const manifest = useGameAssetStore((s) => s.manifest);
  const assets = manifest?.assets ?? null;

  const popupCounter = useRef(0);
  const introTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Intro phase ──
  useEffect(() => {
    introTimer.current = setTimeout(() => {
      setPhase("player-turn");
    }, INTRO_DURATION_MS);
    return () => clearTimeout(introTimer.current);
  }, []);

  // ── All combatants merged for server requests ──
  const allCombatants = useMemo(
    () => [
      ...party.map((c) => ({ ...c, side: "player" as const })),
      ...enemies.map((c) => ({ ...c, side: "enemy" as const })),
    ],
    [party, enemies],
  );

  // ── Build a post-combat summary for the GM ──
  const buildSummary = useCallback(
    (outcome: "victory" | "defeat" | "flee", lootDrops?: Array<{ name: string; quantity?: number }>): CombatSummary => {
      return {
        outcome,
        rounds: round,
        party: party.map((c) => ({
          name: c.name,
          hp: c.hp,
          maxHp: c.maxHp,
          ko: c.hp <= 0,
          statusEffects: (c.statusEffects ?? []).map((e) => e.name),
        })),
        enemies: enemies.map((c) => ({
          name: c.name,
          defeated: c.hp <= 0,
          hp: c.hp,
          maxHp: c.maxHp,
        })),
        loot: lootDrops,
      };
    },
    [party, enemies, round],
  );

  // ── Active player ──
  const activePlayer = party[activePlayerIndex] ?? null;
  const selectedSkill = activePlayer?.skills?.find((skill) => skill.id === selectedSkillId) ?? null;
  const selectingAllyTarget = selectedAction === "skill" && selectedSkill?.type === "heal";

  const combatSpriteSuggestion = useMemo(() => {
    if (phase === "victory") {
      const celebrant = activePlayer ?? party.find((member) => member.hp > 0) ?? party[0] ?? null;
      return celebrant ? { name: celebrant.name, pose: "victory" } : null;
    }

    if (phase === "defeat") {
      const fallenMember = activePlayer ?? party[0] ?? null;
      return fallenMember ? { name: fallenMember.name, pose: "hurt" } : null;
    }

    if (phase === "animating" && roundResult && animatingActionIndex >= 0) {
      const action = roundResult.actions[animatingActionIndex] ?? null;
      if (action) {
        const attacker = allCombatants.find((combatant) => combatant.id === action.attackerId) ?? null;
        const defender = allCombatants.find((combatant) => combatant.id === action.defenderId) ?? null;

        if (attacker?.side === "player") {
          return { name: attacker.name, pose: action.skillName ? "casting" : "attack" };
        }
        if (defender?.side === "player") {
          return { name: defender.name, pose: action.isHeal ? "casting" : "hurt" };
        }
      }
    }

    if (activePlayer) {
      if (phase === "resolving") {
        if (selectedAction === "defend") return { name: activePlayer.name, pose: "defend" };
        if (selectedAction === "item") return { name: activePlayer.name, pose: "casting" };
        if (selectedAction === "skill") return { name: activePlayer.name, pose: "casting" };
        if (selectedAction === "attack") return { name: activePlayer.name, pose: "attack" };
      }

      if (
        phase === "skill-select" ||
        phase === "item-select" ||
        (phase === "target-select" && selectedAction === "skill")
      ) {
        return { name: activePlayer.name, pose: "casting" };
      }

      return { name: activePlayer.name, pose: "battle_stance" };
    }

    return null;
  }, [activePlayer, allCombatants, animatingActionIndex, party, phase, roundResult, selectedAction]);

  useEffect(() => {
    onSpriteSuggestionChange?.(combatSpriteSuggestion);
    return () => {
      onSpriteSuggestionChange?.(null);
    };
  }, [combatSpriteSuggestion, onSpriteSuggestionChange]);

  // ── Play SFX helper ──
  const playSfx = useCallback(
    (tag: string) => {
      audioManager.playSfx(tag, assets);
    },
    [assets],
  );

  // ── Spawn damage popup ──
  const spawnDamage = useCallback(
    (
      targetId: string,
      amount: number,
      isCritical: boolean,
      isMiss: boolean,
      reactionLabel?: string,
      isHeal = false,
    ) => {
      const id = `dmg-${++popupCounter.current}`;
      const popup: DamagePopup = { id, targetId, amount, isCritical, isMiss, reactionLabel, isHeal };
      setDamagePopups((prev) => [...prev, popup]);
      setTimeout(() => {
        setDamagePopups((prev) => prev.filter((p) => p.id !== id));
      }, DAMAGE_DISPLAY_MS);
    },
    [],
  );

  // ── Update a combatant's HP during animation ──
  const updateCombatantHp = useCallback((id: string, newHp: number) => {
    setParty((prev) => prev.map((c) => (c.id === id ? { ...c, hp: Math.max(0, newHp) } : c)));
    setEnemies((prev) => prev.map((c) => (c.id === id ? { ...c, hp: Math.max(0, newHp) } : c)));
  }, []);

  // ── Apply round end — check victory/defeat ──
  const applyRoundEnd = useCallback(
    (updatedCombatants: Combatant[]) => {
      const updatedParty = party.map((p) => {
        const u = updatedCombatants.find((c) => c.id === p.id);
        return u
          ? {
              ...p,
              hp: u.hp,
              mp: u.mp ?? p.mp,
              maxMp: u.maxMp ?? p.maxMp,
              statusEffects: u.statusEffects,
              elementAura: u.elementAura,
              element: u.element,
            }
          : p;
      });
      const updatedEnemies = enemies.map((e) => {
        const u = updatedCombatants.find((c) => c.id === e.id);
        return u
          ? {
              ...e,
              hp: u.hp,
              mp: u.mp ?? e.mp,
              maxMp: u.maxMp ?? e.maxMp,
              statusEffects: u.statusEffects,
              elementAura: u.elementAura,
              element: u.element,
            }
          : e;
      });

      setParty(updatedParty);
      setEnemies(updatedEnemies);
      setAnimatingActionIndex(-1);

      const partyAlive = updatedParty.some((c) => c.hp > 0);
      const enemiesAlive = updatedEnemies.some((c) => c.hp > 0);

      if (!enemiesAlive) {
        playSfx(COMBAT_SFX.victory);
        setPhase("victory");
        combatLoot.mutate({ chatId, enemyCount: enemies.length }, { onSuccess: (data) => setLoot(data.drops) });
        return;
      }

      if (!partyAlive) {
        setPhase("defeat");
        return;
      }

      setRound((r) => r + 1);
      setPhase("player-turn");
      setSelectedAction(null);
      setSelectedSkillId(null);
      setActivePlayerIndex(0);
    },
    [party, enemies, chatId, playSfx, combatLoot],
  );

  // ── Animate round results one action at a time ──
  const animateRoundResults = useCallback(
    (result: CombatRoundResult, updatedCombatants: Combatant[]) => {
      setPhase("animating");
      let actionIdx = 0;

      const playNextAction = () => {
        if (actionIdx >= result.actions.length) {
          applyRoundEnd(updatedCombatants);
          return;
        }

        const action = result.actions[actionIdx]!;
        setAnimatingActionIndex(actionIdx);

        if (action.isMiss) playSfx(COMBAT_SFX.miss);
        else if (action.isCritical) playSfx(COMBAT_SFX.criticalHit);
        else playSfx(COMBAT_SFX.hit);

        // Show reaction text if an elemental reaction triggered
        if (action.reaction) {
          spawnDamage(
            action.defenderId,
            action.finalDamage,
            action.isCritical,
            action.isMiss,
            action.reaction.reaction,
            action.isHeal ?? false,
          );
        } else {
          spawnDamage(
            action.defenderId,
            action.finalDamage,
            action.isCritical,
            action.isMiss,
            undefined,
            action.isHeal ?? false,
          );
        }

        if (!action.isMiss) updateCombatantHp(action.defenderId, action.remainingHp);

        actionIdx++;
        setTimeout(playNextAction, action.reaction ? 1200 : 800);
      };

      setTimeout(playNextAction, 400);
    },
    [playSfx, spawnDamage, applyRoundEnd, updateCombatantHp],
  );

  // ── Resolve a combat round on the server ──
  const resolveRound = useCallback(
    (playerAction: CombatPlayerAction, usedItemName?: string) => {
      setPhase("resolving");

      combatRound.mutate(
        {
          chatId,
          combatants: allCombatants
            .filter((c) => c.hp > 0)
            .map((c) => ({
              id: c.id,
              name: c.name,
              hp: c.hp,
              maxHp: c.maxHp,
              mp: c.mp,
              maxMp: c.maxMp,
              attack: c.attack,
              defense: c.defense,
              speed: c.speed,
              level: c.level,
              side: c.side,
              skills: c.skills,
              statusEffects: c.statusEffects,
              element: c.element,
              elementAura: c.elementAura,
            })),
          round,
          playerAction,
        },
        {
          onSuccess: (data) => {
            const result = data.result as CombatRoundResult;
            const updatedCombatants = data.combatants as Combatant[];
            if (usedItemName) {
              void onInventoryItemUsed?.(usedItemName);
            }
            setRoundResult(result);
            setTurnOrder(result.initiative.map((e) => ({ id: e.id, name: e.name })));
            animateRoundResults(result, updatedCombatants);
          },
          onError: () => setPhase("player-turn"),
        },
      );
    },
    [chatId, allCombatants, round, combatRound, onInventoryItemUsed, animateRoundResults],
  );

  // ── Handle action selection ──
  const handleActionSelect = useCallback(
    (actionId: string) => {
      playSfx(COMBAT_SFX.menuSelect);

      if (actionId === "flee") {
        onCombatEnd("flee", buildSummary("flee"));
        return;
      }
      if (actionId === "defend") {
        setSelectedAction("defend");
        resolveRound({ type: "defend" });
        return;
      }
      if (actionId === "attack") {
        setSelectedAction("attack");
        setSelectedSkillId(null);
        setPhase("target-select");
        return;
      }
      if (actionId === "skill") {
        setSelectedAction("skill");
        setSelectedSkillId(null);
        setPhase("skill-select");
        return;
      }
      if (actionId === "item") {
        setSelectedAction("item");
        setSelectedSkillId(null);
        setPhase("item-select");
        return;
      }
    },
    [playSfx, onCombatEnd, resolveRound, buildSummary],
  );

  const handleItemSelect = useCallback(
    (itemName: string) => {
      const normalizedItemName = itemName.trim();
      if (!activePlayer || !normalizedItemName) return;
      playSfx(COMBAT_SFX.menuSelect);
      setSelectedAction("item");
      setSelectedSkillId(null);
      resolveRound({ type: "item", itemId: normalizedItemName, targetId: activePlayer.id }, normalizedItemName);
    },
    [activePlayer, playSfx, resolveRound],
  );

  // ── Handle target selection ──
  const handleTargetSelect = useCallback(
    (targetId: string) => {
      playSfx(selectedAction === "skill" ? COMBAT_SFX.magic : COMBAT_SFX.attack);
      const action: CombatPlayerAction =
        selectedAction === "skill" && selectedSkillId
          ? { type: "skill", skillId: selectedSkillId, targetId }
          : { type: "attack", targetId };
      resolveRound(action);
    },
    [selectedAction, selectedSkillId, playSfx, resolveRound],
  );

  // ── Keyboard navigation for action menu ──
  useEffect(() => {
    if (phase !== "player-turn") return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "w") {
        e.preventDefault();
        setActionMenuIndex((i) => (i - 1 + ACTION_MENU.length) % ACTION_MENU.length);
        playSfx(COMBAT_SFX.menuHover);
      } else if (e.key === "ArrowDown" || e.key === "s") {
        e.preventDefault();
        setActionMenuIndex((i) => (i + 1) % ACTION_MENU.length);
        playSfx(COMBAT_SFX.menuHover);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleActionSelect(ACTION_MENU[actionMenuIndex]!.id);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [phase, actionMenuIndex, handleActionSelect, playSfx]);

  // ── Render ──

  return (
    <div className="absolute inset-0 z-30 flex min-h-0 flex-col overflow-hidden">
      {/* ── Battle scene ── */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Intro overlay */}
        {phase === "intro" && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 animate-in fade-in duration-300">
            <div className="flex flex-col items-center gap-3 animate-in zoom-in-50 duration-500">
              <Sword className="h-10 w-10 text-red-400" />
              <AnimatedText html="BATTLE START" className="text-xl font-bold tracking-wide text-white" />
              <span className="text-sm text-white/60">{enemies.map((e) => e.name).join(", ")}</span>
            </div>
          </div>
        )}

        {/* ── Enemy area (top section) ── */}
        <div className="relative flex min-h-0 flex-1 items-start justify-center gap-3 overflow-hidden px-3 pt-4 sm:gap-6 sm:px-6 sm:pt-6">
          {enemies.map((enemy) => (
            <CombatantCard
              key={enemy.id}
              combatant={enemy}
              side="enemy"
              isTargetable={phase === "target-select" && !selectingAllyTarget}
              isActive={turnOrder[0]?.id === enemy.id && phase === "animating"}
              onSelect={() => handleTargetSelect(enemy.id)}
              damagePopups={damagePopups.filter((p) => p.targetId === enemy.id)}
            />
          ))}
        </div>

        {/* ── Party area (bottom section) ── */}
        <div className="relative flex shrink-0 items-end justify-center gap-3 overflow-hidden px-3 pb-3 sm:gap-6 sm:px-6 sm:pb-4">
          {party.map((member, i) => (
            <CombatantCard
              key={member.id}
              combatant={member}
              side="player"
              isTargetable={phase === "target-select" && selectingAllyTarget}
              isActive={
                (phase === "player-turn" && i === activePlayerIndex) ||
                (turnOrder[0]?.id === member.id && phase === "animating")
              }
              onSelect={
                phase === "target-select" && selectingAllyTarget ? () => handleTargetSelect(member.id) : undefined
              }
              damagePopups={damagePopups.filter((p) => p.targetId === member.id)}
            />
          ))}
        </div>
      </div>

      {(combatControlsSlot || phase !== "intro") && (
        <div className="relative z-30 flex shrink-0 items-center justify-between gap-2 px-3 pb-1.5 sm:px-4 sm:pb-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">{combatControlsSlot}</div>
          {phase !== "intro" && (
            <div className="shrink-0 rounded-lg border border-white/10 bg-black/65 px-2.5 py-1 text-center shadow-lg backdrop-blur-md">
              <div className="text-[0.55rem] font-semibold uppercase tracking-widest text-white/40">Round</div>
              <div className="text-lg font-bold leading-none tabular-nums text-white">{round}</div>
            </div>
          )}
        </div>
      )}

      {turnOrder.length > 0 && phase !== "intro" && (
        <div className="relative z-30 shrink-0 border-y border-white/10 bg-black/60 px-3 py-1.5 backdrop-blur-md sm:px-4">
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="mr-1 shrink-0 text-[0.6rem] font-semibold uppercase tracking-widest text-white/50">
              Turn
            </span>
            {turnOrder.map((entry, i) => {
              const isParty = party.some((p) => p.id === entry.id);
              return (
                <div
                  key={`${entry.id}-${i}`}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-medium transition-all",
                    i === 0
                      ? "bg-amber-500/30 text-amber-200 ring-1 ring-amber-400/40"
                      : isParty
                        ? "bg-blue-500/15 text-blue-300/80"
                        : "bg-red-500/15 text-red-300/80",
                  )}
                >
                  <ChevronRight size={10} className={i === 0 ? "text-amber-400" : "opacity-0"} />
                  <span className="max-w-28 truncate sm:max-w-40">{entry.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Bottom panel: Action menu / Narration ── */}
      <div className="relative z-20 max-h-[52svh] shrink-0 overflow-y-auto border-t border-white/10 bg-gradient-to-t from-black/90 to-black/70 backdrop-blur-md sm:max-h-none">
        {/* Resolving / animating state */}
        {(phase === "resolving" || phase === "animating") && (
          <div className="flex flex-col gap-2 px-4 py-3">
            {phase === "resolving" && (
              <div className="flex items-center gap-2 text-sm text-white/60">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Resolving actions...
              </div>
            )}
            {phase === "animating" && roundResult && animatingActionIndex >= 0 && (
              <ActionNarration action={roundResult.actions[animatingActionIndex]!} allCombatants={allCombatants} />
            )}
          </div>
        )}

        {/* Player turn: action menu */}
        {phase === "player-turn" && activePlayer && (
          <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-end sm:gap-4">
            {/* Active character indicator */}
            <div className="mb-1 flex items-center gap-2 sm:mb-0 sm:min-w-[140px]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/40">
                <Sword size={14} />
              </div>
              <div>
                <div className="text-xs font-semibold text-white">{activePlayer.name}</div>
                <div className="text-[0.6rem] text-white/40">Choose action</div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-1.5">
              {ACTION_MENU.map((action, i) => (
                <button
                  key={action.id}
                  onClick={() => {
                    setActionMenuIndex(i);
                    handleActionSelect(action.id);
                  }}
                  onMouseEnter={() => {
                    setActionMenuIndex(i);
                    playSfx(COMBAT_SFX.menuHover);
                  }}
                  className={cn(
                    "group flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all duration-150",
                    actionMenuIndex === i
                      ? "border-[var(--primary)]/50 bg-[var(--primary)]/20 text-white shadow-[0_0_12px_rgba(var(--primary-rgb),0.15)]"
                      : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <action.icon size={14} className={action.color} />
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === "skill-select" && activePlayer && (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-blue-400" />
              <div>
                <div className="text-xs font-semibold text-white">{activePlayer.name}'s Skills</div>
                <div className="text-[0.65rem] text-white/45">Choose a combat ability, then pick a target.</div>
              </div>
            </div>

            {activePlayer.skills && activePlayer.skills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {activePlayer.skills.map((skill) => {
                  const insufficientMp = (activePlayer.mp ?? 0) < skill.mpCost;
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      disabled={insufficientMp}
                      onClick={() => {
                        setSelectedSkillId(skill.id);
                        setPhase("target-select");
                      }}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left text-xs transition-all",
                        insufficientMp
                          ? "cursor-not-allowed border-white/10 bg-white/5 text-white/30"
                          : "border-blue-400/20 bg-blue-500/10 text-white/80 hover:border-blue-400/40 hover:bg-blue-500/15",
                      )}
                    >
                      <div className="font-semibold text-white/90">{skill.name}</div>
                      <div className="mt-0.5 text-[0.65rem] text-white/45">
                        {skill.type === "heal" ? "Restores HP" : "Special attack"} • {skill.mpCost} MP
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-white/45">No combat skills are available for this combatant.</div>
            )}

            <div>
              <button
                onClick={() => {
                  setPhase("player-turn");
                  setSelectedAction(null);
                  setSelectedSkillId(null);
                }}
                className="rounded border border-white/15 px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {phase === "item-select" && activePlayer && (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Backpack size={14} className="text-green-400" />
                <div>
                  <div className="text-xs font-semibold text-white">{activePlayer.name}'s Items</div>
                  <div className="text-[0.65rem] text-white/45">Choose an item to use this turn.</div>
                </div>
              </div>
              {onOpenInventory && (
                <button
                  type="button"
                  onClick={onOpenInventory}
                  className="rounded border border-white/15 px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
                >
                  Open Inventory
                </button>
              )}
            </div>

            {inventoryItems.length > 0 ? (
              <div className="grid max-h-[24svh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:max-h-44 sm:grid-cols-2 lg:grid-cols-3">
                {inventoryItems.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => handleItemSelect(item.name)}
                    className="rounded-lg border border-green-400/20 bg-green-500/10 px-3 py-2 text-left text-xs text-white/80 transition-all hover:border-green-400/40 hover:bg-green-500/15"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-semibold text-white/90">{item.name}</span>
                      {item.quantity > 1 && (
                        <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[0.6rem] tabular-nums text-white/60">
                          x{item.quantity}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[0.65rem] text-white/45">
                      {item.description || "Use on the active party member."}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs text-white/45">
                No items are available in your inventory.
              </div>
            )}

            <div>
              <button
                onClick={() => {
                  setPhase("player-turn");
                  setSelectedAction(null);
                  setSelectedSkillId(null);
                }}
                className="rounded border border-white/15 px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Target selection hint */}
        {phase === "target-select" && (
          <div className="flex items-center gap-2 px-4 py-3">
            <Zap size={14} className="text-amber-400" />
            <AnimatedText
              html={
                selectedAction === "skill" && selectedSkill
                  ? `Select a ${selectingAllyTarget ? "party member" : "target"} for ${selectedSkill.name}...`
                  : "Select a target..."
              }
              className="text-sm text-amber-200"
            />
            <button
              onClick={() => {
                setPhase(selectedAction === "skill" ? "skill-select" : "player-turn");
                if (selectedAction !== "skill") {
                  setSelectedAction(null);
                  setSelectedSkillId(null);
                }
              }}
              className="ml-auto rounded border border-white/15 px-2 py-0.5 text-xs text-white/60 hover:bg-white/10 hover:text-white"
            >
              Back
            </button>
          </div>
        )}

        {/* Victory overlay */}
        {phase === "victory" && (
          <div className="flex flex-col items-center gap-3 px-3 py-4 animate-in fade-in slide-in-from-bottom-4 duration-500 sm:px-4 sm:py-6">
            <Trophy className="h-8 w-8 text-amber-400" />
            <AnimatedText html="{bounce:Victory!}" className="text-lg font-bold text-amber-200" />
            {loot && loot.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs text-white/70">
                {loot.map((item, i) => (
                  <span key={i} className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
                    {item.name} {item.quantity && item.quantity > 1 ? `×${item.quantity}` : ""}
                  </span>
                ))}
              </div>
            )}
            <button
              onClick={() => onCombatEnd("victory", buildSummary("victory", loot ?? undefined))}
              className="mt-2 rounded-lg bg-amber-500/20 px-6 py-2 text-sm font-semibold text-amber-200 ring-1 ring-amber-400/30 transition-colors hover:bg-amber-500/30"
            >
              Continue
            </button>
          </div>
        )}

        {/* Defeat overlay */}
        {phase === "defeat" && (
          <div className="flex flex-col items-center gap-3 px-3 py-4 animate-in fade-in slide-in-from-bottom-4 duration-500 sm:px-4 sm:py-6">
            <SkullIcon className="h-8 w-8 text-red-400" />
            <AnimatedText html="{shake:Defeat...}" className="text-lg font-bold text-red-200" />
            <AnimatedText html="{pulse:Your party has fallen.}" className="text-xs text-white/50" />
            <button
              onClick={() => onCombatEnd("defeat", buildSummary("defeat"))}
              className="mt-2 rounded-lg bg-red-500/20 px-6 py-2 text-sm font-semibold text-red-200 ring-1 ring-red-400/30 transition-colors hover:bg-red-500/30"
            >
              Continue
            </button>
          </div>
        )}

        {/* GM narration strip */}
        {narration && phase !== "victory" && phase !== "defeat" && (
          <div className="border-t border-white/5 px-4 py-2">
            <AnimatedText html={narration} className="text-xs leading-relaxed text-white/60 italic" />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

/** Individual combatant card with HP bar, sprite, and status effects. */
function CombatantCard({
  combatant,
  side,
  isTargetable,
  isActive,
  onSelect,
  damagePopups,
}: {
  combatant: Combatant;
  side: "player" | "enemy";
  isTargetable: boolean;
  isActive: boolean;
  onSelect?: () => void;
  damagePopups: DamagePopup[];
}) {
  const hpPercent = combatant.maxHp > 0 ? (combatant.hp / combatant.maxHp) * 100 : 0;
  const mpPercent = combatant.maxMp && combatant.maxMp > 0 ? ((combatant.mp ?? 0) / combatant.maxMp) * 100 : null;
  const isKo = combatant.hp <= 0;

  const hpColor = hpPercent > 60 ? "bg-emerald-500" : hpPercent > 25 ? "bg-amber-500" : "bg-red-500";
  const hpGlow =
    hpPercent > 60 ? "shadow-emerald-500/30" : hpPercent > 25 ? "shadow-amber-500/30" : "shadow-red-500/30";

  return (
    <div className="relative flex flex-col items-center">
      {combatant.statusEffects && combatant.statusEffects.length > 0 && (
        <div className="pointer-events-none absolute -top-3 left-1/2 z-10 flex -translate-x-1/2 gap-1">
          {combatant.statusEffects.map((effect, i) => (
            <div
              key={`${effect.name}-${effect.turnsLeft}-${i}`}
              title={`${effect.name} (${effect.turnsLeft} turns)`}
              className={cn(
                "relative flex h-6 min-w-6 items-center justify-center rounded-full border px-1 text-[0.72rem] shadow-[0_4px_12px_rgba(0,0,0,0.35)] backdrop-blur-sm",
                effect.modifier > 0 ? "border-emerald-300/35 bg-emerald-500/20" : "border-rose-300/35 bg-rose-500/20",
              )}
            >
              <span aria-hidden="true">{getStatusEffectEmoji(effect)}</span>
              <span className="absolute -bottom-1 -right-1 rounded-full bg-black/80 px-1 text-[0.45rem] font-bold leading-none text-white/80">
                {effect.turnsLeft}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Damage popups */}
      {damagePopups.map((popup) => (
        <DamageNumber key={popup.id} popup={popup} />
      ))}

      {/* Combatant sprite / avatar area */}
      <button
        onClick={onSelect}
        disabled={!isTargetable || isKo}
        className={cn(
          "relative flex h-20 w-20 items-center justify-center rounded-xl border-2 transition-all duration-200 sm:h-24 sm:w-24",
          isKo && "grayscale opacity-40",
          isTargetable &&
            !isKo &&
            "cursor-pointer border-amber-400/60 hover:border-amber-400 hover:shadow-[0_0_20px_rgba(251,191,36,0.2)]",
          isActive && !isKo && "border-white/40 shadow-[0_0_16px_rgba(255,255,255,0.1)]",
          !isTargetable && !isActive && "border-white/10",
          side === "enemy" ? "bg-red-500/10" : "bg-blue-500/10",
        )}
      >
        {/* Placeholder sprite (initials) */}
        {combatant.sprite ? (
          <img src={combatant.sprite} alt={combatant.name} className="h-full w-full rounded-lg object-cover" />
        ) : (
          <span
            className={cn("text-2xl font-bold sm:text-3xl", side === "enemy" ? "text-red-300/60" : "text-blue-300/60")}
          >
            {combatant.name.charAt(0).toUpperCase()}
          </span>
        )}

        {/* KO overlay */}
        {isKo && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
            <Skull className="h-6 w-6 text-red-400/80" />
          </div>
        )}

        {/* Targeting ring */}
        {isTargetable && !isKo && (
          <div className="absolute -inset-1 animate-pulse rounded-xl border-2 border-amber-400/40" />
        )}

        {/* Active turn indicator */}
        {isActive && !isKo && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
            <div className="h-1.5 w-6 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
          </div>
        )}
      </button>

      {/* Name + Level */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className={cn("text-xs font-semibold", isKo ? "text-white/30" : "text-white/90")}>{combatant.name}</span>
        <span className="rounded-full bg-white/10 px-1.5 py-0 text-[0.55rem] tabular-nums text-white/40">
          Lv.{combatant.level}
        </span>
      </div>

      {/* HP bar */}
      <div className="mt-1 w-24 sm:w-28">
        <div className="flex items-center gap-1">
          <Heart size={9} className={cn(isKo ? "text-white/20" : "text-red-400")} />
          <div className={cn("h-2 flex-1 overflow-hidden rounded-full bg-white/10", !isKo && `shadow-sm ${hpGlow}`)}>
            <div
              className={cn("h-full rounded-full transition-all duration-500 ease-out", hpColor)}
              style={{ width: `${hpPercent}%` }}
            />
          </div>
          <span className="min-w-[2.5rem] text-right text-[0.55rem] tabular-nums text-white/50">
            {combatant.hp}/{combatant.maxHp}
          </span>
        </div>

        {/* MP bar (if applicable) */}
        {mpPercent !== null && (
          <div className="mt-0.5 flex items-center gap-1">
            <Droplets size={9} className="text-blue-400" />
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${mpPercent}%` }}
              />
            </div>
            <span className="min-w-[2.5rem] text-right text-[0.55rem] tabular-nums text-white/40">
              {combatant.mp}/{combatant.maxMp}
            </span>
          </div>
        )}
      </div>

      {/* Element aura indicator */}
      {combatant.elementAura && (
        <div
          className="mt-0.5 rounded-full px-1.5 py-0 text-[0.5rem] font-bold uppercase tracking-wider"
          style={{
            backgroundColor: `${ELEMENT_AURA_COLORS[combatant.elementAura.element] ?? "#888"}20`,
            color: ELEMENT_AURA_COLORS[combatant.elementAura.element] ?? "#aaa",
          }}
          title={`${combatant.elementAura.element} aura (gauge: ${combatant.elementAura.gauge})`}
        >
          {combatant.elementAura.element}
        </div>
      )}
    </div>
  );
}

/** Floating damage number animation. */
function DamageNumber({ popup }: { popup: DamagePopup }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute -top-4 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-300",
        "text-sm font-bold tabular-nums drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]",
        popup.isMiss
          ? "text-gray-400"
          : popup.reactionLabel
            ? "text-lg text-amber-200"
            : popup.isCritical
              ? "text-lg text-amber-300"
              : popup.isHeal
                ? "text-emerald-400"
                : "text-red-300",
      )}
      style={{
        animation: `combat-damage-float ${DAMAGE_DISPLAY_MS}ms ease-out forwards`,
      }}
    >
      {popup.reactionLabel && (
        <div className="mb-0.5 text-center text-[0.6rem] font-bold uppercase tracking-wider text-yellow-300/90 drop-shadow-[0_0_8px_rgba(253,224,71,0.5)]">
          {popup.reactionLabel}
        </div>
      )}
      {popup.isMiss ? "MISS" : popup.isCritical ? `${popup.amount}!` : popup.amount}
    </div>
  );
}

/** Narration text for an individual combat action. */
function ActionNarration({ action, allCombatants }: { action: CombatAttackResult; allCombatants: Combatant[] }) {
  const attacker = allCombatants.find((c) => c.id === action.attackerId);
  const defender = allCombatants.find((c) => c.id === action.defenderId);
  const attackerName = attacker?.name ?? "???";
  const defenderName = defender?.name ?? "???";

  let text: string;
  if (action.isMiss) {
    text = action.skillName
      ? `${attackerName} uses ${action.skillName} on ${defenderName} — but it misses!`
      : `${attackerName} attacks ${defenderName} — but misses!`;
  } else if (action.isHeal) {
    text = action.skillName
      ? `${attackerName} uses ${action.skillName} on ${defenderName}, restoring ${action.finalDamage} HP.`
      : `${attackerName} restores ${action.finalDamage} HP to ${defenderName}.`;
  } else if (action.reaction) {
    text = action.skillName
      ? `${attackerName} uses ${action.skillName} and triggers <strong>${action.reaction.reaction}</strong> on ${defenderName} for ${action.finalDamage} damage (${action.reaction.damageMultiplier}x)!`
      : `${attackerName} triggers <strong>${action.reaction.reaction}</strong> on ${defenderName} for ${action.finalDamage} damage (${action.reaction.damageMultiplier}x)!`;
  } else if (action.isCritical) {
    text = action.skillName
      ? `${attackerName} lands a CRITICAL ${action.skillName} on ${defenderName} for ${action.finalDamage} damage!`
      : `${attackerName} lands a CRITICAL HIT on ${defenderName} for ${action.finalDamage} damage!`;
  } else if (action.skillName) {
    text = `${attackerName} uses ${action.skillName} on ${defenderName} for ${action.finalDamage} damage.`;
  } else {
    text = `${attackerName} strikes ${defenderName} for ${action.finalDamage} damage.`;
  }

  if (action.isKo) {
    text += ` ${defenderName} is defeated!`;
  }

  return (
    <div className="flex items-start gap-2 text-sm">
      <Sword size={14} className="mt-0.5 shrink-0 text-red-400" />
      <AnimatedText html={text} className="text-white/80" />
    </div>
  );
}
