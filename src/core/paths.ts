/** Paths emitted into a Mod must also be valid ordinary Windows filenames. */
export function safeRelative(path: string): boolean {
  return !!path && !/[\\:*?"<>|\u0000-\u001f]/.test(path) && !path.split('/').some(part =>
    !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
