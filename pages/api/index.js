import faunadb, { query as q } from "faunadb";

const { FAUNA_SECRET } = process.env;

let folds = [];
let started = false;

const client = new faunadb.Client({ secret: FAUNA_SECRET });

const fetchFolds = async (nextAfter, allData = []) => {
  const { data, after } = await client.query(
    q.Map(
      q.Paginate(q.Documents(q.Collection("folds")), {
        size: 50000,
        after: nextAfter,
      }),
      q.Lambda((x) => q.Get(x))
    )
  );
  const newData = allData.concat(data);
  if (after) return await fetchFolds(after, newData);
  return newData;
};

const fillFold = ({ fold, count }) => Array(count).fill(fold);
const generateFoldsArr = (foldCounts) =>
  foldCounts
    .map(({ data }) => data)
    .reduce((acc, val) => acc.concat(fillFold(val)), []);

const getRandomInt = (min, max) =>
  Math.floor(Math.random() * (max - min) + min);

const getRandomUniqInt = (min, max, ints = []) => {
  const int = getRandomInt(min, max);
  if (ints.indexOf(int) === -1) return int;
  return getRandomUniqInt(min, max, ints);
};

const getRandomUniqFolds = (count, arr) => {
  const indicies = [];
  for (let i = 0; i < count; i++) {
    const index = getRandomUniqInt(0, arr.length - 1, indicies);
    indicies.push(index);
  }
  return indicies.map((undex) => arr[undex]);
};

const start = async () => {
  if (started) return;
  const foldCounts = await fetchFolds();
  folds = generateFoldsArr(foldCounts);
  started = true;
};

const api = async (req, res) => {
  await start();
  const subset = getRandomUniqFolds(1000, folds);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ folds: subset }));
};

export default api;
