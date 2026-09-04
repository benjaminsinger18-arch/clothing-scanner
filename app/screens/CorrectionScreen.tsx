import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { UNRECOGNIZED_GARMENT, type Gender } from "@clothing-scanner/shared-types";
import type { RootStackParamList } from "../navigation/types";
import { ErrorState } from "../components/ErrorState";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { toErrorInfo } from "../lib/errors";
import { prefetchResultsData } from "../lib/prefetchResults";
import { submitCorrection } from "../services/api";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Correction">;

const GENDER_LABELS: Record<Gender, string> = { men: "Men's", women: "Women's", unisex: "Unisex" };

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
          title: "Couldn't confirm that",
          detail: "We couldn't find enough to confirm it — try adding more detail, like the brand or material.",
        });
        return;
      }

      // Pushed screen replacing itself — same stack-shape quirk as Preview's
      // replace("Results", ...): leaves the stale original Results one level back
      // in the stack rather than swapping it out too. Accepted, not engineered
      // around, per this codebase's existing simplicity bias.
      navigation.replace("Results", { classification, ...prefetchResultsData(classification) });
    } catch (err) {
      setError(toErrorInfo(err, "Something went wrong while checking that."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.currentLabel}>Currently identified as</Text>
        <Text style={styles.currentValue}>
          {original.gender !== "unisex" ? `${GENDER_LABELS[original.gender]} ` : ""}
          {original.color} {original.garmentType}
          {original.brandGuess ? ` (${original.brandGuess})` : ""}
        </Text>

        <Text style={styles.prompt}>What's it actually?</Text>
        <TextInput
          style={styles.input}
          multiline
          placeholder={'e.g. "This is a Patagonia Better Sweater fleece, not a generic jacket" — brand, exact model, material, anything you know'}
          placeholderTextColor={theme.colors.textSecondary}
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
          <Text style={styles.submitButtonText}>Verify Online</Text>
        </Pressable>
      </ScrollView>

      {loading ? <LoadingOverlay message="Double-checking online…" /> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.md },
  currentLabel: { color: theme.colors.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: theme.letterSpacing.label },
  currentValue: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontFamily: theme.fonts.display.semiBold,
    marginTop: 4,
    marginBottom: 20,
  },
  prompt: { color: theme.colors.textPrimary, fontSize: 15, fontFamily: theme.fonts.body.semiBold, marginBottom: theme.spacing.sm },
  input: {
    minHeight: 120,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    color: theme.colors.textPrimary,
    fontSize: 15,
    textAlignVertical: "top",
  },
  submitButton: { marginTop: 20, backgroundColor: theme.colors.accent, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center" },
  submitButtonDisabled: { opacity: 0.4 },
  submitButtonText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.bold },
});
