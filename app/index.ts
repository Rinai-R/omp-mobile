import "./src/polyfills";
import { registerRootComponent } from "expo";
import App from "./App";
import { installRelayTransport } from "./src/link";
import { relayTransport } from "./src/relay/tunnel";

installRelayTransport(relayTransport);
registerRootComponent(App);
