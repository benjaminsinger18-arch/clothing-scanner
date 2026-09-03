import type { ClassificationResult } from "@clothing-scanner/shared-types";

export type RootStackParamList = {
  Capture: undefined;
  Preview: { photoUri: string };
  BarcodeScan: undefined;
  Results: { classification: ClassificationResult };
};
