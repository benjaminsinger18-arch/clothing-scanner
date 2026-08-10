import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { UNRECOGNIZED_GARMENT } from "@clothing-scanner/shared-types";
import type { RootStackParamList } from "../navigation/types";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { ErrorState } from "../components/ErrorState";
import { compressForUpload } from "../lib/compressImage";
import { toErrorInfo } from "../lib/errors";
import { classifyPhoto, getOutfitSuggestions, searchPrices } from "../services/api";

type Props = NativeStackScreenProps<RootStackParamList, "Preview">;

export function PreviewScreen({ route, navigation }: Props) {
  const { photoUri } = route.params;
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Identifying item…");
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);

  async function handleUsePhoto() {
    setLoading(true);
    setLoadingMessage("Identifying item…");
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

      // Kick off both requests together (they're independent) rather than
      // chaining them, so the wait is as short as the slower of the two, not
      // their sum. The staged message still tracks real progress: it starts
      // on "prices" and flips to "outfit matches" as soon as pricing (usually
      // the quicker of the two) comes back, whichever order they finish in.
      let pricingDone = false;
      let outfitsDone = false;
      const advanceStage = () => {
        if (!pricingDone) setLoadingMessage("Finding prices…");
        else if (!outfitsDone) setLoadingMessage("Finding outfit matches…");
      };
      advanceStage();

      const pricingPromise = searchPrices(classification)
        .then((value) => ({ value, error: null }))
        .catch((err) => ({ value: null, error: toErrorInfo(err, "Failed to load pricing") }))
        .finally(() => {
          pricingDone = true;
          advanceStage();
        });

      const outfitsPromise = getOutfitSuggestions(classification)
        .then((value) => ({ value, error: null }))
        .catch((err) => ({ value: null, error: toErrorInfo(err, "Failed to load outfit suggestions") }))
        .finally(() => {
          outfitsDone = true;
          advanceStage();
        });

      const [pricing, outfits] = await Promise.all([pricingPromise, outfitsPromise]);

      navigation.replace("Results", {
        classification,
        prefetchedPricing: pricing.value,
        prefetchedPricingError: pricing.error,
        prefetchedOutfits: outfits.value,
        prefetchedOutfitsError: outfits.error,
      });
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

      {loading ? <LoadingOverlay message={loadingMessage} /> : null}
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
