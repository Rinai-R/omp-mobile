import { requireOptionalNativeModule, type NativeModule } from "expo";
import { Platform, Share } from "react-native";

interface ShareModule extends NativeModule {
  shareFile(uri: string, mimeType: string, title: string): Promise<void>;
}

const native = requireOptionalNativeModule<ShareModule>("OmpShare");

/**
 * Open the system share sheet for a downloaded file (a `file://` URI in the
 * app's cache). Android sends it through expo-file-system's FileProvider;
 * iOS shares the file URL with React Native's `Share`.
 */
export async function shareFile(uri: string, mimeType: string, title: string): Promise<void> {
  if (native !== null) {
    await native.shareFile(uri, mimeType, title);
    return;
  }
  if (Platform.OS === "android") throw new Error("The share module is not in this build.");
  await Share.share({ url: uri, title });
}
