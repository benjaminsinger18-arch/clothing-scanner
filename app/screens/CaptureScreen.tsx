import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { ErrorState } from "../components/ErrorState";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Capture">;

export function CaptureScreen({ navigation }: Props) {
  const [error, setError] = useState<string | null>(null);

  async function takePhoto() {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("We need camera access to take a photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (!result.canceled && result.assets[0]) {
      navigation.navigate("Preview", { photoUri: result.assets[0].uri });
    }
  }

  async function pickPhoto() {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("We need photo library access to choose one.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.9,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (!result.canceled && result.assets[0]) {
      navigation.navigate("Preview", { photoUri: result.assets[0].uri });
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Clothing Scanner</Text>
      <Text style={styles.subtitle}>Snap a photo and we'll tell you what it is, what it's worth, and what to pair it with.</Text>

      {error ? <ErrorState title={error} /> : null}

      <Pressable style={styles.primaryButton} onPress={takePhoto}>
        <Text style={styles.primaryButtonText}>Take Photo</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("BarcodeScan")}>
        <Text style={styles.secondaryButtonText}>Scan Barcode</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={pickPhoto}>
        <Text style={styles.secondaryButtonText}>Choose from Library</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, alignItems: "center", justifyContent: "center", padding: theme.spacing.lg },
  title: { color: theme.colors.textPrimary, fontSize: 28, fontFamily: theme.fonts.display.bold, marginBottom: theme.spacing.sm },
  subtitle: { color: theme.colors.textSecondary, fontSize: 15, textAlign: "center", marginBottom: theme.spacing.xl },
  primaryButton: {
    backgroundColor: theme.colors.textPrimary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    marginBottom: 12,
    width: "100%",
    alignItems: "center",
  },
  primaryButtonText: { color: theme.colors.background, fontSize: 16, fontFamily: theme.fonts.body.bold },
  secondaryButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    marginBottom: 12,
    width: "100%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryButtonText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.semiBold },
});
