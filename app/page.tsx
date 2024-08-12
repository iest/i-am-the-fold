import React from "react";

import { DB } from "../util";
import { Fold } from "./Fold";

const db = new DB();

export default async function Page() {
  const folds = await db.getFoldSample();
  const max = Math.max(...folds);

  return (
    <>
      <header className="p-4 relative z-20 bg-white gap-4 max-w-4xl flex flex-col mx-auto mb-2">
        <h1 className="text-center mb-1 font-bold text-2xl">I am the fold</h1>
        <p>
          An experiment to show how designing for <em>The Fold</em> can be
          treacherous. Each line below is a viewport height from a previous
          random visitor. Take care when making assumptions about people&rsquo;s
          screen sizes on the web.
        </p>
        <p>
          Made with <span className="text-red">❤</span> by{" "}
          <a href="https://www.threads.net/@iest">@iest</a> &amp;{" "}
          <a href="https://github.com/iest/i-am-the-fold/graphs/contributors">
            friends
          </a>{" "}
          | Born from an{" "}
          <a href="https://jordanm.co.uk/2015/02/07/i-am-the-fold.html">idea</a>{" "}
          by <a href="http://jordanm.co.uk">Jordan Moore</a> |{" "}
          <a href="https://github.com/iest/i-am-the-fold">Source on Github</a>
        </p>
      </header>

      <ul
        style={{ height: `${max + 30}px`, minHeight: "calc(100vh - 150px)" }}
        className="list-none bg-dark text-white text-center leading-5"
      >
        {folds.map((fold, i) => (
          <li
            key={fold + i}
            className="w-full absolute bg-dark border-t border-white z-10 opacity-10 hover:z-50 hover:opacity-100 group"
            style={{ top: `${fold}px` }}
          >
            <span className="group-hover:bg-white group-hover:text-dark">
              {fold}
            </span>
          </li>
        ))}
        <Fold />
      </ul>

      <footer className="gap-2 text-left text-sm p-4 max-w-4xl flex flex-col mx-auto">
        <p>
          Brighter portions are where there are multiple similar viewports. The
          lines are a 1000-point sample of the full dataset.
        </p>
        <p>
          This is meant to show the diversity of viewports, not the popularity
          of them.
        </p>
        <p>Data was reset on 27th July 2024.</p>
        <p className="opacity-50 mt-4 text-center">
          2015 - {new Date().getFullYear()}
        </p>
      </footer>
    </>
  );
}

export const revalidate = 60 * 5; // 5 minutes
