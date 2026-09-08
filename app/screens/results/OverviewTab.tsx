import { Image, Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ClassificationResult, Gender, PriceSearchResult } from "@clothing-scanner/shared-types";
import type { RootStackParamList } from "../../navigation/types";
import { resultsStyles as styles } from "./styles";
import { PriceRangeSummary } from "./PriceRangeSummary";

const GENDER_LABELS: Record<Gender, string> = { men: "Men's", women: "Women's", unisex: "Unisex" };

export function OverviewTab({
  classification,
  classifications,
  selectedIndex,
  photoThumbnail,
  pricing,
  pricingLoading,
  navigation,
}: {
  classification: ClassificationResult;
  classifications: ClassificationResult[];
  selectedIndex: number;
  photoThumbnail?: string;
  pricing: PriceSearchResult | null;
  pricingLoading: boolean;
  navigation: NativeStackScreenProps<RootStackParamList, "Results">["navigation"];
}) {
  return (
    <View>
      <View style={styles.overviewHeader}>
        <View style={styles.overviewRows}>
          <Row label="Garment" value={classification.garmentType} />
          <Row label="Category" value={classification.category} />
          <Row label="Color" value={classification.color} />
          <Row label="Pattern" value={classification.pattern} />
          <Row label="Style" value={classification.style} />
          <Row label="Gender" value={GENDER_LABELS[classification.gender]} />
          <Row
            label="Brand"
            value={classification.brandGuess ?? "Not identified"}
            hint={`confidence: ${classification.brandConfidence}${
              classification.brandSource === "vision-logo"
                ? " (via logo detection)"
                : classification.brandSource === "barcode"
                  ? " (via barcode)"
                  : ""
            }`}
          />
        </View>

        {photoThumbnail ? (
          <Image source={{ uri: photoThumbnail }} style={styles.overviewPhoto} resizeMode="cover" />
        ) : (
          // Barcode-identified items never had a garment photo to
          // begin with — a plain placeholder box rather than nothing,
          // so the layout doesn't visibly shift based on source.
          <View style={styles.overviewPhotoPlaceholder} />
        )}
      </View>

      <Pressable
        onPress={() =>
          navigation.navigate("Correction", {
            classification,
            allClassifications: classifications,
            itemIndex: selectedIndex,
            photoThumbnail,
          })
        }
        style={styles.correctionLink}
        accessibilityRole="button"
        accessibilityLabel="Doesn't look right? Suggest a fix"
      >
        <Text style={styles.correctionLinkText}>Doesn't look right? Suggest a fix</Text>
      </Pressable>

      {classification.source === "correction" && classification.sources && classification.sources.length > 0 && (
        <Text style={styles.note}>Verified via: {classification.sources.map((s) => s.title).join(", ")}</Text>
      )}

      <PriceRangeSummary pricing={pricing} loading={pricingLoading} />
    </View>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
      {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
    </View>
  );
}
