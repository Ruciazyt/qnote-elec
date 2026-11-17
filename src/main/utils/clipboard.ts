import { clipboard, nativeImage, ClipboardItem, type NativeImage } from "electron";


export async function readClipboardImage(): Promise<NativeImage> {
  const items = await clipboard.read();

  for (const item of items) {
    const mimeType = item.types.find((type) => type.startsWith("image/"));
    if (!mimeType) continue;

    const payload = await item.getType(mimeType);
    if (!(payload instanceof Blob)) continue;

    const buffer = Buffer.from(await payload.arrayBuffer());
    return nativeImage.createFromBuffer(buffer);
  }

  return nativeImage.createEmpty();
}

export async function writeClipboardImage(image: NativeImage): Promise<void> {
  const png = image.toPNG();

  await clipboard.write([
    new ClipboardItem({
      "image/png": new Blob([Uint8Array.from(png)], { type: "image/png" }),
    }),
  ]);
}
