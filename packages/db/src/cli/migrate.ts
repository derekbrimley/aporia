import { migrate } from "../migrate.js";
import { databaseUrl } from "../client.js";

const applied = await migrate(databaseUrl());
console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
