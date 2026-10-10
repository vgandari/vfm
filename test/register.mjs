// Lets the tests import the sources the way Next.js does, without ".ts" in the specifier.
import { register } from "node:module";

register("./resolve-ts.mjs", import.meta.url);
