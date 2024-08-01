"use client";
import { useEffect, useRef, useState } from "react";
import { solveWork } from "../util";

const useWorker = (callback: (result: string) => void) => {
  const workerRef = useRef<Worker>();
  useEffect(() => {
    if (!window.Worker) {
      console.log("No worker support");
      return;
    }
    workerRef.current = new Worker(new URL("../worker.js", import.meta.url));
    workerRef.current.onmessage = (e) => {
      callback(e.data);
    };
    return () => {
      workerRef.current?.terminate();
    };
  }, []);
  return workerRef;
};

export const Fold = ({
  token,
  challenge,
}: {
  token: string;
  challenge: string;
}) => {
  const [fold, setFold] = useState<number>();
  const [proof, setProof] = useState<string>();
  const [saved, setSaved] = useState(false);
  const worker = useWorker((result) => setProof(result));

  const saveFold = async () => {
    try {
      const res = await fetch("/api", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fold,
          proof,
          token,
        }),
      });
      if (res.ok) {
        setSaved(true);
      }
    } catch (e) {
      console.log("Error saving fold", e);
    }
  };

  useEffect(() => {
    const height = window.innerHeight;
    setFold(height);
  }, []);

  useEffect(() => {
    if (!fold) return;
    if (worker.current) {
      worker.current.postMessage(challenge);
    } else {
      solveWork(challenge).then((result) => setProof(result));
    }
  }, [fold]);

  useEffect(() => {
    if (!proof) return;
    saveFold();
  }, [proof]);

  if (!fold) {
    return null;
  }

  return (
    <li
      className={`w-full absolute border-t ${
        saved ? "border-green-500" : "border-red"
      } z-50`}
      style={{ top: `${fold}px` }}
    >
      <span className={`${saved ? "bg-green-500" : "bg-red"}`}>{fold}</span>
    </li>
  );
};
