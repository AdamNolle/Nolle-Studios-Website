import { createRoot } from "react-dom/client";
import Site from "./Site";
import "./light-table.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root mount point");
createRoot(container).render(<Site />);
