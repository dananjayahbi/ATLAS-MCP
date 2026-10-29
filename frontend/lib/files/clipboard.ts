let pasteSequence = 0;

export function imageFilesFromClipboard(event: ClipboardEvent): File[] {
  const files: File[] = [];
  try {
    const items = event.clipboardData?.items;
    if (!items) return files;
    const stamp = `${Date.now()}-${pasteSequence++}`;
    for (let index = 0; index < items.length; index++) {
      try {
        const item = items[index];
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        if (file.name) {
          files.push(file);
          continue;
        }
        const type = file.type || item.type;
        const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[type] ?? "img";
        files.push(new File([file], `pasted-image-${stamp}-${index}.${extension}`, { type, lastModified: file.lastModified }));
      } catch {
        // An inaccessible clipboard item should not prevent other images from being attached.
      }
    }
  } catch {
    return files;
  }
  return files;
}
