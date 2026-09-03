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
          title: "Couldn't determine what this item is from the barcode match",
          detail: "The database listing didn't have enough detail. Try scanning again or take a photo instead.",
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
        setError(toErrorInfo(err, "Barcode lookup failed"));
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
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.permissionDenied]}>
        <ErrorState
          title="Camera permission is required to scan a barcode"
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
        <Text style={styles.instructionText}>Point your camera at the barcode on the clothing tag</Text>
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
  container: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  permissionDenied: { paddingHorizontal: 24, width: "100%" },
  instructionBar: {
    position: "absolute",
    top: 24,
    left: 16,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 12,
    padding: 12,
  },
  instructionText: { color: "#fff", fontSize: 15, textAlign: "center" },
  errorSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.9)",
    paddingTop: 20,
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  secondaryButton: {
    marginTop: 8,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    width: "100%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3a3a3c",
  },
  secondaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
