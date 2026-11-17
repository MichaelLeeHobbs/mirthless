// ===========================================
// Download
// ===========================================
// Hand the browser a file made in the page, without a server round trip.

/** Save `text` as a file named `name` through the browser's download. */
export function saveFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
