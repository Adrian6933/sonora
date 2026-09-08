import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";

import App from "./App";
import Hud from "./Hud";
import "./styles.css";

// Las dos ventanas cargan el mismo bundle; la etiqueta decide que se pinta.
const isHud = getCurrentWindow().label === "hud";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isHud ? <Hud /> : <App />}</React.StrictMode>
);
