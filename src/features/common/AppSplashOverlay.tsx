import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const { width, height } = Dimensions.get('window');

interface AppSplashOverlayProps {
  readonly onFinish?: () => void;
}

/**
 * AppSplashOverlay:
 * Option 3: Minimalist Brand Typography Fade-In Splash Animation.
 *
 * Sequence:
 * 1. Clean Obsidian dark backdrop.
 * 2. Bold "A E R O" title fades in with subtle scale expansion & glowing refraction.
 * 3. Tagline "Pure Sound, Zero Noise" gently glides up.
 * 4. Cinematic smooth dissolve into the main UI.
 */
export function AppSplashOverlay({ onFinish }: AppSplashOverlayProps) {
  const [visible, setVisible] = useState(true);

  // Animation values
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleScale = useRef(new Animated.Value(0.92)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const subtitleTranslateY = useRef(new Animated.Value(8)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;
  const screenScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // 1. Pure Typography Fade-in Animation
    Animated.parallel([
      // Title Scale & Fade
      Animated.timing(titleOpacity, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(titleScale, {
        toValue: 1,
        friction: 7,
        tension: 50,
        useNativeDriver: true,
      }),
      // Tagline Fade & Float
      Animated.sequence([
        Animated.delay(180),
        Animated.parallel([
          Animated.timing(subtitleOpacity, {
            toValue: 1,
            duration: 450,
            useNativeDriver: true,
          }),
          Animated.spring(subtitleTranslateY, {
            toValue: 0,
            friction: 7,
            tension: 60,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start(() => {
      // 2. Pause briefly, then cinematic smooth dissolve
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(screenScale, {
            toValue: 1.06,
            duration: 360,
            useNativeDriver: true,
          }),
          Animated.timing(screenOpacity, {
            toValue: 0,
            duration: 320,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setVisible(false);
          onFinish?.();
        });
      }, 500);
    });
  }, [
    titleOpacity,
    titleScale,
    subtitleOpacity,
    subtitleTranslateY,
    screenOpacity,
    screenScale,
    onFinish,
  ]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: screenOpacity,
          transform: [{ scale: screenScale }],
        },
      ]}
      pointerEvents="none"
    >
      <View style={styles.centerContent}>
        {/* Brand Title with Specular Tracking */}
        <Animated.View
          style={{
            opacity: titleOpacity,
            transform: [{ scale: titleScale }],
          }}
        >
          <Text style={styles.brandTitle}>A E R O</Text>
        </Animated.View>

        {/* Minimalist Subtitle */}
        <Animated.View
          style={{
            opacity: subtitleOpacity,
            transform: [{ translateY: subtitleTranslateY }],
          }}
        >
          <Text style={styles.brandSubtitle}>Pure Sound, Zero Noise</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#07070a',
    zIndex: 999999,
    alignItems: 'center',
    justifyContent: 'center',
    width,
    height,
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  brandTitle: {
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 10,
    color: '#ffffff',
    textAlign: 'center',
    textShadowColor: 'rgba(76, 201, 240, 0.35)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  brandSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 2,
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
});
