/** Bounds enforced by the validator and the sealing code. Mirrors even-app/design.md and PROTOCOL.md. */
export const LIMITS = {
  titleMax: 80,
  noteMax: 500,
  nameMax: 40, // member names
  groupNameMax: 80, // group.created / group.renamed names and the invite's `g`
  membersMax: 50,
  amountMin: 1,
  amountMax: 1_000_000_000_000, // integer minor units; split math uses BigInt
  /** Absolute validity range for `ts` and `at`: 2024-01-01T00:00Z ≤ t < 2100-01-01T00:00Z. Never relative to "now". */
  tsMin: 1_704_067_200_000,
  tsMax: 4_102_444_800_000,
  /**
   * W, a day (design.md "Ordering"). The group clock does not absorb an event more than this far ahead of the local
   * clock; the reducer holds an event whose claimed `ts` is more than this past the latest server arrival time (R) in
   * the log; and the write gate refuses while this phone's last push arrived more than this before the time it
   * stamped on it.
   */
  clockAbsorbWindowMs: 24 * 60 * 60 * 1000,
  idLength: 22, // base64url of 16 random bytes
  secretLength: 32,
  nonceLength: 24, // XChaCha20-Poly1305
  nonceEncodedLength: 32,
  tagLength: 16,
  padBlock: 256, // ciphertext length is always a multiple of this
  maxEventBytes: 8192, // decoded ciphertext, protocol §4
  maxPlaintextBytes: 8175, // 8192 − 16 (tag) − 1 (0x80 pad byte)
  envelopeOverheadBytes: 64, // stored size = decoded c + this, protocol §4
  inviteChecksumBytes: 4,
} as const;

/** Protocol strings. Changing any of these is a protocol break. */
export const PROTOCOL = {
  version: 1,
  hkdfSalt: 'even/v1',
  hkdfInfoEnc: 'enc',
  hkdfInfoLocal: 'local',
  hkdfInfoAuthPrefix: 'auth|',
  aadPrefix: 'even/v1',
  inviteHost: 'https://even.appalaya.com',
  invitePath: '/i',
  defaultServer: 'https://sync.even.appalaya.com',
} as const;

export const EVENT_TYPES = [
  'group.created',
  'group.renamed',
  'group.closed',
  'group.rotated',
  'group.moved',
  'group.archived',
  'group.unarchived',
  'member.added',
  'member.updated',
  'member.claimed',
  'member.archived',
  'member.unarchived',
  'member.done',
  'member.undone',
  'expense.added',
  'expense.updated',
  'expense.deleted',
  'payment.added',
  'payment.deleted',
] as const;

/** Twelve avatar colours; `memberColor(id)` returns an index into this. Values are tokens the UI maps to its palette. */
export const AVATAR_COLOR_COUNT = 12;
