import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { UNRECOGNIZED_GARMENT } from "@clothing-scanner/shared-types";
import type { RootStackParamList } from "../navigation/types";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { ErrorState } from "../components/ErrorState";
import { compressForUpload } from "../lib/compressImage";
import { toErrorInfo } from "../lib/errors";
import { classifyPhoto } from "../services/api";

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
      const classification = await classifyPhoto(base64);

      if (classification.garmentType === UNRECOGNIZED_GARMENT) {
        setError({
          title: "Couldn't identify a clothing item in that photo",
          detail: "Try a clearer, well-lit photo with a single garment filling most of the frame.",
        });
        return;
      }

      // Navigate as soon as classification is back — pricing/outfit fetches
      // happen on ResultsScreen with their own per-tab spinners, so this
      // spinner's wait is just the classify call, not classify + whichever
      // of those two finishes last.
      navigation.replace("Results", { classification });
    } catch (err) {
      setError(toErrorInfo(err, "Something went wrong while identifying the item."));
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
  container: { flex: 1, backgroundColor: "#000" },
  preview: { flex: 1 },
  buttonRow: { flexDirection: "row", padding: 16, gap: 12 },
  primaryButton: { flex: 1, backgroundColor: "#fff", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  primaryButtonText: { color: "#000", fontSize: 16, fontWeight: "700" },
  secondaryButton: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: "#3a3a3c" },
  secondaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
