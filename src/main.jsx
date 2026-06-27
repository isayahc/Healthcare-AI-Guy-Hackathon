import { StrictMode } from "react";
import { ClerkProvider } from "@clerk/react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary.jsx";
import "./styles.css";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const app = (
  <AppErrorBoundary>
    <App clerkEnabled={Boolean(clerkPublishableKey)} />
  </AppErrorBoundary>
);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {clerkPublishableKey ? (
      <ClerkProvider publishableKey={clerkPublishableKey}>{app}</ClerkProvider>
    ) : (
      app
    )}
  </StrictMode>
);
