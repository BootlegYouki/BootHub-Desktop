import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import axios from 'axios';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

// Route all axios requests through Tauri's HTTP plugin to bypass CORS
axios.defaults.adapter = 'fetch';
axios.defaults.env = {
  fetch: tauriFetch,
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
