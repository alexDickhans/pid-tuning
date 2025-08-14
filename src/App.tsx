import React from 'react';
import { Playground } from './components/Playground';

export default function App(): JSX.Element {
  return (
    <div>
      <header className="header">
        <div className="container">
          <h1 style={{ margin: 0 }}>PID Simulator</h1>
        </div>
      </header>
      <main className="container">
        <Playground />
      </main>
    </div>
  );
}



