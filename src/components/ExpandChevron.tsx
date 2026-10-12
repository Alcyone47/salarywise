import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Path } from 'react-native-svg';

interface ExpandChevronProps {
  expanded: boolean;
  color: string;
  bg: string;
}

// Hint that a card opens on tap — points down, flips up when open.
export default function ExpandChevron({ expanded, color, bg }: ExpandChevronProps) {
  const turn = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(turn, { toValue: expanded ? 1 : 0, duration: 240, useNativeDriver: true }).start();
  }, [expanded, turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <Animated.View
      style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', transform: [{ rotate }] }}
    >
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
        <Path d="M6 9l6 6 6-6" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Animated.View>
  );
}
