import { render } from "solid-js/web";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/archivo/latin-400.css";
import "@fontsource/archivo/latin-500.css";
import "@fontsource/archivo/latin-600.css";
import "@fontsource/archivo/latin-700.css";
import "./admin.css";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount point");
render(() => <App />, root);
