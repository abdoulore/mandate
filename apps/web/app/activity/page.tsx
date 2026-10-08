import type {Metadata} from 'next';
import Home from '../workspace';

export const metadata:Metadata={title:'Activity | Mandate',description:'Review saved capital decisions and confirmed wallet requests with their transaction evidence.'};
export default function ActivityPage(){return <Home initialView="Records"/>;}
