import type {Metadata} from 'next';
import './globals.css';
import './readiness.css';
import './passports.css';
import './capital.css';
import './recurring.css';
export const metadata:Metadata={title:'Mandate | A plan for your capital',description:'Build an investment plan with explicit reserves, issuer limits and execution evidence.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
