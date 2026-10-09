import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@forge-go/dashboard-kit/globals.css"
import "@forge-go/dashboard-kit/reference.css"
import "./reference-preview.css"
import { ReferencePreview } from "./ReferencePreview"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReferencePreview />
  </StrictMode>
)
