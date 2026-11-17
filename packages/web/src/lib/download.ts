// ===========================================
// Download
// ===========================================
// Hand the browser a file through its download: one made in the page, or one
// the server sent back as a Blob.

/** Save `blob` as a file named `name` through the browser's download. */
export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  // Attached while clicked: a detached anchor does not download in every browser.
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

/** Save `text` as a file named `name` through the browser's download. */
export function saveFile(name: string, text: string, type: string): void {
  saveBlob(name, new Blob([text], { type }));
}
