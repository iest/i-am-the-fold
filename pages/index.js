import React from "react";
import Head from "next/head";
import { Flex, Box } from "rebass";

import Header from "@mdx/header.mdx";
import Footer from "@mdx/footer.mdx";

const Home = ({ folds, max }) => (
  <>
    <Head>
      <title>I am the fold</title>
      <meta name="viewport" content="width=device-width initial-scale=1" />
      <meta
        name="description"
        content="An experiment to show how designing for The Fold can be treacherous"
      />

      <link
        href="http://fonts.googleapis.com/css?family=Fira+Mono:400,700"
        rel="stylesheet"
        type="text/css"
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

    <ul style={{ height: `${max}px` }}>
      {folds.map((fold, i) => (
        <li key={fold + i} style={{ top: `${fold}px` }}>
          <span>{fold}</span>
        </li>
      ))}
      {typeof window !== "undefined" && window.innerHeight && (
        <li className="current" style={{ top: `${window.innerHeight}px` }}>
          <span>{window.innerHeight}</span>
        </li>
      )}
    </ul>

    <footer>
      <Footer />
    </footer>
  </>
);

export async function getServerSideProps({ req }) {
  const protocol = req.connection.encrypted ? "https" : "http";
  const baseUrl = req ? `${protocol}://${req.headers.host}` : "";
  const { folds } = await fetch(baseUrl + "/api").then((res) => res.json());
  const max = folds.reduce((a, b) => Math.max(a, b));
  return { props: { folds, max } };
}

export default Home;