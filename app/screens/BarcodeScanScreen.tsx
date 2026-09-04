import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { UNRECOGNIZED_GARMENT } from "@clothing-scanner/shared-types";
import type { RootStackParamList } from "../navigation/types";
import { ErrorState } from "../components/ErrorState";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { toErrorInfo } from "../lib/errors";
import { ApiError, lookupBarcode } from "../services/api";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "BarcodeScan">;

// Standard retail barcode formats a phone camera can realistically scan off a
// clothing tag — matches server/src/routes/barcodeLookup.ts's accepted code shape.
const BARCODE_TYPES = ["ean13", "ean8", "upc_a", "upc_e"] as const;

export function BarcodeScanScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);

  async function handleScan({ data }: BarcodeScanningResult) {
    if (locked) return;
    setLocked(true);
    setLoading(true);
    setError(null);

    try {
      const classification = await lookupBarcode(data);

      if (classification.garmentType === UNRECOGNIZED_GARMENT) {
        setError({
          title: "We couldn't tell what this item is from that match",
          detail: "That listing didn't have enough detail — try scanning again, or take a photo instead.",
        });
        return;
      }

      navigation.replace("Results", { classification });
    } catch (err) {
      if (err instanceof ApiError && err.message === "not_found") {
        setError({
          title: "No product found for this barcode",
          detail: "This is common for clothing — many tags aren't in general barcode databases yet.",
        });
      } else {
        setError(toErrorInfo(err, "Something went wrong looking that up"));
      }
    } finally {
      setLoading(false);
    }
  }

  function resumeScanning() {
    setError(null);
    setLocked(false);
  }

  if (!permission) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.textPrimary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.permissionDenied]}>
        <ErrorState
          title="We need camera access to scan a barcode"
          detail={permission.canAskAgain ? undefined : "Enable camera access for this app in your device Settings."}
          onRetry={permission.canAskAgain ? requestPermission : undefined}
        />
        <Pressable style={styles.secondaryButton} onPress={() => navigation.replace("Capture")}>
          <Text style={styles.secondaryButtonText}>Take Photo Instead</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={handleScan}
      />

      <View style={styles.instructionBar}>
        <Text style={styles.instructionText}>Point your camera at the barcode on the tag</Text>
      </View>

      {error ? (
        <View style={styles.errorSheet}>
          <ErrorState title={error.title} detail={error.detail} onRetry={resumeScanning} />
          <Pressable style={styles.secondaryButton} onPress={() => navigation.replace("Capture")}>
            <Text style={styles.secondaryButtonText}>Take Photo Instead</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? <LoadingOverlay message="Looking up barcode…" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, alignItems: "center", justifyContent: "center" },
  permissionDenied: { paddingHorizontal: theme.spacing.lg, width: "100%" },
  instructionBar: {
    position: "absolute",
    top: theme.spacing.lg,
    left: theme.spacing.md,
    right: theme.spacing.md,
    backgroundColor: theme.colors.overlay(0.6),
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
  },
  instructionText: { color: theme.colors.textPrimary, fontSize: 15, textAlign: "center" },
  errorSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.overlay(0.9),
    paddingTop: 20,
    paddingBottom: 32,
    paddingHorizontal: theme.spacing.md,
  },
  secondaryButton: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    width: "100%",
    alignItems: "center",
  },
  secondaryButtonText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.semiBold },
});
