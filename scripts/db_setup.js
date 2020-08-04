import fs from "fs";
import faunadb, { query as q } from "faunadb";

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

const write = async (name, data, client) => {
  console.log(`> Writing ${data.length} entries to "${name}"`);
  await allowPreExist(() => client.query(q.CreateCollection({ name })));

  const chunks = chunk(data);
  console.log(`> Got ${chunks.length} chunks`);

  chunks.forEach(async (ch, i) => {
    console.log(`> Writing chunk ${i}`);
    await client.query(
      q.Map(
        ch,
        q.Lambda(
          "value",
          q.Create(q.Collection(name), { data: { value: q.Var("value") } })
        )
      )
    );
  });
};

const main = async () => {
  try {
    const blacklist = read("./blacklist.txt");
    const folds = read("./folds.txt");

    const adminClient = new faunadb.Client({ secret: SECRET });

    await write("blacklist", blacklist, adminClient);
    await write("folds", folds, adminClient);

    console.log("Done!");
  } catch (e) {
    console.log("Caught error in main:", e);
  }
};

main();
