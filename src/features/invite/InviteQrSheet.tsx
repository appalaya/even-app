// The "Scan to join" sheet (canvas board InviteQR). Stub: the props are final,
// the sheet itself lands in the next commit.

export type InviteQrSheetProps = {
  visible: boolean;
  onClose: () => void;
  invite: { code: string; link: string; ready: boolean } | null;
  groupName: string;
};

export function InviteQrSheet(_props: InviteQrSheetProps) {
  return null;
}
