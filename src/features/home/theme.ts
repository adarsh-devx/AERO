import { StyleSheet } from 'react-native';

/**
 * Visual tokens for the approved Home mockup.
 * Single source of truth for the Home feature's surfaces, type ramp
 * and spacing so screens/components stay visually consistent.
 * The palette is deliberately monochrome (deep black / graphite /
 * soft white / cool gray) — ambient artwork-derived accents are a
 * later, provider-dependent concern.
 */
export const homeColors = {
  background: '#0a0a0b',
  surface: '#161618',
  surfaceRaised: '#1e1e21',
  border: 'rgba(255, 255, 255, 0.08)',
  text: '#f4f4f5',
  textMuted: '#8a8a8f',
  textFaint: '#5c5c61',
  accent: '#ff4d6d',
} as const;

export const homeSpacing = {
  screenX: 20,
  sectionGap: 32,
  itemGap: 12,
} as const;

export const homeRadius = {
  artwork: 8,
  surface: 16,
  avatar: 999,
} as const;

/** Shared section heading style (small, medium-weight, restrained). */
export const sectionHeading = {
  fontSize: 17,
  fontWeight: '600',
  color: homeColors.text,
} as const;

/** Standard muted metadata style used across result rows and cards. */
export const mutedText = StyleSheet.create({
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: homeColors.text,
  },
  subtitle: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
});
