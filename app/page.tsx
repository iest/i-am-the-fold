import type { InferGetServerSidePropsType } from "next";
import React, { useState, useEffect } from "react";
import Head from "next/head";
import work from "work-token/async";
import * as tls from "tls";
import crypto from "crypto";

import Header from "../mdx/header.mdx";
import Footer from "../mdx/footer.mdx";
import { createToken, createWork, DB, ResponseData } from "../util";
import { Fold } from "./Fold";

const db = new DB();

export default async function Page() {
  const folds = await db.getFolds();
  const max = Math.max(...folds);
  const challenge = crypto.randomBytes(50).toString("base64");
  const token = createToken(challenge);

  return (
    <>
      <Head>
        <title>I am the fold</title>
        <meta name="viewport" content="width=device-width initial-scale=1" />
        <meta
          name="description"
          content="An experiment to show how designing for The Fold can be treacherous"
        />
      </Head>

      <style global jsx>{`
        body,
        ul {
          padding: 0;
          margin: 0;
        }
        body {
          font: 1em/1.4 "Fira Mono", "Menlo", monospace;
          background: #fff;
          color: #2a2a2a;
          text-align: center;
        }
        a {
          color: #333;
          font-weight: bold;
        }
        h1 {
          margin: 0 0 0.25em;
        }
        ul {
          background: #2a2a2a;
          color: #fff;
        }
        li {
          position: absolute;
          list-style: none;
          border-top: 1px solid #fff;
          width: 100%;
          z-index: 1;
          opacity: 0.1;
        }
        li:hover {
          z-index: 100000;
          opacity: 1;
        }
        li:hover span {
          background: #fff;
          color: #2a2a2a;
        }
        li span {
          background: #2a2a2a;
        }
        li.current {
          border-top: 1px solid #ff0000;
          z-index: 100000;
          opacity: 1;
        }
        li.current:hover span {
          background: #ff0000;
          color: #fff;
        }
        li.current span {
          background: #ff0000;
        }
        header {
          padding: 1em;
          position: relative;
          z-index: 2;
          background: #fff;
        }
        header p {
          text-align: left;
          max-width: 55em;
          margin: 0 auto 0.5em;
        }
        header p span {
          color: #ff0000;
        }
        footer {
          font-size: 80%;
          padding: 1em;
          max-width: 55em;
          margin: 0 auto;
        }
        footer p {
          text-align: left;
        }
        noscript {
          color: red;
        }
      `}</style>

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
