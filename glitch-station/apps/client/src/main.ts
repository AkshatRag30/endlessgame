import { findPath, taskById } from "@glitch/shared";
import { App } from "./app";
import { bridge } from "./game/bridge";
import "./style.css";

const app = new App();
app.start();

// Development only: lets automated tests read state. Removed from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __gs: unknown }).__gs = { app, bridge, findPath, taskById };
}
