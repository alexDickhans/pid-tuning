import React from 'react';
import { Playground } from './components/Playground';

export default function App(): JSX.Element {
  return (
    <div>
      <header className="header">
        <div className="container">
          <h1 style={{ margin: 0 }}>Alex Dickhans' PID Simulator</h1>
          <script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "2efb26592076454f8767229c9cf87341"}'></script>
        </div>
      </header>
      <main className="container">
        <Playground />
      </main>
    </div>
  );
}



