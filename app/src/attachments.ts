import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/** A photo attached to the message being written: a preview and the bytes that will be sent. */
export interface Attachment {
  id: string;
  /** A local file for the thumbnail. */
  uri: string;
  /** Base64 JPEG, already downscaled. */
  data: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

/** At most this many photos per message (the daemon accepts 8). */
export const MAX_ATTACHMENTS = 6;
/** The longest side a photo is sent at: enough for a model to read a screenshot, small enough to send fast. */
const MAX_SIDE = 1600;
const QUALITY = 0.8;

let counter = 0;

/** A picked asset scaled so its longest side is at most MAX_SIDE, as base64 JPEG. */
async function prepare(asset: ImagePicker.ImagePickerAsset): Promise<Attachment> {
  const context = ImageManipulator.manipulate(asset.uri);
  const longest = Math.max(asset.width, asset.height);
  if (longest > MAX_SIDE) {
    context.resize(asset.width >= asset.height ? { width: MAX_SIDE, height: null } : { width: null, height: MAX_SIDE });
  }
  // The context and the image hold full-size native bitmaps until released; garbage collection is too late.
  let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  let saved;
  try {
    image = await context.renderAsync();
    saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY, base64: true });
  } finally {
    image?.release();
    context.release();
  }
  if (saved.base64 === undefined || saved.base64 === "") throw new Error("The photo could not be read.");
  counter += 1;
  return {
    id: `att-${Date.now().toString(36)}-${counter}`,
    uri: saved.uri,
    data: saved.base64,
    mimeType: "image/jpeg",
    width: saved.width,
    height: saved.height,
  };
}

/**
 * Let the user pick photos from the library, or take one with the camera.
 * Resolves to the prepared photos; an empty list when they cancelled. Throws
 * with a readable message when the permission was refused.
 */
export async function pickPhotos(source: "library" | "camera", room: number): Promise<Attachment[]> {
  if (room <= 0) return [];
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error("Camera access is off for OMP. Turn it on in the system settings to take a photo.");
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: 1,
    allowsMultipleSelection: source === "library" && room > 1,
    selectionLimit: room,
    exif: false,
  };
  const result =
    source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return [];
  const assets = result.assets.slice(0, room);
  // One at a time: each photo is decoded at full size while it is scaled down.
  const prepared: Attachment[] = [];
  for (const asset of assets) prepared.push(await prepare(asset));
  return prepared;
}
