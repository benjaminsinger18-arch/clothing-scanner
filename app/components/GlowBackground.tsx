import { StyleSheet, View, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "../theme";

/** Approximates cruip/open-react-template's signature effect — a soft blurred
 * radial light behind hero/CTA content — using a vertical gradient instead of a
 * true radial blur (React Native has no cheap blur-radius primitive without a
 * heavier native dependency). Renders behind its parent's content via absolute
 * positioning; the parent needs `overflow: "hidden"` (or fixed dimensions) so the
 * oversized gradient doesn't push layout around. `pointerEvents="none"` so it
 * never intercepts touches meant for the real content on top of it.
 *
 * Deliberately used sparingly (Capture screen's hero, Results' price banner) —
 * a glow on every screen would read as noise, not an accent. */
export function GlowBackground({ style }: { style?: ViewStyle }) {
  return (
    <View style={[styles.container, style]} pointerEvents="none">
      <LinearGradient
        colors={[theme.colors.glow(0.35), theme.colors.glow(0)]}
        style={styles.gradient}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  gradient: {
    flex: 1,
  },
});
