import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@forge-go/dashboard-kit/globals.css"
import "@forge-go/dashboard-kit/preview.css"
import "./preview.css"
import { DashboardPreview } from "./DashboardPreview"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardPreview />
  </StrictMode>
)
