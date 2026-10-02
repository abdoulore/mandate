'use client';

import {useState} from 'react';
import {replayScenarios} from '@mandate/evidence';
import './replay-lab.css';

export default function ReplayLab() {
  const [selectedId, setSelectedId] = useState(replayScenarios[0]?.id ?? '');
  const scenario = replayScenarios.find(item => item.id === selectedId);
  if (!scenario) return null;

  return <section className="panel replay-lab" aria-label="Recorded and synthetic evidence inputs">
    <div className="panel-title"><div><h2>Evidence inputs</h2><p>Inspect a recorded collector row or a clearly labelled synthetic failure. These cases cannot execute trades.</p></div><span className="status attention">Read only</span></div>
    <div className="replay-layout">
      <div className="replay-list" aria-label="Evidence cases">{replayScenarios.map(item =>
        <button key={item.id} type="button" aria-pressed={item.id === selectedId} onClick={() => setSelectedId(item.id)}>
          <span className={'replay-kind ' + item.kind}>{item.kind === 'recorded' ? 'Recorded collector' : 'Synthetic failure'}</span>
          <strong>{item.title}</strong>
        </button>
      )}</div>
      <div className="replay-detail" aria-live="polite">
        <div className="replay-detail-head"><span className={'replay-kind ' + scenario.kind}>{scenario.kind === 'recorded' ? 'Recorded collector' : 'Synthetic failure'}</span><time dateTime={scenario.capturedAt}>{new Date(scenario.capturedAt).toLocaleString()}</time></div>
        <h3>{scenario.title}</h3>
        <p><strong>Question:</strong> {scenario.question}</p>
        <p><strong>Control to examine:</strong> {scenario.expectedControl}</p>
        <div className="replay-events">{scenario.events.map((event, index) => <details key={index}>
          <summary>{event.kind === 'recorded_collector_row' ? `Recorded row ${index + 1} · ${event.metricClass.replaceAll('_', ' ')}` : `Synthetic event ${index + 1} · ${event.failure.replaceAll('_', ' ')}`}</summary>
          <p>{event.note}</p>
          {event.kind === 'recorded_collector_row' ? <><p className="replay-source">Source: {event.source.file}:{event.source.line} · line SHA-256 {event.source.lineSha256}</p><pre>{JSON.stringify(event.storedCollectorRow, null, 2)}</pre></> : <pre>{JSON.stringify(event.injectedState, null, 2)}</pre>}
        </details>)}</div>
        <h4>Limits of this evidence</h4>
        <ul>{scenario.limitations.map(limit => <li key={limit}>{limit}</li>)}</ul>
      </div>
    </div>
  </section>;
}
