import { solveWork } from "./util-client";

addEventListener("message", async (event) => {
  const proof = await solveWork(event.data);
  postMessage(proof);
});
