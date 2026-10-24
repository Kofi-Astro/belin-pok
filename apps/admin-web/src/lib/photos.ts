// Uploading photos from the admin -- one or many at once.
//
// Phone photos are big (3-10 MB, 4000 px wide) and the shop's connection
// isn't always fast, so before uploading each photo is shrunk in the
// browser to at most MAX_SIDE px on its long side, as a JPEG. That makes a
// typical photo a few hundred KB: uploads take a fraction of the time, the
// bucket stays small, and the website's pages load faster. Photos already
// small enough go up untouched.
//
// Several photos upload CONCURRENCY at a time, and each one is reported as
// it finishes, so the screen can show progress and the photos appearing one
// by one rather than a spinner until the very last is done. One bad file
// doesn't stop the rest; failures are returned for the screen to list.
import { api } from "./api";

const MAX_SIDE = 2000;
const CONCURRENCY = 3;
// Under this size and dimension, a photo is sent as it is.
const SMALL_ENOUGH_BYTES = 1_500_000;

/** The photo, shrunk to MAX_SIDE px and re-encoded as JPEG when it's large,
 * the right way up (createImageBitmap applies the EXIF rotation phones
 * use). Falls back to the original file if the browser can't decode it --
 * the API then says whether it's acceptable. */
export async function shrinkPhoto(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= SMALL_ENOUGH_BYTES && ["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export type UploadFailure = { name: string; reason: string };

/** Shrinks and uploads each file, CONCURRENCY at a time. `onUploaded` runs
 * as each one lands (index = its position in `files`, for keeping order or
 * picking the cover); `onProgress` reports how many are done. Resolves
 * once all have finished, with the ones that failed and why. */
export async function uploadPhotos(
  files: File[],
  onUploaded: (path: string, index: number) => Promise<unknown> | unknown,
  onProgress?: (done: number, total: number) => void,
): Promise<UploadFailure[]> {
  const failures: UploadFailure[] = [];
  let next = 0;
  let done = 0;
  onProgress?.(0, files.length);
  const worker = async () => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      try {
        const path = await api.uploadPhoto(await shrinkPhoto(file));
        await onUploaded(path, index);
      } catch (err) {
        failures.push({ name: file.name, reason: err instanceof Error ? err.message : String(err) });
      } finally {
        onProgress?.(++done, files.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  return failures;
}

/** The images among dropped/picked files (drag-and-drop can include
 * anything). */
export const imageFiles = (list: FileList | File[]) => [...list].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
