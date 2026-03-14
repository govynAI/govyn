import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ProxyConnectionProvider } from "./contexts/ProxyConnectionContext";
import { AuthProvider } from "./contexts/AuthContext";
import { TooltipProvider } from "./components/ui/tooltip";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <ProxyConnectionProvider>
          <AuthProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </AuthProvider>
        </ProxyConnectionProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
