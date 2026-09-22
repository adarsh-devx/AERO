import { StyleSheet, View } from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';

import { homeColors } from '../theme';

type IconProps = {
  size?: number;
  color?: string;
};

/** Solid triangular play glyph. */
export function PlayIcon({ size = 18, color = homeColors.text }: IconProps) {
  return <Ionicons name="play" size={size} color={color} />;
}

/** Two-bar pause glyph. */
export function PauseIcon({ size = 18, color = homeColors.text }: IconProps) {
  return <Ionicons name="pause" size={size} color={color} />;
}

/** Skip-next glyph. */
export function NextIcon({ size = 18, color = homeColors.text }: IconProps) {
  return <Ionicons name="play-skip-forward" size={size} color={color} />;
}

/** Skip-previous glyph. */
export function PrevIcon({ size = 18, color = homeColors.text }: IconProps) {
  return <Ionicons name="play-skip-back" size={size} color={color} />;
}

/** Home icon (YouTube Music style). */
export function HomeIcon({ size = 22, color }: IconProps) {
  const c = color ?? homeColors.textMuted;
  return <Ionicons name="home" size={size} color={c} />;
}

/** Search icon (YouTube Music style). */
export function SearchIcon({ size = 22, color }: IconProps) {
  const c = color ?? homeColors.textMuted;
  return <Ionicons name="search" size={size} color={c} />;
}

/** Chevron-down glyph for the Now Playing dismiss control. */
export function ChevronDownIcon({ size = 24, color = homeColors.text }: IconProps) {
  return <Ionicons name="chevron-down" size={size} color={color} />;
}

export function HeartIcon({
  size = 24,
  color = homeColors.textMuted,
  filled = false,
}: IconProps & { filled?: boolean }) {
  return (
    <Ionicons
      name={filled ? 'heart' : 'heart-outline'}
      size={size}
      color={filled ? (color === homeColors.textMuted ? '#ff4d6d' : color) : color}
    />
  );
}

/** Library icon (YouTube Music style library icon). */
export function LibraryIcon({ size = 22, color }: IconProps) {
  const c = color ?? homeColors.textMuted;
  return <MaterialIcons name="library-music" size={size} color={c} />;
}

