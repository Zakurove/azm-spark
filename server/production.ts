import { createServer } from "node:http";
import { createApi } from "./api";
import { createStaticHandler } from "./static";

const api = createApi();
const files = createStaticHandler("dist");
const server = createServer((req, res) => void api.handle(req, res, () => files(req, res)));
server.listen(Number(process.env.PORT ?? 5205), process.env.HOST ?? "127.0.0.1", () => {
  console.log("Azm application server ready");
  // The first visitor gets the compressed app page and script at once.
  void files.warm();
});
server.on("close", api.close);
