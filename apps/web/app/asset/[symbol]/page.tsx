import type {Metadata} from 'next';
import ProductHeader from '../../product-header';
import AssetClient from './asset-client';

export const metadata:Metadata={title:'Token research | Mandate',description:'Inspect a tokenized stock, its recorded costs, sourced issuer facts and available wallet-specific route checks.'};

export default async function AssetPage({params}:{params:Promise<{symbol:string}>}){
 const {symbol}=await params;
 return <div className="product-site"><ProductHeader active="market"/><main className="product-content asset-page"><AssetClient symbol={symbol}/></main></div>;
}
