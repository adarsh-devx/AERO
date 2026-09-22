import React from 'react';
import { StyleSheet, View, ViewProps, StyleProp, ViewStyle } from 'react-native';

export type LiquidGlassShape = 'rounded' | 'pill' | 'circle';

export interface LiquidGlassViewProps extends ViewProps {
  shape?: LiquidGlassShape;
  borderRadius?: number;
  intensity?: 'subtle' | 'medium' | 'high' | 'ultra';
  tintColor?: string;
  tintOpacity?: number;
  glowColor?: string;
  borderWidth?: number;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * LiquidGlassView:
 * Multi-layer Apple Liquid Glass / VisionOS-inspired container.
 * Features:
 * - Top-edge specular light reflection (refraction rim)
 * - Semi-translucent obsidian dark-frost body
 * - Ambient inner shadow & light refraction borders
 * - 60fps Native rendering without heavy canvas dependencies
 */
export function LiquidGlassView({
  shape = 'rounded',
  borderRadius,
  intensity = 'medium',
  tintColor,
  tintOpacity,
  glowColor,
  borderWidth = 1,
  children,
  style,
  ...rest
}: LiquidGlassViewProps) {
  // Determine border radius based on shape
  let calculatedRadius = borderRadius ?? 18;
  if (shape === 'pill') {
    calculatedRadius = 999;
  } else if (shape === 'circle') {
    calculatedRadius = 9999;
  }

  // Base background opacity per intensity
  let bgOpacity = 0.78;
  let topRimAlpha = 0.25;
  let bottomRimAlpha = 0.06;

  if (intensity === 'subtle') {
    bgOpacity = 0.55;
    topRimAlpha = 0.16;
    bottomRimAlpha = 0.04;
  } else if (intensity === 'high') {
    bgOpacity = 0.86;
    topRimAlpha = 0.35;
    bottomRimAlpha = 0.08;
  } else if (intensity === 'ultra') {
    bgOpacity = 0.92;
    topRimAlpha = 0.45;
    bottomRimAlpha = 0.12;
  }

  if (tintOpacity !== undefined) {
    bgOpacity = tintOpacity;
  }

  const baseBg = tintColor ?? `rgba(20, 20, 26, ${bgOpacity})`;

  return (
    <View
      style={[
        styles.outerContainer,
        {
          borderRadius: calculatedRadius,
          backgroundColor: baseBg,
          borderTopColor: glowColor ? glowColor : `rgba(255, 255, 255, ${topRimAlpha})`,
          borderBottomColor: `rgba(255, 255, 255, ${bottomRimAlpha})`,
          borderLeftColor: `rgba(255, 255, 255, ${topRimAlpha * 0.5})`,
          borderRightColor: `rgba(255, 255, 255, ${topRimAlpha * 0.5})`,
          borderWidth,
        },
        glowColor && {
          shadowColor: glowColor,
          shadowOpacity: 0.35,
          shadowRadius: 16,
          elevation: 8,
        },
        style,
      ]}
      {...rest}
    >
      {/* Specular sheen overlay */}
      <View
        pointerEvents="none"
        style={[
          styles.specularSheen,
          {
            borderRadius: calculatedRadius,
            borderTopColor: `rgba(255, 255, 255, ${topRimAlpha * 0.7})`,
          },
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 8,
  },
  specularSheen: {
        ...StyleSheet.absoluteFill,
    borderTopWidth: 1,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    opacity: 0.8,
  },
});
