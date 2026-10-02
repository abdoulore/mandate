import {describe,expect,it} from 'vitest';
import {listInjectedWalletProviders,waitForInjectedWalletProviders,type Eip1193Provider} from '../apps/web/app/wallet-providers';

function provider(flags: Partial<Eip1193Provider> = {}): Eip1193Provider {
  return {request: async () => [], ...flags};
}

describe('injected wallet discovery', () => {
  it('keeps the Binance in-app provider and a second desktop wallet distinct', () => {
    const binance = provider();
    const metamask = provider({isMetaMask: true});
    const choices = listInjectedWalletProviders({binancew3w: {ethereum: binance}, ethereum: {request: async () => [], providers: [binance, metamask]}});
    expect(choices.map(choice => choice.name)).toEqual(['Binance Web3 Wallet', 'MetaMask']);
    expect(choices.map(choice => choice.provider)).toEqual([binance, metamask]);
  });

  it('accepts a non-Binance EVM extension when it is the only provider', () => {
    const rabby = provider({isRabby: true});
    expect(listInjectedWalletProviders({ethereum: rabby})).toEqual([{id: 'provider-0', name: 'Rabby', provider: rabby}]);
  });

  it('waits briefly for a wallet injected after page load', async () => {
    const source: {ethereum?: Eip1193Provider} = {};
    setTimeout(() => {source.ethereum = provider({isTrust: true});}, 15);
    expect((await waitForInjectedWalletProviders(source, 3))[0]?.name).toBe('Trust Wallet');
  });
});
