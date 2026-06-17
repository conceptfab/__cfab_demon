export type FolderBasenameEntry = {
  basename: string;
  path: string;
};

export function findFolderByBasenameInName(
  nameLC: string,
  folderBasenames: FolderBasenameEntry[],
): FolderBasenameEntry | undefined {
  let best: FolderBasenameEntry | undefined;
  for (const folder of folderBasenames) {
    if (folder.basename.length > nameLC.length) continue;
    if (!nameLC.includes(folder.basename)) continue;
    if (!best || folder.basename.length > best.basename.length) {
      best = folder;
    }
  }
  return best;
}
