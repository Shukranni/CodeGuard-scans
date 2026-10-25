import React from "react";
import Routes from "./Routes";
import { ScanProgressProvider } from "./context/ScanProgressContext";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { NotificationProvider } from "./context/NotificationContext";

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <NotificationProvider>
          <ScanProgressProvider>
            <Routes />
          </ScanProgressProvider>
        </NotificationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
