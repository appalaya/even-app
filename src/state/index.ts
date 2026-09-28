/**
 * The state layer's public surface for screens: the provider, the hooks, and the types their results carry.
 * Actions are methods on `useApp().groups` (GroupService) and on `usePrefs()`.
 */
export { AppProvider, type AppProviderProps } from './AppProvider';
export {
  useApp,
  useGroup,
  useGroups,
  useMe,
  usePrefs,
  useSyncStatus,
  type Me,
  type PrefsHandle,
} from './hooks';
export type { AppServices } from './services';
export type {
  CreateGroupInput,
  ExpenseDraft,
  ExpenseEdit,
  GroupService,
  InviteInfo,
  InvitePreview,
  JoinResult,
  LeaveResult,
  MoveResult,
  PaymentDraft,
  PreviewResult,
  ReportInfo,
  RotateResult,
  ServerCheck,
  UsageReport,
} from './groups';
export type {
  DerivedGroup,
  GroupListRow,
  GroupListSnapshot,
  GroupSnapshot,
  ReadOnlyReason,
  SkippedCounts,
  SyncStatus,
} from './groupState';
export type { SplitSpec } from './split';
export { isStateError, StateError, type InviteProblem, type StateErrorCode } from './errors';
export { deviceSeat } from './seat';
export type { Appearance, NotificationStatus, Prefs } from './prefs';
export {
  chipAfterReply,
  chipAfterTap,
  chipAfterTitle,
  inferCategory,
  initialChip,
  prepareCategoryModel,
  refineCategory,
  shouldRefine,
  type CategoryChip,
  type ChipSource,
} from './categories';
