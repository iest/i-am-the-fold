import fs from "fs";
import faunadb, { query as q } from "faunadb";
import R from "ramda";

const [, , SECRET] = process.argv;

const read = (file) => fs.readFileSync(file, "utf8").split("\n");

const chunk = (arr) => {
  const chunkSize = 50;
  const chunks = [];
  for (let i = 0, len = arr.length; i < len; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
};

const allowPreExist = async (cb) => {
  try {
    return await cb();
  } catch (e) {
    if (e.message === "instance already exists") return;
    throw e;
  }
};

const writeBlacklist = async (data, client) => {
  console.log(`> Writing ${data.length} entries to blacklist`);
  await allowPreExist(() =>
    client.query(q.CreateCollection({ name: "blacklist" }))
  );

  const chunks = chunk(data);
  console.log(`> Got ${chunks.length} chunks`);

  chunks.forEach(async (ch, i) => {
    console.log(`> Writing chunk ${i}`);
    await client.query(
      q.Map(
        ch,
        q.Lambda(
          "value",
          q.Create(q.Collection("blacklist"), {
            data: { value: q.Var("value") },
          })
        )
      )
    );
  });
};

const writeFolds = async (data, client) => {
  console.log(`> Got ${data.length} folds`);
  await allowPreExist(() =>
    client.query(q.CreateCollection({ name: "folds" }))
  );

  const counted = R.compose(
    R.map(([fold, count]) => ({ fold, count })),
    R.toPairs,
    R.map((arr) => arr.length),
    R.groupBy(R.identity),
    R.filter(Boolean)
  )(data);

  const chunks = chunk(counted);
  console.log(`> Got ${chunks.length} chunks`);

  chunks.forEach(async (ch, i) => {
    try {
      console.log(`> Writing chunk ${i}`);
      await client.query(
        q.Map(
          ch,
          q.Lambda(
            "obj",
            q.Create(q.Collection("folds"), { data: q.Var("obj") })
          )
        )
      );
    } catch (e) {
      console.log("> Failed", e);
    }
  });
};

const main = async () => {
  try {
    // const blacklist = read("./blacklist.txt");
    const folds = read("./folds.txt");

    const adminClient = new faunadb.Client({ secret: SECRET });

    // await writeBlacklist(blacklist, adminClient);
    await writeFolds(folds, adminClient);

    console.log("Done!");
  } catch (e) {
    console.log("Caught error in main:", e);
  }
};

main();
