import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { PopupApp } from "./PopupApp";
import "../theme.css";
import "../theme-schedule.css";
import "../theme-dialogs.css";
import { initializeTheme } from "../utils/theme";

initializeTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
);
