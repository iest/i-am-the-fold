import React from "react";
import crypto from "crypto";

import Header from "../mdx/header.mdx";
import Footer from "../mdx/footer.mdx";
import { createToken, DB } from "../util";
import { Fold } from "./Fold";

const db = new DB();

export default async function Page() {
  const folds = await db.getFolds();
  const max = Math.max(...folds);
  const challenge = crypto.randomBytes(50).toString("base64");
  const token = createToken(challenge);

  return (
    <>
      <header>
        <Header />
      </header>

      <ul style={{ height: `${max + 30}px`, minHeight: "calc(100vh - 150px)" }}>
        {folds.map((fold, i) => (
          <li key={fold + i} style={{ top: `${fold}px` }}>
            <span>{fold}</span>
          </li>
        ))}
        <Fold token={token} challenge={challenge} />
      </ul>

      <footer>
        <Footer />
        <p
          style={{
            textAlign: "center",
            marginTop: "1em",
            opacity: 0.5,
          }}
        >
          &copy; 2015 - {new Date().getFullYear()}{" "}
        </p>
      </footer>
    </>
  );
}

export const dynamic = "force-dynamic";
