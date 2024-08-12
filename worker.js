import { solveWork } from "./util";

addEventListener("message", async (event) => {
  const proof = await solveWork(event.data);
  postMessage(proof);
});
