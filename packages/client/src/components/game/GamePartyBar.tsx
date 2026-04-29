// ──────────────────────────────────────────────
// Game: Compact Party Portraits Bar (top-left, horizontal)
// ──────────────────────────────────────────────
import { X } from "lucide-react";
import { useGameModeStore } from "../../stores/game-mode.store";
import { getAvatarCropStyle } from "../../lib/utils";

interface PartyBarMember {
  id: string;
  name: string;
  avatarUrl?: string | null;
  avatarCrop?: { zoom: number; offsetX: number; offsetY: number } | null;
  nameColor?: string;
  canRemove?: boolean;
}

interface PartyBarCard {
  title: string;
  subtitle?: string;
  mood?: string;
  status?: string;
  level?: number;
  avatarUrl?: string | null;
  avatarCrop?: { zoom: number; offsetX: number; offsetY: number } | null;
  stats?: Array<{ name: string; value: number; max?: number; color?: string }>;
  inventory?: Array<{ name: string; quantity?: number; location?: string }>;
  customFields?: Record<string, string>;
}

interface GamePartyBarProps {
  partyMembers: PartyBarMember[];
  partyCards: Record<string, PartyBarCard>;
  onRemovePartyMember?: (member: PartyBarMember) => void;
  removingPartyMemberId?: string | null;
}

export function GamePartyBar({
  partyMembers,
  partyCards,
  onRemovePartyMember,
  removingPartyMemberId,
}: GamePartyBarProps) {
  const openCharacterSheet = useGameModeStore((s) => s.openCharacterSheet);

  if (partyMembers.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {partyMembers.map((member) => {
        const card = partyCards[member.id];
        const avatarSrc = card?.avatarUrl ?? member.avatarUrl;
        const avatarCrop = card?.avatarCrop ?? member.avatarCrop ?? null;

        return (
          <div key={member.id} className="group relative shrink-0 transition-transform hover:scale-110">
            <button
              type="button"
              onClick={() => openCharacterSheet(member.id)}
              className="block"
              title={`${member.name} - Click to open character sheet`}
            >
              {avatarSrc ? (
                <span className="block h-9 w-9 overflow-hidden rounded-full border-2 border-white/20 shadow-lg transition-colors group-hover:border-white/40">
                  <img
                    src={avatarSrc}
                    alt={member.name}
                    className="h-full w-full object-cover"
                    style={getAvatarCropStyle(avatarCrop)}
                  />
                </span>
              ) : (
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white/20 bg-[var(--accent)] text-xs font-bold shadow-lg transition-colors group-hover:border-white/40"
                  style={member.nameColor ? { color: member.nameColor } : undefined}
                >
                  {member.name[0]}
                </div>
              )}
            </button>
            {member.canRemove && onRemovePartyMember && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemovePartyMember(member);
                }}
                disabled={removingPartyMemberId === member.id}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-white/30 bg-black/80 text-white opacity-80 shadow-md transition-opacity hover:bg-[var(--destructive)] disabled:cursor-not-allowed disabled:opacity-60 group-hover:opacity-100 focus:opacity-100 md:opacity-0"
                aria-label={`Remove ${member.name} from party`}
                title={`Remove ${member.name} from party`}
              >
                <X className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
