export const STRENGTH = 4;

async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
}

async function findProof(
  challenge: string,
  difficulty: number,
): Promise<string | null> {
  let proof = 0;
  const target = "0".repeat(difficulty);

  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), 10000),
  );

  const proofPromise = (async () => {
    while (true) {
      const hash = await sha256(challenge + proof);
      if (hash.startsWith(target)) {
        return proof.toString();
      }
      proof++;
    }
  })();

  return Promise.race([proofPromise, timeoutPromise]);
}

async function verifyProofOfWork(
  challenge: string,
  proof: string,
  difficulty: number,
): Promise<boolean> {
  const hash = await sha256(challenge + proof);
  return hash.startsWith("0".repeat(difficulty));
}

export const verifyWork = async (challenge: string, proof: string) =>
  verifyProofOfWork(challenge, proof, STRENGTH);

export const solveWork = async (challenge: string) =>
  findProof(challenge, STRENGTH);

export const isValidFold = (fold: unknown): fold is number =>
  typeof fold === "number" &&
  Number.isInteger(fold) &&
  fold >= 1 &&
  fold <= 7680;
