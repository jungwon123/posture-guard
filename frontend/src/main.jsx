import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// StrictMode 없이 마운트 — 엔진(initApp)이 이펙트에서 1회만 돌도록 (이중 마운트 방지)
createRoot(document.getElementById("root")).render(<App />);
