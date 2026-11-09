import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/app";
import { applyAppearance, savedAppearance } from "./ui/appearance";
import "./index.css";

applyAppearance(savedAppearance());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
