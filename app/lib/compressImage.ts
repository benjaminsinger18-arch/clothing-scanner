import * as ImageManipulator from "expo-image-manipulator";

/** Resizes to a max 1024px edge and re-encodes as ~80%-quality JPEG, returning base64
 * (no data: URL prefix) ready to send to the backend. Keeps upload time and Claude
 * vision token cost down. */
export async function compressForUpload(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1024 } }], {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });

  if (!result.base64) {
    throw new Error("Failed to encode photo for upload");
  }
  return result.base64;
}
