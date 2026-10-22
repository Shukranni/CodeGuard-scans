import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tailwind.css";
import "./styles/index.css";

// Apply the persisted theme before the first paint, otherwise a reload always
// flashes the light theme before the preference is restored.
import { applyTheme, resolveInitialTheme } from "./utils/theme";

applyTheme(resolveInitialTheme());

const container = document.getElementById("root");
const root = createRoot(container);

root.render(<App />);
