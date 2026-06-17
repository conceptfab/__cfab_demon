export type LanSyncPeerRowMode = {
  isSlave: boolean;
  isBusy: boolean;
  canSync: boolean;
};

export type LanSyncPeerPairingState = {
  isPaired: boolean | undefined;
  isPairingExpired: boolean | undefined;
  needsPairing: boolean | undefined;
  justPaired: boolean;
};
