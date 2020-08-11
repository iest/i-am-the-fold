import faunadb, { query as q } from "faunadb";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import work from "work-token/sync";

const { FAUNA_SECRET } = process.env;
const STRENGTH = 3;
const SECRET = crypto.randomBytes(16).toString("hex");

let folds = [];
let started = false;
const usedChallenges = new Set();

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
  return newData.map(({ data }) => data);
};

const fillFold = ({ fold, count }) => Array(count).fill(fold);
const generateFoldsArr = (foldCounts) =>
  foldCounts.reduce((acc, val) => acc.concat(fillFold(val)), []);

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
  folds = await fetchFolds();
  started = true;
};

const addDBBlacklist = async (value) =>
  client.query(q.Create(q.Collection("blacklist"), { data: { value } }));

const addDBFold = (data) =>
  client.query(q.Create(q.Collection("folds"), { data }));

const updateDBFold = async (newfold) => {
  const { ref, data } = await client.query(
    q.Get(q.Match(q.Index("folds_by_fold"), newFold))
  );
  await client.query(
    q.Update(q.Ref(ref), {
      data: {
        count: data.count + 1,
      },
    })
  );
};

const addFold = async (newFold, ip) => {
  try {
    addDBBlacklist(ip);
    const existing = folds.find(({ fold }) => fold === newFold);
    if (existing) {
      existing.count++;
      await updateDBFold(addDBFold);
      console.log("Fold updated", newFold);
    } else {
      const data = { fold: newFold, count: 1 };
      folds.push(data);
      await addDBFold(data);
      console.log("Fold added", newFold);
    }
  } catch (e) {
    console.log("Error adding fold", e);
  }
};

const queryBlacklist = async (ip) => {
  try {
    const blacklisted = await client.query(
      q.Get(q.Match(q.Index("blacklist_by_ip"), ip))
    );
    if (blacklisted) {
      return true;
    }
  } catch (e) {
    if (e.message === "instance not found") return false;
    throw e;
  }
};

const removeChallenge = (challenge, timeout) =>
  setTimeout(() => {
    usedChallenges.delete(challenge);
  }, timeout);

const verifyToken = (token) =>
  new Promise((resolve) => {
    jwt.verify(token, SECRET, (err, { challenge }) => {
      if (err && err.name === "TokenExpiredError") {
        return resolve({ expired: true });
      }
      if (err) return resolve({ err });
      resolve({ challenge });
    });
  });

const api = async (req, res) => {
  await start();

  if (req.method === "POST") {
    const {
      connection: { remoteAddress },
      body: { fold, token, workToken },
    } = req;

    // Make sure this IP hasn't already submitted a fold
    const blacklisted = await queryBlacklist(remoteAddress);
    if (blacklisted) {
      console.log("Blacklisted");
      res.statusCode = 403;
      res.end("Fold already saved");
      return;
    }

    // Verify the challenge was created by this server and hasn't expired
    const { expired, challenge, err } = await verifyToken(token);
    if (err || expired) {
      res.statusCode(403);
      res.end("Bad token");
      return;
    }

    // Verify the challenge hasn't already been used
    if (usedChallenges.has(challenge)) {
      res.statusCode(403);
      res.end("Challenge reuse rejected");
      return;
    }

    // Verify that the proof-of-work checks out
    if (!work.check(challenge, STRENGTH, workToken)) {
      console.log("Failed challenge");
      res.statusCode = 403;
      res.end("Challenge failed");
      return;
    }

    // Cool! We have valid proof-of-work
    usedChallenges.add(challenge);
    removeChallenge(challenge, 2 * 60 * 1000);

    // Check the submitted fold is actually valid
    if (!fold || !Number(fold) || parseInt(fold) > 7680 || parseInt(fold) < 1) {
      console.log("Invalid fold");
      res.statusCode = 400;
      res.end("Invalid fold");
      return;
    }

    // Cool! We have a valid fold and we're done here
    addFold(fold.toString(), remoteAddress);
    res.statusCode = 200;
    res.end();
    return;
  }

  // Generate a challenge for the client to work on
  const challenge = crypto.randomBytes(50).toString("base64");

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ip: req.connection.remoteAddress,
      challenge,
      // Send the encoded challenge down to the client so we can later verify it
      token: jwt.sign({ challenge }, SECRET, { expiresIn: "2m" }),
      folds: getRandomUniqFolds(1000, generateFoldsArr(folds)),
    })
  );
};

export default api;
