import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { UNRECOGNIZED_GARMENT } from "@clothing-scanner/shared-types";
import type { RootStackParamList } from "../navigation/types";
import { ErrorState } from "../components/ErrorState";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { toErrorInfo } from "../lib/errors";
import { submitCorrection } from "../services/api";

type Props = NativeStackScreenProps<RootStackParamList, "Correction">;

export function CorrectionScreen({ route, navigation }: Props) {
  const { classification: original } = route.params;
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const classification = await submitCorrection(trimmed, original);

      if (classification.garmentType === UNRECOGNIZED_GARMENT) {
        setError({
          title: "Couldn't verify that correction",
          detail: "The research didn't turn up enough to confirm it. Try adding more detail — brand, exact style name, material.",
        });
        return;
      }

      // Pushed screen replacing itself — same stack-shape quirk as Preview's
      // replace("Results", ...): leaves the stale original Results one level back
      // in the stack rather than swapping it out too. Accepted, not engineered
      // around, per this codebase's existing simplicity bias.
      navigation.replace("Results", { classification });
    } catch (err) {
      setError(toErrorInfo(err, "Something went wrong while verifying your correction."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.currentLabel}>Currently identified as</Text>
        <Text style={styles.currentValue}>
          {original.color} {original.garmentType}
          {original.brandGuess ? ` (${original.brandGuess})` : ""}
        </Text>

        <Text style={styles.prompt}>What is it actually?</Text>
        <TextInput
          style={styles.input}
          multiline
          placeholder={'e.g. "This is a Patagonia Better Sweater fleece, not a generic jacket" — brand, exact model, material, anything you know'}
          placeholderTextColor="#8e8e93"
          value={text}
          onChangeText={setText}
          editable={!loading}
        />

        {error ? <ErrorState title={error.title} detail={error.detail} onRetry={() => setError(null)} /> : null}

        <Pressable
          style={[styles.submitButton, (!text.trim() || loading) && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!text.trim() || loading}
        >
          <Text style={styles.submitButtonText}>Verify Correction</Text>
        </Pressable>
      </ScrollView>

      {loading ? <LoadingOverlay message="Verifying your correction…" /> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  content: { padding: 16 },
  currentLabel: { color: "#8e8e93", fontSize: 12, textTransform: "uppercase" },
  currentValue: { color: "#fff", fontSize: 16, fontWeight: "600", marginTop: 4, marginBottom: 20 },
  prompt: { color: "#fff", fontSize: 15, fontWeight: "600", marginBottom: 8 },
  input: {
    minHeight: 120,
    backgroundColor: "#1c1c1e",
    borderRadius: 10,
    padding: 12,
    color: "#fff",
    fontSize: 15,
    textAlignVertical: "top",
  },
  submitButton: { marginTop: 20, backgroundColor: "#fff", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  submitButtonDisabled: { opacity: 0.4 },
  submitButtonText: { color: "#000", fontSize: 16, fontWeight: "700" },
});
