import Image from 'next/image';
import type {Metadata} from 'next';
import './landing.css';

export const metadata:Metadata={title:'Mandate | See when stock-token buying gets expensive',description:'Explore historical buy quotes for tokenized stocks, inspect their sources, and plan without placing a trade.'};

export default function LandingPage(){
 return <div className="landing">
  <header className="landing-header">
   <a className="landing-wordmark" href="/" aria-label="Mandate home"><Image className="landing-mark" src="/mandate-mark.svg" alt="" width={32} height={32}/>Mandate</a>
   <nav className="landing-nav" aria-label="Landing navigation"><a href="#evidence">Evidence</a><a href="#method">How it works</a></nav>
   <a className="landing-nav-cta" href="/regime">Explore cost history <span aria-hidden="true">↗</span></a>
  </header>
  <main className="landing-main">
   <section className="landing-hero" aria-labelledby="landing-title">
    <div className="landing-hero-copy"><p className="landing-overline">READ-ONLY STOCK-TOKEN RESEARCH</p><h1 id="landing-title">Know when buying gets expensive.</h1><p className="landing-hero-description">See recorded buy quotes, trace each cost to its source, and plan capital. No wallet needed to start.</p><div className="landing-actions"><a className="landing-primary" href="/regime">Explore cost history <span aria-hidden="true">↗</span></a><a className="landing-secondary" href="#method">How it works</a></div></div>
    <div className="landing-product-image"><Image src="/mandate-regime-brand.png" alt="Mandate Regime workspace showing the recorded NVDA cost reversal and its source controls" width={1440} height={900} priority sizes="(max-width: 800px) 100vw, 53vw"/></div>
   </section>
   <section className="landing-measurement" id="evidence" aria-labelledby="measurement-title"><div className="landing-measurement-heading"><p className="landing-overline">A RECORDED EXAMPLE</p><h2 id="measurement-title">The same buy looked different 15 minutes later.</h2><p>For a quoted $10,000 NVDA / Ondo buy on 20 September 2026, the implied price moved from far above to just below the token reference value.</p></div><div className="landing-measurement-values"><div><span>16:45 UTC</span><strong>+133.71%</strong><small>Above reference value</small></div><div className="landing-measurement-rule" aria-hidden="true"/><div><span>17:00 UTC</span><strong>−0.05%</strong><small>Below reference value</small></div></div><p className="landing-measurement-note">Historical quotes, not completed trades or current offers. Each figure links to its original recorded line inside the workspace.</p></section>
   <section className="landing-method" id="method" aria-labelledby="method-title"><div className="landing-method-intro"><h2 id="method-title">From a quote to a better decision.</h2><p>Mandate separates what was recorded, what a wallet-specific quote shows, and what is only an illustrative plan.</p></div><ol><li><span>Choose</span><strong>Pick a stock token</strong><p>Select a token and see its recorded buying costs over time. No wallet is needed.</p></li><li><span>Check</span><strong>Inspect the evidence</strong><p>Open the source of a quote, or connect a wallet for an optional read-only quote for your wallet.</p></li><li><span>Plan</span><strong>Protect your cash</strong><p>Set aside commitments before exploring a hypothetical allocation or exit.</p></li></ol></section>
   <section className="landing-closing" aria-labelledby="closing-title"><div className="landing-closing-image"><Image src="/evidence-material.png" alt="" width={1916} height={853} loading="eager" sizes="(max-width: 800px) 100vw, 48vw"/></div><div className="landing-closing-copy"><h2 id="closing-title">Know what you know before you invest.</h2><p>Recorded quotes have source records. Wallet checks do not approve a trade, and planning examples do not use your funds.</p><a href="/regime">Explore cost history <span aria-hidden="true">↗</span></a></div></section>
  </main>
  <footer className="landing-footer"><span>Mandate</span><p>Historical research on BNB Smart Chain. Live execution is disabled.</p><a href="#landing-title">Back to top</a></footer>
 </div>;
}
