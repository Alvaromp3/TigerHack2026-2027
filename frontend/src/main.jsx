import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CommandCenter from "./dashboard/CommandCenter.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <CommandCenter />
  </StrictMode>
);
