import { solveWork } from "../util-client";

addEventListener("message", async (event: MessageEvent<string>) => {
  postMessage(await solveWork(event.data));
});
