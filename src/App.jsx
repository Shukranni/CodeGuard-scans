import React from "react";
import Routes from "./Routes";
import { ScanProgressProvider } from "./context/ScanProgressContext";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ScanProgressProvider>
          <Routes />
        </ScanProgressProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
