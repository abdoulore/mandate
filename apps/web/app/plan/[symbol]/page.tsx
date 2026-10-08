import Link from 'next/link';
import type {Metadata} from 'next';
import DirectTrade from '../../direct-trade/page';
import ProductHeader from '../../product-header';

export const metadata:Metadata={title:'Check a trade | Mandate',description:'Check a tokenized-stock route against your wallet and saved cash rules before any separate wallet confirmation.'};

export default async function PlanPage({params}:{params:Promise<{symbol:string}>}){
 const {symbol}=await params;
 if(symbol.toLowerCase()==='spyon')return <DirectTrade/>;
 return <div className="product-site"><ProductHeader active="market"/><main className="product-content"><p className="product-eyebrow">Current route · unavailable</p><h1>There is no verified wallet route for {symbol}.</h1><p className="product-lede">Mandate can show sourced token facts and recorded cost evidence. It cannot prepare a transaction for this token until its route, wallet access and transaction meaning are verified.</p><Link className="product-button secondary" href={`/asset/${encodeURIComponent(symbol)}`}>Research this token</Link></main></div>;
}
