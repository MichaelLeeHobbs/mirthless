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

export function saveFile(name: string, text: string, type: string): void {
  saveBlob(name, new Blob([text], { type }));
}
