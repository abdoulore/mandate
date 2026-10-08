import type {Metadata} from 'next';
import ProductHeader from '../product-header';
import MarketClient from './market-client';

export const metadata:Metadata={title:'Explore stock tokens | Mandate',description:'Explore sourced tokenized-stock identities on BNB Smart Chain, then request a fresh wallet-specific route check where one is verified.'};

export default function MarketPage(){return <div className="product-site"><ProductHeader active="market"/><main className="product-content market-page"><p className="product-eyebrow">Explore · BNB Smart Chain</p><h1>Find a token worth understanding.</h1><p className="product-lede">Compare sourced token identities and recorded market observations. A listed token is a research candidate; a fresh route and your wallet still need separate checks before any trade.</p><MarketClient/></main></div>;}
