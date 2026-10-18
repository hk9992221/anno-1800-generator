import type { Issue } from './types.ts';

export type IssuePage =
  | 'basic'
  | 'image'
  | 'targets'
  | 'effects'
  | 'sources'
  | 'advanced'
  | 'settings';

/** Keep validation links next to the controls that can resolve the issue. */
export function issuePage(issue: Issue): IssuePage {
  if (issue.effectId) return 'effects';
  if (['modId', 'folder', 'baseline', 'dlc'].includes(issue.code)) return 'settings';
  if (['image', 'imagePath'].includes(issue.code)) return 'image';
  if (['targets', 'targetMissing'].includes(issue.code)) return 'targets';
  if (['replaceChain', 'flags'].includes(issue.code)) return 'effects';
  if (['name', 'price', 'empty'].includes(issue.code)) return 'basic';
  if (
    ['guid', 'duplicate', 'installedConflict', 'unknownClone', 'cardId'].includes(
      issue.code,
    )
  )
    return 'advanced';
  return 'sources';
}
