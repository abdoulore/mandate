import Image from 'next/image';
import Link from 'next/link';

type Destination='market'|'portfolio'|'activity';

export default function ProductHeader({active,showWalletAction=true}:{active?:Destination;showWalletAction?:boolean}){
 const links:[Destination,string,string][]=[['market','Explore','/market'],['portfolio','Portfolio','/portfolio'],['activity','Activity','/activity']];
 return <header className="product-header">
  <Link className="product-brand" href="/" aria-label="Mandate home"><Image src="/mandate-mark.svg" alt="" width={29} height={29}/>Mandate</Link>
  <nav aria-label="Main navigation">{links.map(([key,label,href])=><Link key={key} href={href} prefetch={true} aria-current={active===key?'page':undefined}>{label}</Link>)}</nav>
  {showWalletAction&&<Link className="product-header-action" href="/portfolio">Connect wallet <span aria-hidden="true">↗</span></Link>}
 </header>;
}
