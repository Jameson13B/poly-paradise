import { render } from 'preact';
import { App } from './App.tsx';
import { connect } from './net.ts';
import './styles.css';

connect();
render(<App />, document.getElementById('app')!);

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
