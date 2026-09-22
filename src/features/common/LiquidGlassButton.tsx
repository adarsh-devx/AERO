import React, { useRef } from 'react';
import { Animated, Pressable, PressableProps, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { LiquidGlassShape, LiquidGlassView } from './LiquidGlassView';

export interface LiquidGlassButtonProps extends Omit<PressableProps, 'style'> {
  shape?: LiquidGlassShape;
  borderRadius?: number;
  intensity?: 'subtle' | 'medium' | 'high' | 'ultra';
  activeScale?: number;
  glowColor?: string;
  tintColor?: string;
  tintOpacity?: number;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * LiquidGlassButton:
 * Tactile glass button / pill / orb with 60fps Native Driver spring animation
 * and Apple Liquid Glass refraction rim lighting.
 */
export function LiquidGlassButton({
  shape = 'pill',
  borderRadius,
  intensity = 'medium',
  activeScale = 0.94,
  glowColor,
  tintColor,
  tintOpacity,
  children,
  style,
  containerStyle,
  onPressIn,
  onPressOut,
  ...rest
}: LiquidGlassButtonProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = (e: any) => {
    Animated.spring(scaleAnim, {
      toValue: activeScale,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4,
    }).start();
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 9,
    }).start();
    onPressOut?.(e);
  };

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={containerStyle}
      {...rest}
    >
      <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
        <LiquidGlassView
          shape={shape}
          borderRadius={borderRadius}
          intensity={intensity}
          glowColor={glowColor}
          tintColor={tintColor}
          tintOpacity={tintOpacity}
        >
          {children}
        </LiquidGlassView>
      </Animated.View>
    </Pressable>
  );
}
