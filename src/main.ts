import { createApp } from "vue";
import App from "./App.vue";
import { CORE } from "./app/context";
import { createAuth } from "./auth/auth";
import { sessionTokenStore } from "./auth/tokenStore";
import { makeRouter } from "./router";
import { HttpTransport } from "./transport/http";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/face.css";
import "./styles/layout.css";
import "./styles/components.css";

const store = sessionTokenStore();
// The transport asks for the token per request, so it can be built before the auth that owns it.
let token: () => string | null = () => store.read();
let unauthorized: () => void = () => {};
const transport = new HttpTransport({
  token: () => token(),
  onUnauthorized: () => unauthorized(),
});
const auth = createAuth({ transport, store });
token = auth.token;
unauthorized = auth.requireSignIn;
auth.restore();

createApp(App).provide(CORE, { transport, auth }).use(makeRouter()).mount("#app");
