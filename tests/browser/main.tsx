import React from "react";
import { createRoot } from "react-dom/client";
import { TripSetupDashboard } from "../../components/trip-setup-dashboard";
import { LoginForm } from "../../components/login-form";
import "../../app/globals.css";

// This standalone test harness never runs inside Next.js or bypasses its authentication.
const login = new URLSearchParams(window.location.search).get("view") === "login";
createRoot(document.getElementById("root")!).render(login ? <LoginForm configured={false} /> : <TripSetupDashboard email="owner@example.test" />);
