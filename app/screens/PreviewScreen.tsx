import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { ErrorState } from "../components/ErrorState";
import { compressForThumbnail, compressForUpload } from "../lib/compressImage";
import { toErrorInfo } from "../lib/errors";
import { prefetchResultsData } from "../lib/prefetchResults";
import { classifyPhoto } from "../services/api";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Preview">;

export function PreviewScreen({ route, navigation }: Props) {
  const { photoUri } = route.params;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);

  async function handleUsePhoto() {
    setLoading(true);
    setError(null);
    try {
      const base64 = await compressForUpload(photoUri);
      const classifications = await classifyPhoto(base64);

      if (classifications.length === 0) {
        setError({
          title: "We couldn't quite make out any clothing items in that photo",
          detail: "Try a clearer, well-lit shot with the items filling the frame.",
        });
        return;
      }

      // Best-effort — a thumbnail failure shouldn't block showing results for
      // a successful classification, it just means Overview/Closet fall back
      // to their no-photo placeholder for this scan.
      const photoThumbnail = await compressForThumbnail(photoUri).catch((err) => {
        console.warn("[PreviewScreen] Failed to build photo thumbnail:", err);
        return undefined;
      });

      // Kick off pricing/outfit fetches now, before navigating, instead of
      // waiting for ResultsScreen to mount and start them itself — the
      // screen-transition/mount cycle was otherwise dead time. This spinner's
      // wait is still just the classify call (pricing/outfit have their own
      // per-tab spinners on Results), it's only *when* those two fetches start
      // that's changing, not what's shown here.
      navigation.replace("Results", {
        classifications,
        initialIndex: 0,
        photoThumbnail,
        ...prefetchResultsData(classifications[0]),
      });
    } catch (err) {
      setError(toErrorInfo(err, "Something went wrong while identifying this item."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />

      {error ? <ErrorState title={error.title} detail={error.detail} onRetry={handleUsePhoto} /> : null}

      <View style={styles.buttonRow}>
        <Pressable style={styles.secondaryButton} onPress={() => navigation.goBack()} disabled={loading}>
          <Text style={styles.secondaryButtonText}>Retake</Text>
        </Pressable>
        <Pressable style={styles.primaryButton} onPress={handleUsePhoto} disabled={loading}>
          <Text style={styles.primaryButtonText}>Use this photo</Text>
        </Pressable>
      </View>

      {loading ? <LoadingOverlay message="Identifying item…" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  preview: { flex: 1 },
  buttonRow: { flexDirection: "row", padding: theme.spacing.md, gap: 12 },
  primaryButton: { flex: 1, backgroundColor: theme.colors.accent, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center" },
  primaryButtonText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.bold },
  secondaryButton: { flex: 1, backgroundColor: theme.colors.surfaceAlt, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center" },
  secondaryButtonText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.semiBold },
});
