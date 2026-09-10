export interface Assets {
  client: string;
  worker: string;
  styles: string;
}

export function Page({ folds, assets, posthogKey }: { folds: number[]; assets: Assets; posthogKey?: string }) {
  const max = Math.max(0, ...folds);
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>I am the fold</title>
        <meta name="description" content="An experiment to show how designing for The Fold can be treacherous" />
        <link rel="stylesheet" href={assets.styles} />
        <script type="module" src={assets.client} data-fold-worker={assets.worker} data-posthog-key={posthogKey || undefined}></script>
      </head>
      <body class="bg-white dark:bg-dark text-dark dark:text-white">
      <header class="p-4 relative z-20 gap-4 max-w-4xl flex flex-col mx-auto mb-2">
        <h1 class="text-center mb-1 font-bold text-2xl">I am the fold</h1>
        <p>
          An experiment to show how designing for <em>The Fold</em> can be
          treacherous. Each line below is a viewport height from a previous
          random visitor. Take care when making assumptions about people&rsquo;s
          screen sizes on the web.
        </p>
        <p>
          Made with <span class="text-red">❤</span> by{" "}
          <a href="https://hyperinc.ltd">@iest</a> &amp;{" "}
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
        class="list-none bg-dark dark:bg-darker text-white text-center leading-5"
      >
        {folds.map((fold) => (
          <li
            class="w-full absolute border-t border-white z-10 opacity-10 hover:z-50 hover:opacity-100 group"
            style={{ top: `${fold}px` }}
          >
            <span class="group-hover:bg-white group-hover:text-dark">
              {fold}
            </span>
          </li>
        ))}
        <li id="current-fold" hidden class="w-full absolute border-t z-50 border-red">
          <span class="absolute -top-2.5 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red"></span>
        </li>
      </ul>

      <footer class="gap-2 text-left text-sm p-4 max-w-4xl flex flex-col mx-auto">
        <p>
          Brighter portions are where there are multiple similar viewports. The
          lines are a sample of up to 1000 points from the full dataset.
        </p>
        <p>
          This is meant to show the diversity of viewports, not the popularity
          of them.
        </p>
        <p>Data was reset on 27th July 2024.</p>
        <p class="opacity-50 mt-4 text-center">
          2015 - {new Date().getFullYear()}
        </p>
      </footer>
      </body>
    </html>
  );
}
