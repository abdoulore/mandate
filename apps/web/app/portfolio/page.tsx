import type {Metadata} from 'next';
import Home from '../workspace';

export const metadata:Metadata={title:'Your portfolio | Mandate',description:'See wallet cash, protected commitments, tracked holdings and the next step in your investment plan.'};
export default function PortfolioPage(){return <Home initialView="Portfolio/exit"/>;}
