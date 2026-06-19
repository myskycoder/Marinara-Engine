import {
  BookOpen,
  Bot,
  GraduationCap,
  Heart,
  Library,
  List,
  MessageCircle,
  MessagesSquare,
  Theater,
  Trophy,
  UserRound,
  Gamepad2,
} from "lucide-react";
import { toast } from "sonner";
import {
  ACHIEVEMENT_DEFINITION_BY_ID,
  type AchievementDefinition,
  type AchievementProgress,
} from "@marinara-engine/shared";

const ICONS = {
  graduation: GraduationCap,
  discord: MessageCircle,
  heart: Heart,
  credits: List,
  mari: Bot,
  conversation: MessagesSquare,
  roleplay: Theater,
  game: Gamepad2,
  character: UserRound,
  lorebook: BookOpen,
  persona: Library,
} satisfies Record<AchievementDefinition["icon"], typeof Trophy>;

function AchievementToastIcon({ achievement }: { achievement: AchievementDefinition }) {
  const Icon = ICONS[achievement.icon] ?? Trophy;
  return (
    <span
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--secondary)] text-[var(--primary)] shadow-sm"
      aria-hidden="true"
    >
      <Icon size="0.95rem" />
    </span>
  );
}

function getAchievementLabel(achievement: AchievementDefinition) {
  return achievement.rankLabel ? `${achievement.title} ${achievement.rankLabel}` : achievement.title;
}

export function showAchievementUnlockToasts(progress: AchievementProgress[]) {
  for (const item of progress) {
    const achievement = ACHIEVEMENT_DEFINITION_BY_ID.get(item.id);
    if (!achievement) continue;

    toast.success("Achievement unlocked", {
      description: getAchievementLabel(achievement),
      icon: <AchievementToastIcon achievement={achievement} />,
    });
  }
}
