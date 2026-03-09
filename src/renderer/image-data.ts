import type { ImageData } from "../ipc.js";

const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/** Convert a File to base64 ImageData. Returns null for unsupported types. */
export function fileToImageData(file: File): Promise<ImageData | null> {
  const mediaType = file.type as ImageData["mediaType"];
  if (!SUPPORTED_TYPES.includes(mediaType)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      if (base64) resolve({ base64, mediaType });
      else resolve(null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/** Extract image files from a DataTransferItemList (e.g. clipboard paste). */
export function extractImageFiles(items: DataTransferItemList): File[] {
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith("image/")) {
      const file = items[i].getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}
