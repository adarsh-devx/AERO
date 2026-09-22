import { useRef } from 'react';
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface TactilePressableProps extends PressableProps {
  activeScale?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * High-performance 60fps tactile touch feedback wrapper.
 * Runs 100% on Native Driver for zero UI lag.
 */
export function TactilePressable({
  activeScale = 0.95,
  style,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: TactilePressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = (e: any) => {
    Animated.spring(scale, {
      toValue: activeScale,
      speed: 50,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    Animated.spring(scale, {
      toValue: 1,
      speed: 40,
      bounciness: 8,
      useNativeDriver: true,
    }).start();
    onPressOut?.(e);
  };

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
