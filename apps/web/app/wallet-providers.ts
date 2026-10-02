export type Eip1193Provider = {
  request(args: {method: string; params?: unknown}): Promise<unknown>;
  isBinance?: boolean;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isTrust?: boolean;
  isRabby?: boolean;
  providers?: Eip1193Provider[];
  on?(event: string, listener: (value: unknown) => void): void;
  removeListener?(event: string, listener: (value: unknown) => void): void;
};

export type WalletProviderChoice = {id: string; name: string; provider: Eip1193Provider};
type WalletWindow = {binancew3w?: {ethereum?: Eip1193Provider}; ethereum?: Eip1193Provider};

function isProvider(value: unknown): value is Eip1193Provider {
  return Boolean(value && typeof value === 'object' && typeof (value as Eip1193Provider).request === 'function');
}

function providerName(provider: Eip1193Provider, directBinance: boolean) {
  if (directBinance || provider.isBinance) return 'Binance Web3 Wallet';
  if (provider.isRabby) return 'Rabby';
  if (provider.isCoinbaseWallet) return 'Coinbase Wallet';
  if (provider.isTrust) return 'Trust Wallet';
  if (provider.isMetaMask) return 'MetaMask';
  return 'EVM wallet';
}

export function listInjectedWalletProviders(source: WalletWindow): WalletProviderChoice[] {
  const providers: WalletProviderChoice[] = [];
  const seen = new Set<Eip1193Provider>();
  const add = (candidate: unknown, directBinance = false) => {
    if (!isProvider(candidate) || seen.has(candidate)) return;
    seen.add(candidate);
    providers.push({id: `provider-${providers.length}`, name: providerName(candidate, directBinance), provider: candidate});
  };
  add(source.binancew3w?.ethereum, true);
  if (source.ethereum?.providers?.length) source.ethereum.providers.forEach(provider => add(provider));
  else add(source.ethereum);
  return providers;
}

export async function waitForInjectedWalletProviders(source: WalletWindow, attempts = 25): Promise<WalletProviderChoice[]> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const providers = listInjectedWalletProviders(source);
    if (providers.length) return providers;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return [];
}
