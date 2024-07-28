"use client";
import { useEffect, useState } from "react";
import { createWork } from "../util";

export const Fold = ({
  token,
  challenge,
}: {
  token: string;
  challenge: string;
}) => {
  const [fold, setFold] = useState<number>();

  const saveFold = async (fold: number) => {
    try {
      const workToken = await createWork(challenge);
      await fetch("/api", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fold,
          token,
          workToken,
        }),
      });
    } catch (e) {
      console.log("Error saving fold", e);
    }
  };

  useEffect(() => {
    const height = window.innerHeight;
    setFold(height);
    saveFold(height);
  }, []);

  return (
    <li className="current" style={{ top: `${fold}px` }}>
      <span>{fold}</span>
    </li>
  );
};
