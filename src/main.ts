import { createApp } from "vue";
import App from "./App.vue";
import { makeRouter } from "./router";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/face.css";

createApp(App).use(makeRouter()).mount("#app");
