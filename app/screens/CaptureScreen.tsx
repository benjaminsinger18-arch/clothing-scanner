import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { ErrorState } from "../components/ErrorState";

type Props = NativeStackScreenProps<RootStackParamList, "Capture">;

export function CaptureScreen({ navigation }: Props) {
  const [error, setError] = useState<string | null>(null);

  async function takePhoto() {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera permission is required to take a photo.");
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
      setError("Photo library permission is required to choose a photo.");
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
      <Text style={styles.subtitle}>Photograph a piece of clothing to identify it, estimate its value, and find outfit matches.</Text>

      {error ? <ErrorState title={error} /> : null}

      <Pressable style={styles.primaryButton} onPress={takePhoto}>
        <Text style={styles.primaryButtonText}>Take Photo</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={pickPhoto}>
        <Text style={styles.secondaryButtonText}>Choose from Library</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 24 },
  title: { color: "#fff", fontSize: 28, fontWeight: "700", marginBottom: 8 },
  subtitle: { color: "#8e8e93", fontSize: 15, textAlign: "center", marginBottom: 32 },
  primaryButton: { backgroundColor: "#fff", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12, marginBottom: 12, width: "100%", alignItems: "center" },
  primaryButtonText: { color: "#000", fontSize: 16, fontWeight: "700" },
  secondaryButton: { paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12, width: "100%", alignItems: "center", borderWidth: 1, borderColor: "#3a3a3c" },
  secondaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
