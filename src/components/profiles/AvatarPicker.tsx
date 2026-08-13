/**
 * AvatarPicker — compact preview + color row on top, full-width icon grid below.
 */

import { cn } from '@/shared/lib/utils';

import {
  AVATAR_COLORS,
  AVATAR_OPTIONS,
  AvatarPreview,
  AvatarSvg,
} from './avatar-options';

export function AvatarPicker({
  selectedIcon,
  selectedColor,
  onIconChange,
  onColorChange,
}: {
  selectedIcon: string;
  selectedColor: string;
  onIconChange: (icon: string) => void;
  onColorChange: (color: string) => void;
}) {
  return (
    <div className="space-y-3">
      {/* Top row: preview + color palette */}
      <div className="flex items-center gap-3">
        <AvatarSvg
          avatarId={selectedIcon}
          color={selectedColor}
          className="size-12 shrink-0 overflow-hidden rounded-xl shadow-sm"
        />
        <div className="flex flex-wrap gap-1.5">
          {AVATAR_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => onColorChange(color)}
              className={cn(
                'size-6 rounded-full transition-all',
                color === selectedColor
                  ? 'ring-ring scale-110 ring-2 ring-offset-1'
                  : 'hover:scale-110',
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      {/* Full-width icon grid */}
      <div className="flex flex-wrap gap-1">
        {AVATAR_OPTIONS.map((opt) => {
          const isSelected = opt.seed === selectedIcon;
          return (
            <button
              key={opt.seed}
              type="button"
              title={opt.label}
              onClick={() => onIconChange(opt.seed)}
              className={cn(
                'overflow-hidden rounded-lg transition-all',
                isSelected
                  ? 'ring-ring ring-2 ring-offset-1'
                  : 'ring-border ring-1 hover:ring-2',
              )}
            >
              {isSelected ? (
                <AvatarSvg
                  avatarId={opt.seed}
                  color={selectedColor}
                  className="size-7"
                />
              ) : (
                <AvatarPreview seed={opt.seed} className="bg-muted/30 size-8" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
