import React from "react";
import Head from "next/head";
import { Flex, Box } from "rebass";

import Header from "@mdx/header.mdx";
import Footer from "@mdx/footer.mdx";

const Home = () => (
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
      body {
        margin: 0;
      }
    `}</style>

    <Box fontFamily="Fira Mono">
      <header>
        <Header />
      </header>

      <footer>
        <Footer />
      </footer>
    </Box>
  </>
);

export default Home;
