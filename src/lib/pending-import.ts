/**
 * Module-level singleton to pass a pending CSV file from the Dashboard
 * quick-import modal to the Data Pipeline page for processing.
 */

let _pendingFile: File | null = null;

export function setPendingImportFile(file: File): void {
  _pendingFile = file;
}

export function takePendingImportFile(): File | null {
  const f = _pendingFile;
  _pendingFile = null;
  return f;
}
